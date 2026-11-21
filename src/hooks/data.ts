import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Category, ScoringTemplate, Season, TournamentEvent } from "@shared/types";
import type { Gender } from "@shared/constants";
import type { SiteSettings } from "@shared/site";
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
  site: ["site"] as const,
  events: ["events"] as const,
  fixture: (id: number | string) => ["fixture", String(id)] as const,
};

/** Datos de la web pública (WhatsApp, sede, aviso, ramas activas). */
export function useSiteSettings() {
  return useQuery({
    queryKey: keys.site,
    queryFn: async () => (await api.get<{ settings: SiteSettings }>("/site")).settings,
    staleTime: 60_000,
  });
}

/** Ramas habilitadas para nuevas altas. Damas está discontinuada: sus datos se conservan, pero no se crean nuevos. */
export function useActiveGenders(): Gender[] {
  const site = useSiteSettings();
  return site.data?.activeGenders ?? ["M"];
}

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

/** Eventos con varias categorías (Fase 9). */
export function useEvents(seasonId?: number | string | null) {
  return useQuery({
    queryKey: [...keys.events, "list", String(seasonId ?? "")],
    queryFn: async () => (await api.get<{ items: TournamentEvent[] }>(`/events${seasonId ? `?seasonId=${seasonId}` : ""}`)).items,
    staleTime: 30_000,
  });
}
