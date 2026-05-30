import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

interface PaginationProps {
  page: number; // 1-based
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

/** Page controls with a "from-to of total" position counter. */
export function Pagination({ page, pageSize, total, onChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  const btn =
    "grid h-8 w-8 place-items-center rounded-lg text-slate-500 enabled:hover:bg-slate-100 disabled:opacity-30 dark:enabled:hover:bg-slate-800";

  return (
    <div className="flex items-center justify-end gap-2 text-sm text-slate-500">
      <span>
        {from}-{to} of {total}
      </span>
      <div className="flex gap-0.5">
        <button className={btn} disabled={current <= 1} onClick={() => onChange(1)} title="首页">
          <ChevronsLeft size={16} />
        </button>
        <button className={btn} disabled={current <= 1} onClick={() => onChange(current - 1)} title="上一页">
          <ChevronLeft size={16} />
        </button>
        <button className={btn} disabled={current >= pages} onClick={() => onChange(current + 1)} title="下一页">
          <ChevronRight size={16} />
        </button>
        <button className={btn} disabled={current >= pages} onClick={() => onChange(pages)} title="尾页">
          <ChevronsRight size={16} />
        </button>
      </div>
    </div>
  );
}
