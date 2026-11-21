import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, EyeOff, Send } from "lucide-react";
import type { FixtureState } from "@shared/fixture";
import type { Tournament } from "@shared/types";
import { api } from "@/lib/api";
import { keys } from "@/hooks/data";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Card, ErrorState, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { ErrorNote, fx, useFixtureMutation, type FxCtx } from "./common";
import { ConfigPanel, GroupsPanel } from "./SetupPanels";
import { BracketsPanel, HistoryPanel, IssuesPanel, MatchesPanel, StandingsPanel } from "./PlayPanels";
import { PointsPanel } from "./PointsPanel";

type Sub = "config" | "grupos" | "partidos" | "posiciones" | "copas" | "puntos" | "problemas" | "historial";

/**
 * Fixture de un torneo largo (Fase 9). Todo se guarda al instante; la web pública muestra sólo lo
 * publicado, así que el organizador decide cuándo "Publicar" los cambios.
 */
export function FixtureTab({ tournament, onGoToCredit }: { tournament: Tournament; onGoToCredit?: () => void }) {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: keys.fixture(tournament.id),
    queryFn: async () => (await api.get<{ item: FixtureState }>(`/tournaments/${tournament.id}/fixture`)).item,
  });
  const [sub, setSub] = useState<Sub | null>(null);
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;
  const state = q.data;
  const ctx: FxCtx = { tid: tournament.id, state, readOnly: !!state.locked, isAdmin: user?.role === "admin" };
  const isGroups = state.config.format === "grupos_copas";
  const errors = state.issues.filter((i) => i.level === "error").length;
  const tabs: { key: Sub; label: string; show: boolean }[] = [
    { key: "config", label: "Configuración", show: true },
    { key: "grupos", label: isGroups ? "Grupos y parejas" : "Parejas", show: true },
    { key: "partidos", label: "Partidos", show: true },
    { key: "posiciones", label: "Posiciones", show: isGroups },
    { key: "copas", label: isGroups ? "Copa de Oro / Plata" : "Cuadro", show: true },
    { key: "puntos", label: state.final.complete && !state.final.applied ? "Puntos •" : "Puntos", show: true },
    { key: "problemas", label: `Problemas${state.issues.length ? ` (${state.issues.length})` : ""}`, show: true },
    { key: "historial", label: "Historial", show: true },
  ];
  // Pestaña inicial según el avance del fixture.
  const current: Sub = sub ?? (state.final.complete ? "puntos" : !state.matches.length ? (state.groups.length || !isGroups ? "copas" : "grupos") : "partidos");

  return (
    <div className="space-y-4">
      <PublishBar ctx={ctx} />
      {state.locked && <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">{state.locked}</p>}
      {errors > 0 && current !== "problemas" && (
        <button type="button" onClick={() => setSub("problemas")} className="flex w-full items-center gap-2 rounded-lg bg-red-50 p-3 text-left text-sm text-red-700 ring-1 ring-inset ring-red-200">
          <AlertTriangle className="size-4 shrink-0" /> Hay {errors} problema{errors === 1 ? "" : "s"} para resolver (conflictos de resultados o empates). Ver detalle.
        </button>
      )}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Secciones del fixture">
        <div className="flex gap-1.5">
          {tabs.filter((t) => t.show).map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={current === t.key} onClick={() => setSub(t.key)}
              className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition-colors",
                current === t.key ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-600 ring-slate-300 hover:bg-brand-50")}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {current === "config" && <ConfigPanel key={state.version} ctx={ctx} />}
      {current === "grupos" && <GroupsPanel ctx={ctx} />}
      {current === "partidos" && <MatchesPanel ctx={ctx} />}
      {current === "posiciones" && <StandingsPanel ctx={ctx} />}
      {current === "copas" && <BracketsPanel ctx={ctx} />}
      {current === "puntos" && <PointsPanel ctx={ctx} onGoToCredit={onGoToCredit} />}
      {current === "problemas" && <IssuesPanel ctx={ctx} />}
      {current === "historial" && <HistoryPanel ctx={ctx} />}
    </div>
  );
}

function PublishBar({ ctx }: { ctx: FxCtx }) {
  const { state } = ctx;
  const [confirmHide, setConfirmHide] = useState(false);
  const publish = useFixtureMutation(ctx.tid, (body: unknown) => fx.post(ctx.tid, "/publish", body), "Fixture publicado en la web");
  const hide = useFixtureMutation(ctx.tid, (body: unknown) => fx.del(ctx.tid, "/publish", body), "Fixture quitado de la web");
  const pub = state.publication;
  const dirty = pub ? state.version > pub.fixtureVersion : false;
  const when = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <Card className="p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 text-sm">
          {pub ? (
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone="green">Publicado</Badge>
              <span className="text-slate-600">el {when(pub.publishedAt)}{pub.publishedByName ? ` por ${pub.publishedByName}` : ""}</span>
              {dirty && <Badge tone="amber">Hay cambios sin publicar</Badge>}
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-2"><Badge tone="gray">No publicado</Badge><span className="text-slate-600">La web todavía no muestra este fixture.</span></p>
          )}
          {!state.tournament.publicVisible && <p className="mt-1 text-xs text-amber-700">El torneo no está marcado «Publicar en la web» (Editar datos): el fixture no se verá hasta activarlo.</p>}
        </div>
        {!ctx.readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button icon={<Send className="size-4" />} loading={publish.isPending} disabled={!state.matches.length || (!!pub && !dirty)} onClick={() => publish.mutate({ version: state.version })}>
              {pub ? "Publicar cambios" : "Publicar"}
            </Button>
            {pub && <Button variant="secondary" icon={<EyeOff className="size-4" />} onClick={() => setConfirmHide(true)}>Quitar de la web</Button>}
            {pub && state.tournament.publicVisible && <a href={`${state.tournament.path}#fixture`} target="_blank" rel="noopener"><Button variant="ghost" icon={<ExternalLink className="size-4" />}>Ver</Button></a>}
          </div>
        )}
      </div>
      {(publish.error || hide.error) && (
        <div className="mt-3"><ErrorNote message={publish.error ?? hide.error} /></div>
      )}
      <ConfirmDialog open={confirmHide} onClose={() => setConfirmHide(false)} title="Quitar el fixture de la web" message="La página del torneo deja de mostrar grupos, partidos y cuadros. En el panel no se pierde nada."
        confirmLabel="Quitar" onConfirm={() => hide.mutateAsync({ version: state.version })} />
    </Card>
  );
}
