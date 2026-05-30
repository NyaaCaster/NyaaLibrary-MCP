import { useRef, useState, type DragEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, UploadCloud, X } from "lucide-react";
import {
  api,
  uploadDocuments,
  type AppConfig,
  type KnowledgeBase,
} from "../../lib/api";
import { Modal, btn, input } from "../../components/Modal";
import { FileIcon } from "../../components/FileIcon";
import { formatSize } from "../../lib/format";

interface Result {
  filename: string;
  ok: boolean;
  error?: string;
  chunk_count?: number;
}

export function UploadModal({
  kb,
  onClose,
  onUploaded,
}: {
  kb: KnowledgeBase;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const { data: cfg } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.get<AppConfig>("/config"),
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [chunkSize, setChunkSize] = useState(kb.chunk_size);
  const [chunkOverlap, setChunkOverlap] = useState(kb.chunk_overlap);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState("");

  const exts = cfg?.supportedExtensions ?? [];
  const maxCount = cfg?.maxUploadCount ?? 10;
  const maxMb = cfg?.maxFileSizeMb ?? 128;

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setError("");
    const next = [...files];
    for (const f of Array.from(incoming)) {
      const ext = "." + f.name.split(".").pop()?.toLowerCase();
      if (exts.length && !exts.includes(ext)) {
        setError(`不支持的格式：${f.name}`);
        continue;
      }
      if (f.size > maxMb * 1024 * 1024) {
        setError(`${f.name} 超过 ${maxMb}MB`);
        continue;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next.slice(0, maxCount));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const submit = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      const { results: r } = await uploadDocuments(kb.id, files, {
        chunkSize,
        chunkOverlap,
      });
      setResults(r);
      if (r.some((x) => x.ok)) onUploaded();
      if (r.every((x) => x.ok)) setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open
      title="上传文档"
      onClose={onClose}
      widthClass="max-w-2xl"
      footer={
        <>
          <button className={btn.ghost} onClick={onClose}>
            关闭
          </button>
          <button
            className={`${btn.primary} flex items-center gap-2`}
            disabled={uploading || files.length === 0}
            onClick={submit}
          >
            {uploading && <Loader2 size={16} className="animate-spin" />}
            上传 {files.length > 0 && `(${files.length})`}
          </button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={exts.join(",")}
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
          dragging
            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
            : "border-slate-300 hover:border-indigo-400 dark:border-slate-700"
        }`}
      >
        <UploadCloud className="text-slate-400" />
        <p className="text-sm text-slate-600 dark:text-slate-300">
          拖放文件到这里，或<span className="text-indigo-600">点击打开文件</span>
        </p>
        <p className="text-xs text-slate-400">
          支持 {exts.join(" ")} · 单文件 ≤ {maxMb}MB · 单次最多 {maxCount} 个
        </p>
      </div>

      {files.length > 0 && (
        <ul className="mt-3 space-y-1">
          {files.map((f) => (
            <li
              key={f.name + f.size}
              className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50"
            >
              <FileIcon ext={"." + (f.name.split(".").pop() ?? "")} />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-xs text-slate-400">{formatSize(f.size)}</span>
              <button
                onClick={() => setFiles(files.filter((x) => x !== f))}
                className="text-slate-400 hover:text-rose-500"
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Group title="分块设置">
          <Num label="分块大小" hint="每个文本块的字符数" value={chunkSize} onChange={setChunkSize} />
          <Num label="分块重叠" hint="相邻文本块重叠字符数" value={chunkOverlap} onChange={setChunkOverlap} />
        </Group>
        <Group title="批处理设置（服务端预设）">
          <Ro label="批处理大小" value={cfg?.batch.size} />
          <Ro label="并发任务限制" value={cfg?.batch.concurrency} />
          <Ro label="最大重试次数" value={cfg?.batch.maxRetries} />
        </Group>
      </div>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {results && (
        <ul className="mt-3 space-y-1 text-sm">
          {results.map((r) => (
            <li key={r.filename} className={r.ok ? "text-emerald-600" : "text-rose-600"}>
              {r.ok ? "✓" : "✗"} {r.filename}
              {r.ok ? `（${r.chunk_count} 分块）` : `：${r.error}`}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="mb-2 text-xs font-semibold text-slate-500">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Num({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm">{label}</span>
      <span className="ml-1 text-xs text-slate-400">{hint}</span>
      <input
        type="number"
        min={label === "分块重叠" ? 0 : 1}
        className={`${input} mt-1`}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </label>
  );
}

function Ro({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}
