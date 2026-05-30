import { ChevronDown, ChevronUp } from "lucide-react";
import type { SortDir, SortState } from "../lib/useSort";

interface SortHeaderProps<K extends string> {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  className?: string;
}

/** A clickable table header cell that toggles sorting for its column. */
export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  className = "",
}: SortHeaderProps<K>) {
  const active = sort.key === sortKey;
  const dir: SortDir = sort.dir;
  return (
    <th className={`px-3 py-2 text-left font-medium ${className}`}>
      <button
        type="button"
        onClick={() => sort.toggle(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 ${
          active ? "text-slate-900 dark:text-slate-100" : ""
        }`}
      >
        {label}
        {active &&
          (dir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
      </button>
    </th>
  );
}
