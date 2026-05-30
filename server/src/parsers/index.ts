import { extname } from "node:path";
import mammoth from "mammoth";
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { SUPPORTED_EXTENSIONS } from "../config.js";

export type SupportedExt = (typeof SUPPORTED_EXTENSIONS)[number];

export function extOf(filename: string): string {
  return extname(filename).toLowerCase();
}

export function isSupported(filename: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extOf(filename));
}

/** Collapse excessive whitespace while preserving paragraph breaks. */
function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|br|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const { text } = await pdfParse(buffer);
  return text;
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

function parseSpreadsheet(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return wb.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    return `# ${name}\n${csv}`;
  }).join("\n\n");
}

// EPUB is a ZIP of (X)HTML. Read the OPF manifest/spine to recover reading
// order, then strip tags from each content document.
function parseEpub(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const opf = entries.find((e) => e.entryName.toLowerCase().endsWith(".opf"));
  const opfDir = opf ? opf.entryName.replace(/[^/]*$/, "") : "";

  let ordered: string[] = [];
  if (opf) {
    const xml = opf.getData().toString("utf8");
    const manifest = new Map<string, string>();
    for (const m of xml.matchAll(/<item\b[^>]*>/gi)) {
      const tag = m[0];
      const id = /id="([^"]+)"/i.exec(tag)?.[1];
      const href = /href="([^"]+)"/i.exec(tag)?.[1];
      if (id && href) manifest.set(id, href);
    }
    for (const m of xml.matchAll(/<itemref\b[^>]*idref="([^"]+)"[^>]*>/gi)) {
      const href = manifest.get(m[1]);
      if (href) ordered.push(opfDir + href);
    }
  }
  if (ordered.length === 0) {
    ordered = entries
      .map((e) => e.entryName)
      .filter((n) => /\.x?html?$/i.test(n))
      .sort();
  }

  const byName = new Map(entries.map((e) => [e.entryName, e]));
  return ordered
    .map((name) => byName.get(name)?.getData().toString("utf8") ?? "")
    .map(stripHtml)
    .join("\n\n");
}

/** Extract plain text from a supported document buffer. */
export async function extractText(
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const ext = extOf(filename);
  let text: string;
  switch (ext) {
    case ".txt":
    case ".md":
      text = buffer.toString("utf8");
      break;
    case ".pdf":
      text = await parsePdf(buffer);
      break;
    case ".docx":
      text = await parseDocx(buffer);
      break;
    case ".xls":
    case ".xlsx":
      text = parseSpreadsheet(buffer);
      break;
    case ".epub":
      text = parseEpub(buffer);
      break;
    default:
      throw new Error(`不支持的文件格式：${ext || "(无扩展名)"}`);
  }
  return normalize(text);
}
