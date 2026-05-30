import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { FileText, Layers, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { api, type KnowledgeBase } from "../lib/api";
import { Modal, btn, input } from "../components/Modal";

export function KnowledgeBasesPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["kbs"],
    queryFn: () => api.get<KnowledgeBase[]>("/kb"),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeBase | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["kbs"] });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">知识库</h1>
          <p className="text-sm text-slate-500">管理用于 LLM 检索的知识库</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className={`${btn.primary} flex items-center gap-2`}
        >
          <Plus size={16} /> 创建知识库
        </button>
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
          还没有知识库，点击「创建知识库」开始。
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((kb) => (
          <div
            key={kb.id}
            className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 transition hover:border-indigo-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-2">
              <Link to={`/kb/${kb.id}`} className="min-w-0 flex-1">
                <h3 className="truncate font-medium hover:text-indigo-600">
                  {kb.name}
                </h3>
                <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-slate-500">
                  {kb.description || "（无描述）"}
                </p>
              </Link>
              <div className="flex shrink-0 gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                <button
                  type="button"
                  title="重命名"
                  onClick={() => setEditing(kb)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  title="删除"
                  onClick={() => setDeleting(kb)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            <div className="mt-4 flex gap-4 text-sm text-slate-500">
              <span className="flex items-center gap-1">
                <FileText size={14} /> {kb.document_count} 文档
              </span>
              <span className="flex items-center gap-1">
                <Layers size={14} /> {kb.chunk_count} 分块
              </span>
            </div>
          </div>
        ))}
      </div>

      {createOpen && (
        <KbFormModal
          title="创建知识库"
          onClose={() => setCreateOpen(false)}
          onSubmit={async (name, description) => {
            await api.post("/kb", { name, description });
            refresh();
            setCreateOpen(false);
          }}
        />
      )}

      {editing && (
        <KbFormModal
          title="重命名知识库"
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={async (name, description) => {
            await api.patch(`/kb/${editing.id}`, { name, description });
            refresh();
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <DeleteKbModal
          kb={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            refresh();
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function KbFormModal({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: KnowledgeBase;
  onClose: () => void;
  onSubmit: (name: string, description: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const mutation = useMutation({
    mutationFn: () => onSubmit(name.trim(), description.trim()),
  });

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn.ghost} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={`${btn.primary} flex items-center gap-2`}
            disabled={!name.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
            保存
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">名称</label>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">描述</label>
          <textarea
            className={`${input} min-h-[80px] resize-y`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {mutation.error && (
          <p className="text-sm text-rose-600">{(mutation.error as Error).message}</p>
        )}
      </div>
    </Modal>
  );
}

function DeleteKbModal({
  kb,
  onClose,
  onDone,
}: {
  kb: KnowledgeBase;
  onClose: () => void;
  onDone: () => void;
}) {
  const mutation = useMutation({
    mutationFn: () => api.del(`/kb/${kb.id}`),
    onSuccess: onDone,
  });
  return (
    <Modal
      open
      title="删除知识库"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btn.ghost} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={`${btn.danger} flex items-center gap-2`}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
            确认删除
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">
        确定删除知识库「<span className="font-medium">{kb.name}</span>」？
        其下 {kb.document_count} 个文档与 {kb.chunk_count} 个分块将一并永久删除，此操作不可恢复。
      </p>
    </Modal>
  );
}
