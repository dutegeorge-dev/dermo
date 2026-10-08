const dateTime = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dateTime.format(new Date(value));
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return dateOnly.format(new Date(value));
}

/** «5 минут назад», «вчера», иначе дата. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} ${plural(Math.floor(diff / 60), "минуту", "минуты", "минут")} назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ${plural(Math.floor(diff / 3600), "час", "часа", "часов")} назад`;
  if (diff < 2 * 86400) return "вчера";
  return formatDate(date);
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
