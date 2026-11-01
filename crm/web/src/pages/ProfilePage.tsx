/** Профиль: имя, e-mail, смена пароля, привязка Telegram к боту заявок. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
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

        <TelegramBlock />
      </div>
    </Content>
  );
}

type TelegramState = { enabled: boolean; bot: string | null; linked: boolean };

/** Бот заявок: сотрудник привязывает свой Telegram и шлёт боту тексты заявок — они становятся лидами в воронке. */
function TelegramBlock() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["telegram"], queryFn: () => api<TelegramState>("/auth/telegram") });
  const [link, setLink] = useState<{ code: string; url: string | null; expiresInMin: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const data = state.data;

  return (
    <section className="space-y-3 md:col-span-2">
      <h2 className="text-sm font-semibold">Бот заявок в Telegram</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Перешлите боту письмо или сообщение клиента — он заведёт лид в воронке: найдёт клиента в базе или создаст
        нового, добавит контакт и определит тип заявки. Исполнитель — вы.
      </p>
      {state.isLoading && <p className="text-sm text-slate-500">Загрузка…</p>}
      {data && !data.enabled && <p className="text-sm text-slate-500">Бот не подключён (нет токена на сервере).</p>}
      {data?.enabled && data.linked && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-green-700 dark:text-green-400">
            ✓ Telegram привязан{data.bot && <> — пишите боту <a className="link" href={`https://t.me/${data.bot}`} target="_blank" rel="noreferrer">@{data.bot}</a></>}
          </span>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              setError(null);
              try {
                await api("/auth/telegram", { method: "DELETE" });
                setLink(null);
                await qc.invalidateQueries({ queryKey: ["telegram"] });
              } catch (e) {
                setError(e);
              }
            }}
          >
            Отвязать
          </button>
        </div>
      )}
      {data?.enabled && !data.linked && (
        <div className="space-y-2">
          {!link ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                setError(null);
                try {
                  setLink(await api("/auth/telegram/link", { method: "POST" }));
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Привязать Telegram
            </button>
          ) : (
            <div className="space-y-2 text-sm">
              {link.url ? (
                <p>
                  <a className="btn btn-primary" href={link.url} target="_blank" rel="noreferrer">Открыть бота в Telegram</a>{" "}
                  и нажмите «Старт». Или отправьте боту код <b className="font-mono">{link.code}</b>.
                </p>
              ) : (
                <p>Отправьте боту код <b className="font-mono">{link.code}</b>.</p>
              )}
              <p className="text-slate-500">Код действует {link.expiresInMin} минут.</p>
              <button type="button" className="btn" onClick={() => qc.invalidateQueries({ queryKey: ["telegram"] })}>Я привязал — проверить</button>
            </div>
          )}
        </div>
      )}
      <ErrorBox error={error} />
    </section>
  );
}
