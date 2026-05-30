import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Library, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { saveSession } from "../lib/auth";
import { btn, input } from "../components/Modal";
import { APP_NAME } from "../version";

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { token } = await api.post<{ token: string; username: string }>(
        "/auth/login",
        { username, password },
        false,
      );
      saveSession(token, username);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center bg-slate-50 px-4 dark:bg-slate-950">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-600 text-white">
            <Library size={24} />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {APP_NAME}
            </h1>
            <p className="text-sm text-slate-500">知识库管理控制台</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              账号
            </label>
            <input
              className={input}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              密码
            </label>
            <input
              type="password"
              className={input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950/50">
            {error}
          </p>
        )}

        <button type="submit" disabled={loading} className={`${btn.primary} mt-6 flex w-full items-center justify-center gap-2`}>
          {loading && <Loader2 size={16} className="animate-spin" />}
          登录
        </button>
      </form>
    </div>
  );
}
