import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, type KnowledgeBase } from "../../lib/api";
import { btn, input } from "../../components/Modal";

export function SettingsTab({ kb }: { kb: KnowledgeBase }) {
  const qc = useQueryClient();
  const [chunkSize, setChunkSize] = useState(kb.chunk_size);
  const [chunkOverlap, setChunkOverlap] = useState(kb.chunk_overlap);
  const [denseTopK, setDenseTopK] = useState(kb.dense_top_k);
  const [sparseTopK, setSparseTopK] = useState(kb.sparse_top_k);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.patch(`/kb/${kb.id}`, {
        chunk_size: chunkSize,
        chunk_overlap: Math.min(chunkOverlap, chunkSize - 1),
        dense_top_k: denseTopK,
        sparse_top_k: sparseTopK,
      });
      qc.invalidateQueries({ queryKey: ["kb", kb.id] });
      qc.invalidateQueries({ queryKey: ["kbs"] });
      setMsg({ ok: true, text: "设置已保存" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <Section title="基本设置" hint="分块设置仅影响此后新上传的文档">
        <Num label="分块大小" hint="每个文本块的字符数" value={chunkSize} min={1} onChange={setChunkSize} />
        <Num label="分块重叠" hint="相邻文本块之间的重叠字符数" value={chunkOverlap} min={0} onChange={setChunkOverlap} />
      </Section>

      <Section title="检索设置" hint="混合检索的召回数量">
        <Num label="稠密检索数量" hint="向量检索召回条数" value={denseTopK} min={1} onChange={setDenseTopK} />
        <Num label="稀疏检索数量" hint="BM25 检索召回条数" value={sparseTopK} min={1} onChange={setSparseTopK} />
      </Section>

      {msg && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            msg.ok
              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"
              : "bg-rose-50 text-rose-600 dark:bg-rose-950/40"
          }`}
        >
          {msg.text}
        </p>
      )}

      <div className="flex justify-end">
        <button className={`${btn.primary} flex items-center gap-2`} disabled={saving} onClick={save}>
          {saving && <Loader2 size={16} className="animate-spin" />}
          保存设置
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 p-5 dark:border-slate-800">
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-xs text-slate-400">{hint}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Num({
  label,
  hint,
  value,
  min,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <span className="ml-1 block text-xs text-slate-400">{hint}</span>
      <input
        type="number"
        min={min}
        className={`${input} mt-1`}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
      />
    </label>
  );
}
