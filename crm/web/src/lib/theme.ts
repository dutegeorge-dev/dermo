import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(current);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("crm-theme", next);
      } catch {
        /* приватный режим — тема просто не запомнится */
      }
      return next;
    });
  }, []);
  return [theme, toggle];
}
