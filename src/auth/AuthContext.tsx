import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionUser } from "@shared/types";
import { api, setUnauthorizedHandler } from "@/lib/api";

interface AuthValue {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
const ME_KEY = ["auth", "me"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      return (await api.get<{ user: SessionUser | null }>("/auth/me")).user;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    // Si cualquier llamada devuelve 401, la sesión venció: se limpia todo y se vuelve al login.
    setUnauthorizedHandler(() => {
      qc.setQueryData(ME_KEY, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  const value: AuthValue = {
    user: me.data ?? null,
    loading: me.isPending,
    async login(username, password) {
      const { user } = await api.post<{ user: SessionUser }>("/auth/login", { username, password });
      qc.setQueryData(ME_KEY, user);
    },
    async logout() {
      try {
        await api.post("/auth/logout");
      } finally {
        // Primero se marca la sesión como cerrada (el observer de "me" sigue vivo)
        // y después se descartan los datos cacheados del resto de la app.
        qc.setQueryData(ME_KEY, null);
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
      }
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}
