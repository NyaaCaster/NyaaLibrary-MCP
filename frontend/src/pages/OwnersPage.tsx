import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Brain, Loader2, MessageSquare, User } from "lucide-react";
import { fetchOwners, type OwnerSummary } from "../lib/api";

export function OwnersPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["owners"],
    queryFn: fetchOwners,
  });

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">猫猫记忆</h1>
        <p className="text-sm text-slate-500">
          浏览猫猫为每个用户沉淀的记忆条目与画像
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
          还没有任何记忆数据，等猫猫开始沉淀后这里会出现内容。
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((owner) => (
          <OwnerCard key={owner.owner_key} owner={owner} />
        ))}
      </div>
    </div>
  );
}

function OwnerCard({ owner }: { owner: OwnerSummary }) {
  return (
    <Link
      to={`/owners/${encodeURIComponent(owner.owner_key)}`}
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
          <Brain size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium group-hover:text-indigo-600">
            {owner.nickname || owner.owner_key}
          </h3>
          {owner.nickname && (
            <p className="truncate text-xs text-slate-400">{owner.owner_key}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
        <span className="flex items-center gap-1">
          <MessageSquare size={14} /> {owner.memory_count} 条记忆
        </span>
        <span className="flex items-center gap-1">
          <User size={14} /> {owner.has_profile ? "有画像" : "无画像"}
        </span>
      </div>
    </Link>
  );
}
