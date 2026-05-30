import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Wand2 } from "lucide-react";
import { api } from "../lib/api";
import { btn, input } from "../components/Modal";

interface MaskedSettings {
  base_url: string;
  model: string;
  dim: number;
  api_key_set: boolean;
}

export function EmbeddingSettingsPage() {
  const navigate = useNavigate();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keySet, setKeySet] = useState(false);
  const [model, setModel] = useState("");
  const [dim, setDim] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .get<MaskedSettings>("/embedding/settings")
      .then((s) => {
        setBaseUrl(s.base_url);
        setModel(s.model);
        setDim(s.dim ? String(s.dim) : "");
        setKeySet(s.api_key_set);
      })
      .catch((e) => setMessage({ ok: false, text: (e as Error).message }))
      .finally(() => setLoading(false));
  }, []);

  const payload = () => ({
    base_url: baseUrl.trim(),
    model: model.trim(),
    dim: dim ? Number(dim) : 0,
    ...(apiKey ? { api_key: apiKey } : {}),
  });

  const detectDim = async () => {
    setDetecting(true);
    setMessage(null);
    try {
      const { dim: d } = await api.post<{ dim: number }>(
        "/embedding/detect-dim",
        payload(),
      );
      setDim(String(d));
      setMessage({ ok: true, text: `已获取嵌入维度：${d}` });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setDetecting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api.put("/embedding/settings", payload());
      setApiKey("");
      setKeySet(true);
      setMessage({ ok: true, text: "设置已保存" });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );

  return (
    <div className="mx-auto max-w-xl">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600"
      >
        <ArrowLeft size={15} /> 返回
      </button>
      <h1 className="text-xl font-semibold">嵌入模型设置</h1>
      <p className="text-sm text-slate-500">配置 OpenAI 兼容的嵌入接口</p>

      <div className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <Field label="API Base URL">
          <input
            className={input}
            placeholder="https://api.example.com/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>
        <Field label="API Key">
          <input
            type="password"
            className={input}
            placeholder={keySet ? "已设置（留空则不修改）" : "sk-..."}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>
        <Field label="模型名称">
          <input
            className={input}
            placeholder="text-embedding-3-small"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </Field>
        <Field label="嵌入维度" hint="嵌入向量的维度">
          <div className="flex gap-2">
            <input
              className={input}
              value={dim}
              onChange={(e) => setDim(e.target.value.replace(/\D/g, ""))}
            />
            <button
              type="button"
              onClick={detectDim}
              disabled={detecting}
              className={`${btn.ghost} flex shrink-0 items-center gap-1 border border-slate-300 dark:border-slate-700`}
            >
              {detecting ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Wand2 size={15} />
              )}
              自动获取
            </button>
          </div>
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
            注意：更改嵌入维度会重建向量库，已索引的向量将失效，需重新上传文档。
          </p>
        </Field>

        {message && (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              message.ok
                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"
                : "bg-rose-50 text-rose-600 dark:bg-rose-950/40"
            }`}
          >
            {message.text}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btn.ghost} onClick={() => navigate(-1)}>
            取消
          </button>
          <button
            type="button"
            className={`${btn.primary} flex items-center gap-2`}
            disabled={saving}
            onClick={save}
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}
        {hint && <span className="ml-2 text-xs font-normal text-slate-400">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
