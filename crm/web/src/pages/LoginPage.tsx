import { useState } from "react";

import { ErrorBox } from "../components/ui.tsx";
import { BASE } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";

export function LoginPage() {
  const { login } = useAuth();
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-neutral-950">
      <form
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await login(loginName, password);
          } catch (err) {
            setError(err);
            setBusy(false);
          }
        }}
      >
        <div className="mb-6 flex items-center gap-3">
          <img src={`${BASE}/logo-mark.png`} alt="" className="h-9 w-auto dark:hidden" />
          <img src={`${BASE}/logo-mark-on-brand.png`} alt="" className="hidden h-9 w-auto dark:block" />
          <div>
            <h1 className="text-base font-semibold">ТЛК БАРС</h1>
            <p className="text-xs muted">Внутренний раздел для сотрудников</p>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="login">Логин</label>
            <input
              id="login"
              className="input"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Пароль</label>
            <input
              id="password"
              type="password"
              className="input"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <ErrorBox error={error} />
          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
        </div>
        <p className="mt-4 text-center text-xs muted">Нет доступа или забыли пароль — обратитесь к администратору.</p>
      </form>
    </div>
  );
}
