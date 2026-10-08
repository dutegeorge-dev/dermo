/** Общие элементы CRM: плашка этапа, справочники, хуки данных. */

import { useQuery } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";

import { textOn } from "../../../../shared/deal-fields.ts";
import { api } from "../../lib/api.ts";
import type { DirectoryUser, Stage } from "../../lib/types.ts";

export function useStages() {
  return useQuery({ queryKey: ["stages"], queryFn: () => api<{ stages: Stage[] }>("/stages"), staleTime: 60_000 });
}

export function useDirectory() {
  return useQuery({
    queryKey: ["users", "directory"],
    queryFn: () => api<{ users: DirectoryUser[] }>("/users/directory"),
    staleTime: 5 * 60_000,
  });
}

/** Цветная плашка-стрелка этапа (как в воронке). */
export function StageChip({
  stage,
  children,
  className = "",
  dim = false,
  style,
}: {
  stage: Pick<Stage, "color" | "name">;
  children?: ReactNode;
  className?: string;
  dim?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`inline-flex min-w-0 items-center truncate py-1 pl-2.5 pr-4 text-xs font-medium ${className}`}
      style={{
        background: dim ? "transparent" : stage.color,
        color: dim ? undefined : textOn(stage.color),
        boxShadow: dim ? `inset 0 0 0 1px ${stage.color}` : undefined,
        clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%)",
        borderRadius: "4px 0 0 4px",
        ...style,
      }}
      title={stage.name}
    >
      <span className="truncate">{children ?? stage.name}</span>
    </span>
  );
}

export function isOverdue(date: string | null, closed: boolean): boolean {
  if (!date || closed) return false;
  return date < new Date().toISOString().slice(0, 10);
}

export function formatShortDate(date: string | null): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  const now = new Date();
  const label = new Date(y, m - 1, d).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  return y === now.getFullYear() ? label.replace(".", "") : `${label} ${y}`;
}

export function initials(name: string | null): string {
  if (!name) return "—";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function Avatar({ name }: { name: string | null }) {
  return (
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-700 dark:bg-neutral-700 dark:text-neutral-200"
      title={name ?? "Не назначен"}
    >
      {initials(name)}
    </span>
  );
}
