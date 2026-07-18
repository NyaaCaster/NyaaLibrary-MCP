import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { deleteOwnerMemory, type MemoryEntryRow } from "../../lib/api";
import { Modal, btn } from "../../components/Modal";
import { formatDateTime } from "../../lib/format";

export function MemoryDetailModal({
  entry,
  ownerKey,
  onClose,
  onDeleted,
}: {
  entry: MemoryEntryRow;
  ownerKey: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteOwnerMemory(ownerKey, entry.id);
      onDeleted();
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal open title="记忆条目详情" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Info label="字符数" value={`${entry.char_count} 字符`} />
          <Info label="Salience" value={entry.salience.toFixed(1)} />
          <Info label="创建时间" value={formatDateTime(entry.created_at)} />
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-500">内容</div>
          <textarea
            readOnly
            value={entry.content}
            className="h-48 w-full resize-none rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50"
          />
        </div>
        <div className="flex justify-end pt-1">
          {confirming ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">确认删除该记忆条目？</span>
              <button
                className={btn.ghost}
                onClick={() => setConfirming(false)}
              >
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
              <Trash2 size={15} /> 删除记忆条目
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 break-all text-sm">{value}</div>
    </div>
  );
}
