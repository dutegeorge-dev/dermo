/** Подключён ли ИИ на сервере (ключ в crm/.env). Без него кнопки ИИ не показываем. */

import { useQuery } from "@tanstack/react-query";

import { api } from "./api.ts";

export function useAiEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ["ai", "status"],
    queryFn: () => api<{ enabled: boolean }>("/ai/status"),
    staleTime: Infinity,
  });
  return data?.enabled ?? false;
}
