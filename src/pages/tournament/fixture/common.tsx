import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FixtureMatchRow, FixtureState, SlotSource } from "@shared/fixture";
import { ApiError, api } from "@/lib/api";
import { keys } from "@/hooks/data";
import { useToast } from "@/components/ui/Toast";

/** Contexto común de las piezas del fixture. */
export interface FxCtx {
  tid: number;
  state: FixtureState;
  readOnly: boolean;
  isAdmin: boolean;
}

export const teamName = (s: FixtureState, id: number | null) => (id === null ? "A definir" : s.teams.find((t) => t.id === id)?.name ?? `Pareja ${id}`);
export const groupOf = (s: FixtureState, id: number | null) => s.groups.find((g) => g.id === id);

export function sourceLabel(s: FixtureState, src: SlotSource | null): string {
  if (!src) return "—";
  if (src.kind === "bye") return "Pase libre (BYE)";
  if (src.kind === "pareja") return teamName(s, src.teamId);
  const g = groupOf(s, src.groupId);
  return `${src.position}° Grupo ${g?.name ?? "?"}`;
}

export const fmtDay = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");
export const scoreLabel = (m: Pick<FixtureMatchRow, "status" | "sets">) => {
  if (m.status === "wo") return "W.O.";
  if (m.status === "bye") return "BYE";
  const s = m.sets.map(([a, b]) => `${a}-${b}`).join(" ");
  if (m.status === "retiro") return `${s} (ret.)`.trim();
  if (m.status === "administrativo") return s ? `${s} (adm.)` : "Adm.";
  return s;
};

/**
 * Mutación del fixture: cada respuesta trae el estado completo y actualizado, que reemplaza al de la caché.
 * Ante un 409 (otro organizador modificó algo) se recarga el estado y se muestra el aviso.
 */
export function useFixtureMutation<B>(tid: number, request: (body: B) => Promise<{ item: FixtureState }>, success?: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: request,
    onMutate: () => setError(null),
    onSuccess: ({ item }) => {
      qc.setQueryData(keys.fixture(tid), item);
      void qc.invalidateQueries({ queryKey: keys.tournaments });
      if (success) toast(success);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : "Ocurrió un error inesperado");
      if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: keys.fixture(tid) });
    },
  });
  return { ...m, error, setError };
}

export const fx = {
  put: (tid: number, path: string, body: unknown) => api.put<{ item: FixtureState }>(`/tournaments/${tid}/fixture${path}`, body),
  post: (tid: number, path: string, body: unknown) => api.post<{ item: FixtureState }>(`/tournaments/${tid}/fixture${path}`, body),
  del: (tid: number, path: string, body: unknown) => api.delete<{ item: FixtureState }>(`/tournaments/${tid}/fixture${path}`, body),
};

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">{message}</p>;
}
