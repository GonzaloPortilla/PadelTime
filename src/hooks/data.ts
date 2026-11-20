import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Category, ScoringTemplate, Season } from "@shared/types";
import { api } from "@/lib/api";

export const keys = {
  categories: ["categories"] as const,
  seasons: ["seasons"] as const,
  players: ["players"] as const,
  tournaments: ["tournaments"] as const,
  dashboard: ["dashboard"] as const,
  users: ["users"] as const,
  templates: ["scoring-templates"] as const,
  rankings: ["rankings"] as const,
  movements: ["movements"] as const,
  tournament: (id: number | string) => ["tournaments", "detail", String(id)] as const,
};

export function useTemplates() {
  return useQuery({
    queryKey: keys.templates,
    queryFn: async () => (await api.get<{ items: ScoringTemplate[] }>("/scoring-templates")).items,
    staleTime: 60_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: keys.categories,
    queryFn: async () => (await api.get<{ items: Category[] }>("/categories")).items,
    staleTime: 60_000,
  });
}

export function useSeasons() {
  return useQuery({
    queryKey: keys.seasons,
    queryFn: async () => (await api.get<{ items: Season[] }>("/seasons")).items,
    staleTime: 60_000,
  });
}

/** Debounce de un valor (para búsquedas mientras se escribe). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
