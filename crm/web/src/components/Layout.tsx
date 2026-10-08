/** Каркас: постоянный сайдбар слева, сверху — глобальный поиск. */

import { type ReactNode, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";

import { BASE } from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { useTheme } from "../lib/theme.ts";
import { GlobalSearch } from "./GlobalSearch.tsx";
import {
  IconBoard,
  IconBook,
  IconBuilding,
  IconHistory,
  IconLogout,
  IconMenu,
  IconMoon,
  IconPhone,
  IconSun,
  IconUser,
  IconUsers,
  IconX,
} from "./Icons.tsx";

const ROLE_NAMES = { admin: "Администратор", manager: "Менеджер" } as const;

function NavItem({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm ${
          isActive
            ? "bg-accent-soft font-medium text-accent dark:bg-accent/20 dark:text-accent-bright"
            : "text-slate-700 hover:bg-slate-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
        }`
      }
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

function Sidebar({ onClose }: { onClose?: () => void }) {
  const { user, logout } = useAuth();
  const [theme, toggleTheme] = useTheme();
  if (!user) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-4">
        <Link to="/" className="flex items-center gap-2.5">
          <img src={`${BASE}/logo-mark.png`} alt="" className="h-7 w-auto dark:hidden" />
          <img src={`${BASE}/logo-mark-on-brand.png`} alt="" className="hidden h-7 w-auto dark:block" />
          <span className="leading-tight">
            <span className="block text-sm font-semibold">ТЛК БАРС</span>
            <span className="block text-[11px] muted">Внутренний раздел</span>
          </span>
        </Link>
        {onClose && (
          <button type="button" className="icon-btn lg:hidden" onClick={onClose} aria-label="Закрыть меню">
            <IconX />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2" aria-label="Разделы">
        <NavItem to="/kb" icon={<IconBook />}>
          База знаний
        </NavItem>
        <NavItem to="/calls" icon={<IconPhone />}>
          Справочник для звонков
        </NavItem>
        <div className="px-2.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-neutral-500">CRM</div>
        <NavItem to="/deals" icon={<IconBoard />}>
          Сделки
        </NavItem>
        <NavItem to="/clients" icon={<IconBuilding />}>
          Клиенты
        </NavItem>
      </nav>

      <div className="space-y-0.5 border-t border-slate-200 px-2 py-2 dark:border-neutral-800">
        {user.role === "admin" && (
          <>
            <NavItem to="/users" icon={<IconUsers />}>
              Пользователи
            </NavItem>
            <NavItem to="/audit" icon={<IconHistory />}>
              Журнал действий
            </NavItem>
          </>
        )}
        <NavItem to="/profile" icon={<IconUser />}>
          <span className="block truncate">{user.name}</span>
        </NavItem>
        <div className="flex items-center justify-between px-1 pt-1">
          <span className="px-1.5 text-[11px] muted">{ROLE_NAMES[user.role]}</span>
          <span className="flex">
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
              aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            >
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </button>
            <button type="button" className="icon-btn" onClick={() => void logout()} title="Выйти" aria-label="Выйти">
              <IconLogout />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-slate-200 bg-slate-50 lg:block dark:border-neutral-800 dark:bg-neutral-950">
        <Sidebar />
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-slate-200 bg-slate-50 shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
            <Sidebar onClose={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur sm:px-5 dark:border-neutral-800 dark:bg-neutral-900/95">
          <button type="button" className="icon-btn lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Меню">
            <IconMenu size={18} />
          </button>
          <GlobalSearch />
        </header>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Обычная колонка контента. */
export function Content({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={`mx-auto w-full ${wide ? "max-w-6xl" : "max-w-4xl"} px-4 py-6 sm:px-8`}>{children}</div>;
}
