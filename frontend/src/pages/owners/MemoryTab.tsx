import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, Plus, Search, X } from "lucide-react";
import { fetchOwnerMemory, type MemoryEntryRow } from "../../lib/api";
import { btn, input } from "../../components/Modal";
import { Pagination } from "../../components/Pagination";
import { SortHeader } from "../../components/SortHeader";
import { useSort } from "../../lib/useSort";
import { formatDateTime } from "../../lib/format";
import { MemoryDetailModal } from "./MemoryDetailModal";
import { MemoryCreateModal } from "./MemoryCreateModal";

const PAGE_SIZE = 10;

type MemKey = "content" | "char_count" | "salience" | "created_at";

const accessors: Record<MemKey, (m: MemoryEntryRow) => string | number> = {
  content: (m) => m.content,
  char_count: (m) => m.char_count,
  salience: (m) => m.salience,
  created_at: (m) => m.created_at,
};

export function MemoryTab({ ownerKey }: { ownerKey: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["owner-memory", ownerKey],
    queryFn: () => fetchOwnerMemory(ownerKey),
  });

  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<MemoryEntryRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = data ?? [];
    return q ? rows.filter((m) => m.content.toLowerCase().includes(q)) : rows;
  }, [data, filter]);

  const { sorted, sort } = useSort<MemoryEntryRow, MemKey>(
    filtered,
    accessors,
    "created_at",
    "desc",
  );
  const total = sorted.length;
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["owner-memory", ownerKey] });
    qc.invalidateQueries({ queryKey: ["owners"] });
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setCreateOpen(true)}
          className={`${btn.primary} flex items-center gap-2`}
        >
          <Plus size={16} /> 补充记忆
        </button>
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            className={`${input} pl-9 pr-9`}
            placeholder="搜索记忆…"
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
          {filter ? "无匹配记忆条目" : "该 owner 暂无记忆条目，点击「补充记忆」添加。"}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/50">
                <tr>
                  <SortHeader label="内容摘要" sortKey="content" sort={sort} />
                  <SortHeader
                    label="字符数"
                    sortKey="char_count"
                    sort={sort}
                    className="w-24"
                  />
                  <SortHeader
                    label="Salience"
                    sortKey="salience"
                    sort={sort}
                    className="w-24"
                  />
                  <SortHeader
                    label="创建时间"
                    sortKey="created_at"
                    sort={sort}
                    className="w-36"
                  />
                  <th className="w-16 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pageItems.map((m) => (
                  <tr
                    key={m.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="max-w-xs truncate px-3 py-2">
                      {m.content}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {m.char_count}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {m.salience.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {formatDateTime(m.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        title="查看详情"
                        onClick={() => setViewing(m)}
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
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              onChange={setPage}
            />
          </div>
        </>
      )}

      {viewing && (
        <MemoryDetailModal
          entry={viewing}
          ownerKey={ownerKey}
          onClose={() => setViewing(null)}
          onDeleted={refresh}
        />
      )}
      {createOpen && (
        <MemoryCreateModal
          ownerKey={ownerKey}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            refresh();
            setCreateOpen(false);
          }}
        />
      )}
    </div>
  );
}
