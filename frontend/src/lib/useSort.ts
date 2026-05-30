import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
  toggle: (key: K) => void;
}

/**
 * Client-side sorting for small tables. Clicking the active column flips the
 * direction; clicking a new column selects it ascending.
 */
export function useSort<T, K extends string>(
  rows: T[],
  accessors: Record<K, (row: T) => string | number>,
  initialKey: K,
  initialDir: SortDir = "asc",
): { sorted: T[]; sort: SortState<K> } {
  const [key, setKey] = useState<K>(initialKey);
  const [dir, setDir] = useState<SortDir>(initialDir);

  const toggle = (k: K) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir("asc");
    }
  };

  const sorted = useMemo(() => {
    const get = accessors[key];
    const factor = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv), "zh") * factor;
    });
  }, [rows, key, dir, accessors]);

  return { sorted, sort: { key, dir, toggle } };
}
