import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { MemoryTab } from "./owners/MemoryTab";
import { ProfileTab } from "./owners/ProfileTab";

type Tab = "memory" | "profile";

const TABS: { key: Tab; label: string }[] = [
  { key: "memory", label: "记忆条目" },
  { key: "profile", label: "用户画像" },
];

export function OwnerDetailPage() {
  const { ownerKey } = useParams<{ ownerKey: string }>();
  const decoded = decodeURIComponent(ownerKey ?? "");
  const [tab, setTab] = useState<Tab>("memory");

  if (!decoded) return <p className="text-rose-600">缺少 owner 标识</p>;

  return (
    <div>
      <Link
        to="/owners"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600"
      >
        <ArrowLeft size={15} /> 返回
      </Link>
      <h1 className="text-xl font-semibold break-all">{decoded}</h1>

      <div className="mt-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="py-5">
        {tab === "memory" && <MemoryTab ownerKey={decoded} />}
        {tab === "profile" && <ProfileTab ownerKey={decoded} />}
      </div>
    </div>
  );
}
