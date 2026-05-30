import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { api, type KnowledgeBase } from "../lib/api";
import { formatDateTime } from "../lib/format";

type Tab = "overview" | "documents" | "retrieval" | "settings";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "概述" },
  { key: "documents", label: "文档管理" },
  { key: "retrieval", label: "知识库检索" },
  { key: "settings", label: "设置" },
];

export function KbDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("overview");
  const { data: kb, isLoading } = useQuery({
    queryKey: ["kb", id],
    queryFn: () => api.get<KnowledgeBase>(`/kb/${id}`),
    enabled: Boolean(id),
  });

  if (isLoading)
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (!kb) return <p className="text-rose-600">知识库不存在</p>;

  return (
    <div>
      <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600">
        <ArrowLeft size={15} /> 返回
      </Link>
      <h1 className="text-xl font-semibold">{kb.name}</h1>

      <div className="mt-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
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
        {tab === "overview" ? <Overview kb={kb} /> : <ComingSoon />}
      </div>
    </div>
  );
}

function Overview({ kb }: { kb: KnowledgeBase }) {
  const Field = ({ label, value }: { label: string; value: string }) => (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{value || "—"}</dd>
    </div>
  );
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
          基本信息
        </h2>
        <dl className="space-y-3">
          <Field label="名称" value={kb.name} />
          <Field label="描述" value={kb.description} />
          <Field label="创建时间" value={formatDateTime(kb.created_at)} />
          <Field label="更新时间" value={formatDateTime(kb.updated_at)} />
        </dl>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
          统计信息
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
            <div className="text-2xl font-semibold">{kb.document_count}</div>
            <div className="text-xs text-slate-500">文档数量</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
            <div className="text-2xl font-semibold">{kb.chunk_count}</div>
            <div className="text-xs text-slate-500">分块数量</div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ComingSoon() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 py-16 text-center text-sm text-slate-400 dark:border-slate-700">
      该功能将在后续里程碑（M2 / M3）实现。
    </div>
  );
}
