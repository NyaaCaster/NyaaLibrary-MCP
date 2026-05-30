import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { api, type ChunkRow } from "../../lib/api";
import { Modal, btn } from "../../components/Modal";

export function ChunkDetailModal({
  chunkId,
  onClose,
  onDeleted,
}: {
  chunkId: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { data: chunk, isLoading } = useQuery({
    queryKey: ["chunk", chunkId],
    queryFn: () => api.get<ChunkRow>(`/chunks/${chunkId}`),
  });
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await api.del(`/chunks/${chunkId}`);
      onDeleted();
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal open title="分块详情" onClose={onClose}>
      {isLoading || !chunk ? (
        <div className="flex justify-center py-8 text-slate-400">
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Info label="分块序号" value={`#${chunk.seq}`} />
            <Info label="字符数" value={`${chunk.char_count} 字符`} />
          </div>
          <Info label="向量 ID" value={chunk.vector_id} mono />
          <div>
            <div className="mb-1 text-xs text-slate-500">分块内容</div>
            <textarea
              readOnly
              value={chunk.content}
              className="h-48 w-full resize-none rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50"
            />
          </div>
          <div className="flex justify-end pt-1">
            {confirming ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500">确认删除该分块？</span>
                <button className={btn.ghost} onClick={() => setConfirming(false)}>
                  取消
                </button>
                <button
                  className={`${btn.danger} flex items-center gap-1`}
                  disabled={deleting}
                  onClick={remove}
                >
                  {deleting && <Loader2 size={14} className="animate-spin" />}
                  确认
                </button>
              </div>
            ) : (
              <button
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                onClick={() => setConfirming(true)}
              >
                <Trash2 size={15} /> 删除分块
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 break-all text-sm ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </div>
    </div>
  );
}
