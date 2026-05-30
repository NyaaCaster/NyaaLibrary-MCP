import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2 } from "lucide-react";
import { api, type ChunkRow, type DocumentRow } from "../../lib/api";
import { Modal } from "../../components/Modal";
import { Pagination } from "../../components/Pagination";
import { FileIcon } from "../../components/FileIcon";
import { formatDateTime, formatSize } from "../../lib/format";
import { ChunkDetailModal } from "./ChunkDetailModal";

const PAGE_SIZE = 10;

export function DocumentDetailModal({
  doc,
  onClose,
  onChanged,
}: {
  doc: DocumentRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [openChunk, setOpenChunk] = useState<number | null>(null);

  const { data: chunks, isLoading } = useQuery({
    queryKey: ["chunks", doc.id],
    queryFn: () => api.get<ChunkRow[]>(`/documents/${doc.id}/chunks`),
  });

  const refreshChunks = () => {
    qc.invalidateQueries({ queryKey: ["chunks", doc.id] });
    onChanged();
  };

  const total = chunks?.length ?? 0;
  const pageItems = (chunks ?? []).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Modal open title="文档详情" onClose={onClose} widthClass="max-w-3xl">
      <section className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-800/50 sm:grid-cols-5">
        <Info label="文档名称" value={doc.name} icon={<FileIcon ext={doc.ext} />} wide />
        <Info label="格式" value={doc.ext} />
        <Info label="大小" value={formatSize(doc.size_bytes)} />
        <Info label="分块数" value={String(doc.chunk_count)} />
        <Info label="上传时间" value={formatDateTime(doc.uploaded_at)} />
      </section>

      <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
        分块列表
      </h3>
      {isLoading ? (
        <div className="flex justify-center py-8 text-slate-400">
          <Loader2 className="animate-spin" />
        </div>
      ) : total === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">（无分块）</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/50">
                <tr>
                  <th className="w-16 px-3 py-2 text-left font-medium">序号</th>
                  <th className="px-3 py-2 text-left font-medium">分块内容</th>
                  <th className="w-20 px-3 py-2 text-left font-medium">字符数</th>
                  <th className="w-14 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pageItems.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-2 text-slate-500">#{c.seq}</td>
                    <td className="truncate px-3 py-2" title={c.content}>
                      {c.content}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{c.char_count}</td>
                    <td className="px-3 py-2">
                      <button
                        title="查看分块"
                        onClick={() => setOpenChunk(c.id)}
                        className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                      >
                        <Eye size={15} />
                      </button>
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

      {openChunk !== null && (
        <ChunkDetailModal
          chunkId={openChunk}
          onClose={() => setOpenChunk(null)}
          onDeleted={refreshChunks}
        />
      )}
    </Modal>
  );
}

function Info({
  label,
  value,
  icon,
  wide,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-1" : ""}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 flex items-center gap-1 truncate" title={value}>
        {icon}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}
