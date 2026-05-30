import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { api, type DocumentRow, type KnowledgeBase } from "../../lib/api";
import { Modal, btn, input } from "../../components/Modal";
import { Pagination } from "../../components/Pagination";
import { FileIcon } from "../../components/FileIcon";
import { SortHeader } from "../../components/SortHeader";
import { useSort } from "../../lib/useSort";
import { formatDateTime, formatSize } from "../../lib/format";
import { UploadModal } from "./UploadModal";
import { DocumentDetailModal } from "./DocumentDetailModal";

const PAGE_SIZE = 10;

type DocKey = "name" | "ext" | "size_bytes" | "chunk_count" | "uploaded_at";

const accessors: Record<DocKey, (d: DocumentRow) => string | number> = {
  name: (d) => d.name,
  ext: (d) => d.ext,
  size_bytes: (d) => d.size_bytes,
  chunk_count: (d) => d.chunk_count,
  uploaded_at: (d) => d.uploaded_at,
};

export function DocumentsTab({ kb }: { kb: KnowledgeBase }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["documents", kb.id],
    queryFn: () => api.get<DocumentRow[]>(`/kb/${kb.id}/documents`),
  });

  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewing, setViewing] = useState<DocumentRow | null>(null);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = data ?? [];
    return q ? rows.filter((d) => d.name.toLowerCase().includes(q)) : rows;
  }, [data, filter]);

  const { sorted, sort } = useSort<DocumentRow, DocKey>(
    filtered,
    accessors,
    "uploaded_at",
    "desc",
  );
  const total = sorted.length;
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["documents", kb.id] });
    qc.invalidateQueries({ queryKey: ["kb", kb.id] });
    qc.invalidateQueries({ queryKey: ["kbs"] });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setUploadOpen(true)}
          className={`${btn.primary} flex items-center gap-2`}
        >
          <Plus size={16} /> 上传文档
        </button>
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={`${input} pl-9 pr-9`}
            placeholder="搜索文档…"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          />
          {filter && (
            <button
              title="取消筛选"
              onClick={() => setFilter("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12 text-slate-400">
          <Loader2 className="animate-spin" />
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-400 dark:border-slate-700">
          {filter ? "无匹配文档" : "还没有文档，点击「上传文档」开始。"}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/50">
                <tr>
                  <SortHeader label="文档名称" sortKey="name" sort={sort} />
                  <SortHeader label="格式" sortKey="ext" sort={sort} className="w-24" />
                  <SortHeader label="大小" sortKey="size_bytes" sort={sort} className="w-28" />
                  <SortHeader label="分块数" sortKey="chunk_count" sort={sort} className="w-24" />
                  <SortHeader label="上传时间" sortKey="uploaded_at" sort={sort} className="w-36" />
                  <th className="w-20 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pageItems.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setViewing(d)}
                        className="flex max-w-full items-center gap-2 hover:text-indigo-600"
                        title={d.name}
                      >
                        <FileIcon ext={d.ext} />
                        <span className="truncate">{d.name}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{d.ext}</td>
                    <td className="px-3 py-2 text-slate-500">{formatSize(d.size_bytes)}</td>
                    <td className="px-3 py-2 text-slate-500">{d.chunk_count}</td>
                    <td className="px-3 py-2 text-slate-500">{formatDateTime(d.uploaded_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          title="查看文档"
                          onClick={() => setViewing(d)}
                          className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          title="删除文档"
                          onClick={() => setDeleting(d)}
                          className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3">
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
          </div>
        </>
      )}

      {uploadOpen && (
        <UploadModal
          kb={kb}
          onClose={() => setUploadOpen(false)}
          onUploaded={refresh}
        />
      )}
      {viewing && (
        <DocumentDetailModal doc={viewing} onClose={() => setViewing(null)} onChanged={refresh} />
      )}
      {deleting && (
        <DeleteDocModal doc={deleting} onClose={() => setDeleting(null)} onDone={() => { refresh(); setDeleting(null); }} />
      )}
    </div>
  );
}

function DeleteDocModal({
  doc,
  onClose,
  onDone,
}: {
  doc: DocumentRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/documents/${doc.id}`);
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="删除文档"
      onClose={onClose}
      footer={
        <>
          <button className={btn.ghost} onClick={onClose}>
            取消
          </button>
          <button className={`${btn.danger} flex items-center gap-2`} disabled={busy} onClick={remove}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            确认删除
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">
        确定删除文档「<span className="font-medium">{doc.name}</span>」？
        其 {doc.chunk_count} 个分块与向量将一并永久删除。
      </p>
    </Modal>
  );
}
