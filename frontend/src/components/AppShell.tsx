import { Link, Outlet, useNavigate } from "react-router-dom";
import { Library, LogOut } from "lucide-react";
import { clearSession, getUsername } from "../lib/auth";
import { APP_NAME } from "../version";
import { ThemeToggle } from "./ThemeToggle";

export function AppShell() {
  const navigate = useNavigate();
  const username = getUsername();

  const logout = () => {
    clearSession();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-full flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-white">
              <Library size={18} />
            </span>
            <span className="hidden sm:inline">{APP_NAME}</span>
          </Link>
          <div className="flex-1" />
          <ThemeToggle />
          <button
            type="button"
            onClick={logout}
            title={username ? `退出登录（${username}）` : "退出登录"}
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-300 dark:hover:bg-rose-950/50"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
