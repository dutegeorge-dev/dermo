/** Пользователи (только admin): создание, роли, отключение, сброс пароля. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { IconPlus } from "../components/Icons.tsx";
import { Content } from "../components/Layout.tsx";
import { ErrorBox, Modal, PageHeader, Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { formatRelative } from "../lib/format.ts";
import type { Role, UserRow } from "../lib/types.ts";

const ROLE_NAMES: Record<Role, string> = { admin: "Администратор", manager: "Менеджер" };

/** Случайный пароль для выдачи сотруднику. */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

function UserDialog({ user, onClose }: { user?: UserRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [login, setLogin] = useState(user?.login ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "manager");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [password, setPassword] = useState(user ? "" : generatePassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const self = user?.id === me?.id;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (user) {
        await api(`/users/${user.id}`, { method: "PATCH", body: { name, email, role, isActive, password } });
      } else {
        await api("/users", { method: "POST", body: { name, login, email, role, password } });
      }
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal title={user ? `Пользователь ${user.login}` : "Новый пользователь"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="u-name">Имя и фамилия</label>
          <input id="u-name" className="input" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {!user && (
          <div>
            <label className="label" htmlFor="u-login">Логин</label>
            <input
              id="u-login"
              className="input"
              required
              autoCapitalize="none"
              spellCheck={false}
              value={login}
              onChange={(e) => setLogin(e.target.value.toLowerCase())}
              placeholder="ivanov"
            />
          </div>
        )}
        <div>
          <label className="label" htmlFor="u-email">E-mail (необязательно)</label>
          <input id="u-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="u-role">Роль</label>
            <select id="u-role" className="input" value={role} disabled={self} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="manager">Менеджер</option>
              <option value="admin">Администратор</option>
            </select>
          </div>
          {user && (
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} disabled={self} onChange={(e) => setIsActive(e.target.checked)} />
              Доступ включён
            </label>
          )}
        </div>
        <div>
          <label className="label" htmlFor="u-pass">{user ? "Новый пароль (пусто — не менять)" : "Пароль"}</label>
          <div className="flex gap-2">
            <input
              id="u-pass"
              className="input font-mono"
              value={password}
              required={!user}
              minLength={8}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="btn" onClick={() => setPassword(generatePassword())}>
              Сгенерировать
            </button>
          </div>
          {password && <p className="mt-1 text-xs muted">Передайте пароль сотруднику — после входа он сможет сменить его в профиле.</p>}
        </div>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{user ? "Сохранить" : "Создать"}</button>
        </div>
      </form>
    </Modal>
  );
}

export function UsersPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: () => api<{ users: UserRow[] }>("/users"),
  });
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);

  return (
    <Content>
      <PageHeader
        title="Пользователи"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            <IconPlus size={14} /> Пользователь
          </button>
        }
      />
      {isLoading && <Spinner />}
      <ErrorBox error={error} />
      {data && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs muted dark:border-neutral-800">
                <th className="px-4 py-2 font-medium">Имя</th>
                <th className="px-4 py-2 font-medium">Логин</th>
                <th className="px-4 py-2 font-medium">Роль</th>
                <th className="px-4 py-2 font-medium">Последний вход</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-neutral-800">
              {data.users.map((u) => (
                <tr
                  key={u.id}
                  className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-neutral-800/50 ${u.isActive ? "" : "text-slate-400 dark:text-neutral-500"}`}
                  onClick={() => setEditing(u)}
                >
                  <td className="px-4 py-2">
                    {u.name}
                    {!u.isActive && <span className="ml-2 text-xs">(отключён)</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{u.login}</td>
                  <td className="px-4 py-2">{ROLE_NAMES[u.role]}</td>
                  <td className="px-4 py-2 text-xs muted">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : "не входил"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <UserDialog user={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </Content>
  );
}
