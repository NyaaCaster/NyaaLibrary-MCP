// pdf-parse ships no type definitions. We import the library entry directly
// (pdf-parse/lib/pdf-parse.js) to avoid the package index's debug-mode side
// effect that reads a bundled sample PDF when required without a parent module.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: unknown;
  }
  function pdfParse(data: Buffer): Promise<PdfParseResult>;
  export default pdfParse;
}
