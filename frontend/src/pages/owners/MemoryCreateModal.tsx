import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createOwnerMemory } from "../../lib/api";
import { Modal, btn, input } from "../../components/Modal";

export function MemoryCreateModal({
  ownerKey,
  onClose,
  onCreated,
}: {
  ownerKey: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [content, setContent] = useState("");
  const [salienceStr, setSalienceStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const salience =
    salienceStr.trim() !== "" ? Number(salienceStr) : undefined;

  const submit = async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await createOwnerMemory(
        ownerKey,
        trimmed,
        Number.isFinite(salience) ? salience : undefined,
      );
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="补充记忆"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn.ghost} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={`${btn.primary} flex items-center gap-2`}
            disabled={!content.trim() || busy}
            onClick={submit}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            提交
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">
            记忆内容 <span className="text-rose-500">*</span>
          </label>
          <textarea
            className={`${input} min-h-[120px] resize-y`}
            placeholder="输入记忆条目的文本内容…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            Salience（可选，0–1 之间的数值）
          </label>
          <input
            className={input}
            type="number"
            min="0"
            max="1"
            step="0.1"
            placeholder="0"
            value={salienceStr}
            onChange={(e) => setSalienceStr(e.target.value)}
          />
        </div>
        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950/50">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
