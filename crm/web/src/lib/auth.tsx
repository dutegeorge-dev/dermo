/** Текущий пользователь и вход/выход. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from "react";

import { api, ApiError, setCsrfToken, setUnauthorizedHandler } from "./api.ts";
import type { User } from "./types.ts";

type MeResponse = { user: User; csrfToken: string };

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        const data = await api<MeResponse>("/auth/me");
        setCsrfToken(data.csrfToken);
        return data.user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: Infinity,
    retry: 1,
  });

  const reset = useCallback(() => {
    setCsrfToken(null);
    // Пользователь — null, остальной кэш (данные прошлой сессии) выбрасываем.
    queryClient.setQueryData(["me"], null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(reset);
    return () => setUnauthorizedHandler(null);
  }, [reset]);

  const value = useMemo<AuthState>(
    () => ({
      user: me.data ?? null,
      loading: me.isLoading,
      async login(login, password) {
        const data = await api<MeResponse>("/auth/login", { method: "POST", body: { login, password } });
        setCsrfToken(data.csrfToken);
        queryClient.setQueryData(["me"], data.user);
      },
      async logout() {
        try {
          await api("/auth/logout", { method: "POST" });
        } finally {
          reset();
        }
      },
      setUser(user) {
        queryClient.setQueryData(["me"], user);
      },
    }),
    [me.data, me.isLoading, queryClient, reset],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth вне AuthProvider");
  return ctx;
}
