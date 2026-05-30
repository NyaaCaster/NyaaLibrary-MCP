import { useRef, useState, type DragEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  Loader2,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import {
  api,
  uploadDocuments,
  type AppConfig,
  type KnowledgeBase,
} from "../../lib/api";
import { Modal, btn, input } from "../../components/Modal";
import { FileIcon } from "../../components/FileIcon";
import { formatSize } from "../../lib/format";

type Status = "pending" | "processing" | "success" | "error";

interface Entry {
  id: string;
  file: File;
  status: Status;
  chunkCount?: number;
  error?: string;
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
  const [entries, setEntries] = useState<Entry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [chunkSize, setChunkSize] = useState(kb.chunk_size);
  const [chunkOverlap, setChunkOverlap] = useState(kb.chunk_overlap);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const exts = cfg?.supportedExtensions ?? [];
  const maxCount = cfg?.maxUploadCount ?? 10;
  const maxMb = cfg?.maxFileSizeMb ?? 128;

  const setStatus = (id: string, patch: Partial<Entry>) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setError("");
    setEntries((prev) => {
      const next = [...prev];
      for (const f of Array.from(incoming)) {
        const ext = "." + (f.name.split(".").pop()?.toLowerCase() ?? "");
        if (exts.length && !exts.includes(ext)) {
          setError(`不支持的格式：${f.name}`);
          continue;
        }
        if (f.size > maxMb * 1024 * 1024) {
          setError(`${f.name} 超过 ${maxMb}MB`);
          continue;
        }
        if (next.some((e) => e.file.name === f.name && e.file.size === f.size))
          continue;
        if (next.length >= maxCount) {
          setError(`单次最多上传 ${maxCount} 个文件`);
          break;
        }
        next.push({ id: `${f.name}-${f.size}-${f.lastModified}`, file: f, status: "pending" });
      }
      return next;
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  // Upload one request per file so each row reflects its own progress.
  const submit = async () => {
    const targets = entries.filter((e) => e.status === "pending" || e.status === "error");
    if (targets.length === 0) return;
    setUploading(true);
    setError("");
    let anySuccess = false;
    for (const entry of targets) {
      setStatus(entry.id, { status: "processing", error: undefined });
      try {
        const { results } = await uploadDocuments(kb.id, [entry.file], {
          chunkSize,
          chunkOverlap,
        });
        const r = results[0];
        if (r?.ok) {
          setStatus(entry.id, { status: "success", chunkCount: r.chunk_count });
          anySuccess = true;
          onUploaded(); // refresh the documents table progressively
        } else {
          setStatus(entry.id, { status: "error", error: r?.error ?? "导入失败" });
        }
      } catch (e) {
        setStatus(entry.id, { status: "error", error: e instanceof Error ? e.message : "导入失败" });
      }
    }
    setUploading(false);
    if (anySuccess) onUploaded();
  };

  const total = entries.length;
  const processed = entries.filter((e) => e.status === "success" || e.status === "error").length;
  const pendingCount = entries.filter((e) => e.status === "pending" || e.status === "error").length;
  const hasError = entries.some((e) => e.status === "error");
  const allDone = total > 0 && entries.every((e) => e.status === "success");

  return (
    <Modal
      open
      title="上传文档"
      onClose={onClose}
      widthClass="max-w-2xl"
      footer={
        <>
          <button className={btn.ghost} onClick={onClose}>
            {allDone ? "完成" : "关闭"}
          </button>
          <button
            className={`${btn.primary} flex items-center gap-2`}
            disabled={uploading || pendingCount === 0}
            onClick={submit}
          >
            {uploading && <Loader2 size={16} className="animate-spin" />}
            {uploading
              ? `上传中 ${processed}/${total}`
              : hasError
                ? `重试未成功 (${pendingCount})`
                : `上传 (${pendingCount})`}
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

      {total > 0 && (
        <ul className="mt-3 space-y-1">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50"
            >
              <FileIcon ext={"." + (e.file.name.split(".").pop() ?? "")} />
              <span className="flex-1 truncate" title={e.file.name}>
                {e.file.name}
              </span>
              <StatusBadge entry={e} />
              <span className="w-16 shrink-0 text-right text-xs text-slate-400">
                {formatSize(e.file.size)}
              </span>
              {!uploading && e.status !== "processing" && (
                <button
                  onClick={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
                  className="text-slate-400 hover:text-rose-500"
                  title="移除"
                >
                  <X size={15} />
                </button>
              )}
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
    </Modal>
  );
}

function StatusBadge({ entry }: { entry: Entry }) {
  switch (entry.status) {
    case "pending":
      return (
        <span className="flex items-center gap-1 text-xs text-slate-400">
          <Clock size={14} /> 待上传
        </span>
      );
    case "processing":
      return (
        <span className="flex items-center gap-1 text-xs text-indigo-500">
          <Loader2 size={14} className="animate-spin" /> 导入中…
        </span>
      );
    case "success":
      return (
        <span className="flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 size={14} /> {entry.chunkCount} 分块
        </span>
      );
    case "error":
      return (
        <span className="flex items-center gap-1 text-xs text-rose-600" title={entry.error}>
          <XCircle size={14} /> <span className="max-w-[10rem] truncate">{entry.error}</span>
        </span>
      );
  }
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
