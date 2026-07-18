import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2, User } from "lucide-react";
import {
  deleteOwnerProfile,
  fetchOwnerProfile,
  updateOwnerProfile,
  type ProfileRow,
} from "../../lib/api";
import { Modal, btn, input } from "../../components/Modal";
import { formatDateTime } from "../../lib/format";

export function ProfileTab({ ownerKey }: { ownerKey: string }) {
  const qc = useQueryClient();
  const { data: profile, isLoading } = useQuery({
    queryKey: ["owner-profile", ownerKey],
    queryFn: () => fetchOwnerProfile(ownerKey),
  });

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["owner-profile", ownerKey] });
    qc.invalidateQueries({ queryKey: ["owners"] });
  };

  if (isLoading)
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );

  if (!profile)
    return (
      <div className="rounded-xl border border-dashed border-slate-300 py-16 text-center text-slate-400 dark:border-slate-700">
        <p className="mb-3">该 owner 暂无画像</p>
        <button
          onClick={() => setEditing(true)}
          className={`${btn.primary} inline-flex items-center gap-2`}
        >
          <Plus size={16} /> 新建画像
        </button>
        {editing && (
          <ProfileEditModal
            ownerKey={ownerKey}
            profile={null}
            onClose={() => setEditing(false)}
            onSaved={() => {
              refresh();
              setEditing(false);
            }}
          />
        )}
      </div>
    );

  const profileObj = safeParseJson(profile.profile_json);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
            <User size={20} />
          </span>
          <div>
            <h2 className="font-medium">
              {profile.nickname || "(未命名)"}
            </h2>
            <p className="text-xs text-slate-500">
              更新于 {formatDateTime(profile.updated_at)}
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            title="编辑画像"
            onClick={() => setEditing(true)}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Pencil size={15} />
          </button>
          <button
            title="删除画像"
            onClick={() => setDeleting(true)}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {Object.keys(profileObj).length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm text-slate-400 dark:border-slate-700">
          profile_json 为空对象，点击编辑添加键值。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.entries(profileObj).map(([key, value]) => (
            <div
              key={key}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <dt className="text-xs text-slate-500">{key}</dt>
              <dd className="mt-1 break-all text-sm">
                {typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value)}
              </dd>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ProfileEditModal
          ownerKey={ownerKey}
          profile={profile}
          onClose={() => setEditing(false)}
          onSaved={() => {
            refresh();
            setEditing(false);
          }}
        />
      )}
      {deleting && (
        <ProfileDeleteModal
          ownerKey={ownerKey}
          onClose={() => setDeleting(false)}
          onDeleted={() => {
            refresh();
            setDeleting(false);
          }}
        />
      )}
    </div>
  );
}

/** 编辑画像弹窗 — 整条覆盖（决策 D3）。 */
function ProfileEditModal({
  ownerKey,
  profile,
  onClose,
  onSaved,
}: {
  ownerKey: string;
  profile: ProfileRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nickname, setNickname] = useState(profile?.nickname ?? "");
  const [jsonText, setJsonText] = useState(
    profile ? prettyJson(profile.profile_json) : "{\n  \n}",
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      // 提交前 JSON.parse 校验
      let profilePatch: Record<string, unknown> | undefined;
      const trimmed = jsonText.trim();
      if (trimmed) {
        try {
          profilePatch = JSON.parse(trimmed);
        } catch {
          setJsonError("profile_json 不是合法的 JSON");
          throw new Error("JSON 校验失败"); // 阻止提交
        }
        if (typeof profilePatch !== "object" || Array.isArray(profilePatch)) {
          setJsonError("profile_json 必须是 JSON 对象");
          throw new Error("类型校验失败");
        }
      }
      setJsonError(null);
      return updateOwnerProfile(ownerKey, {
        nickname: nickname.trim() || undefined,
        profile_patch: profilePatch,
      });
    },
    onSuccess: onSaved,
  });

  return (
    <Modal
      open
      title={profile ? "编辑画像" : "新建画像"}
      onClose={onClose}
      widthClass="max-w-xl"
      footer={
        <>
          <button type="button" className={btn.ghost} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={`${btn.primary} flex items-center gap-2`}
            disabled={mutation.isPending}
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
          <label className="mb-1 block text-sm font-medium">昵称</label>
          <input
            className={input}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="可选"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            profile_json（编辑即整条覆盖，删单个键请删整条画像后重建）
          </label>
          <textarea
            className={`${input} min-h-[200px] resize-y font-mono text-xs`}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
            }}
            spellCheck={false}
          />
        </div>
        {jsonError && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950/50">
            {jsonError}
          </p>
        )}
        {mutation.error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950/50">
            {(mutation.error as Error).message}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** 删除画像弹窗。 */
function ProfileDeleteModal({
  ownerKey,
  onClose,
  onDeleted,
}: {
  ownerKey: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const mutation = useMutation({
    mutationFn: () => deleteOwnerProfile(ownerKey),
    onSuccess: onDeleted,
  });

  return (
    <Modal
      open
      title="删除画像"
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
        确定删除该 owner 的整条画像？此操作不可恢复。
      </p>
    </Modal>
  );
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const obj = JSON.parse(raw);
    return typeof obj === "object" && obj !== null && !Array.isArray(obj)
      ? obj
      : {};
  } catch {
    return {};
  }
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
