import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { api, type AppConfig, type KnowledgeBase } from "../../lib/api";
import { btn, input } from "../../components/Modal";

interface Hit {
  chunk_id: number;
  doc_id: string;
  document_name: string;
  seq: number;
  content: string;
  char_count: number;
  score: number;
}

export function RetrievalTab({ kb }: { kb: KnowledgeBase }) {
  const { data: cfg } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.get<AppConfig>("/config"),
  });

  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ count: number; results: Hit[] } | null>(null);

  const effectiveTopK = topK ?? cfg?.retrieval.topK ?? 5;

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    try {
      const r = await api.post<{ count: number; results: Hit[] }>(
        `/kb/${kb.id}/search`,
        { query: query.trim(), top_k: effectiveTopK },
      );
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "检索失败");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        <div>
          <label className="mb-1 block text-sm font-medium">检索内容</label>
          <textarea
            className={`${input} min-h-[120px] resize-y`}
            placeholder="输入查询内容，测试知识库检索效果…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            返回结果数量
            <span className="ml-2 text-xs font-normal text-slate-400">
              最多返回多少条检索结果
            </span>
          </label>
          <input
            type="number"
            min={1}
            max={50}
            className={input}
            value={effectiveTopK}
            onChange={(e) => setTopK(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          />
        </div>
        <button
          onClick={run}
          disabled={loading || !query.trim()}
          className={`${btn.primary} flex w-full items-center justify-center gap-2`}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          检索
        </button>
        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950/40">
            {error}
          </p>
        )}
      </div>

      <div className="lg:col-span-3">
        {result ? (
          <>
            <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
              检索结果（{result.count} 条）
            </h3>
            {result.count === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-400 dark:border-slate-700">
                未检索到相关内容
              </p>
            ) : (
              <ul className="space-y-3">
                {result.results.map((h, i) => (
                  <li
                    key={h.chunk_id}
                    className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                        #{i + 1}
                      </span>
                      <span className="text-slate-500">文本块 #{h.seq}</span>
                      <span className="truncate text-slate-500">{h.document_name}</span>
                      <span className="text-slate-400">{h.char_count} 字符</span>
                      <span className="ml-auto font-medium text-emerald-600">
                        相关度分数 {h.score.toFixed(4)}
                      </span>
                    </div>
                    <textarea
                      readOnly
                      value={h.content}
                      className="h-28 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-2 text-sm dark:border-slate-700 dark:bg-slate-800/50"
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-400 dark:border-slate-700">
            使用稠密检索与稀疏检索测试知识库内容
          </div>
        )}
      </div>
    </div>
  );
}
