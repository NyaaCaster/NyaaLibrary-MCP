import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchOwnerMemory } from "../lib/api";

export function OwnerDetailPage() {
  const { ownerKey } = useParams<{ ownerKey: string }>();
  const decoded = decodeURIComponent(ownerKey ?? "");

  const { data, isLoading, error } = useQuery({
    queryKey: ["owner-memory", decoded],
    queryFn: () => fetchOwnerMemory(decoded),
    enabled: !!decoded,
  });

  return (
    <div>
      <Link
        to="/owners"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600"
      >
        <ArrowLeft size={14} /> 返回 owner 列表
      </Link>

      <div className="mb-5">
        <h1 className="text-xl font-semibold break-all">{decoded}</h1>
        <p className="text-sm text-slate-500">
          {data ? `${data.length} 条记忆条目` : "加载中…"}
        </p>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16 text-slate-400">
          <Loader2 className="animate-spin" />
        </div>
      )}
      {error && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:bg-rose-950/50">
          {(error as Error).message}
        </p>
      )}

      {data && data.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 py-16 text-center text-slate-400 dark:border-slate-700">
          该 owner 暂无记忆条目。
        </div>
      )}

      {data && data.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="px-5 py-3 text-sm text-slate-500">
            记忆条目列表（Tab 界面将在 P5 实现）
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.map((entry) => (
              <div key={entry.id} className="px-5 py-3">
                <p className="line-clamp-2 text-sm">{entry.content}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {entry.char_count} 字符 · salience {entry.salience} ·{" "}
                  {new Date(entry.created_at).toLocaleDateString("zh-CN")}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
