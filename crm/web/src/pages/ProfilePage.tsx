/** Профиль: имя, e-mail, смена пароля. */

import { useState } from "react";

import { Content } from "../components/Layout.tsx";
import { ErrorBox, PageHeader } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import type { User } from "../lib/types.ts";

export function ProfilePage() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [profileState, setProfileState] = useState<{ ok?: boolean; error?: unknown }>({});

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [passState, setPassState] = useState<{ ok?: boolean; error?: unknown }>({});

  if (!user) return null;

  return (
    <Content>
      <PageHeader title="Профиль" meta={`Логин: ${user.login}`} />
      <div className="grid gap-8 md:grid-cols-2">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setProfileState({});
            try {
              const res = await api<{ user: User }>("/auth/profile", { method: "PATCH", body: { name, email } });
              setUser(res.user);
              setProfileState({ ok: true });
            } catch (error) {
              setProfileState({ error });
            }
          }}
        >
          <h2 className="text-sm font-semibold">Данные</h2>
          <div>
            <label className="label" htmlFor="p-name">Имя и фамилия</label>
            <input id="p-name" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="p-email">E-mail</label>
            <input id="p-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <ErrorBox error={profileState.error} />
          {profileState.ok && <p className="text-sm text-green-700 dark:text-green-400">Сохранено</p>}
          <button type="submit" className="btn btn-primary">Сохранить</button>
        </form>

        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setPassState({});
            if (next !== repeat) {
              setPassState({ error: new Error("Новые пароли не совпадают") });
              return;
            }
            try {
              await api("/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
              setCurrent("");
              setNext("");
              setRepeat("");
              setPassState({ ok: true });
            } catch (error) {
              setPassState({ error });
            }
          }}
        >
          <h2 className="text-sm font-semibold">Смена пароля</h2>
          <div>
            <label className="label" htmlFor="p-cur">Текущий пароль</label>
            <input id="p-cur" type="password" className="input" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="p-new">Новый пароль (от 8 символов)</label>
            <input id="p-new" type="password" className="input" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="p-rep">Повторите новый пароль</label>
            <input id="p-rep" type="password" className="input" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </div>
          <ErrorBox error={passState.error} />
          {passState.ok && <p className="text-sm text-green-700 dark:text-green-400">Пароль изменён. Остальные сеансы завершены.</p>}
          <button type="submit" className="btn btn-primary">Сменить пароль</button>
        </form>
      </div>
    </Content>
  );
}
