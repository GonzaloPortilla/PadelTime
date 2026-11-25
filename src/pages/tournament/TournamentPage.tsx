import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, MapPin, Pencil, Plus, ShieldCheck, Trash2, Trophy, Users } from "lucide-react";
import { GENDER_LABEL, TOURNAMENT_STATUS_LABEL, TOURNAMENT_TRANSITIONS, type TournamentStatus } from "@shared/constants";
import type { Tournament } from "@shared/types";
import { api } from "@/lib/api";
import { formatRange } from "@/lib/format";
import { keys } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Card, CardHeader, ErrorState, Spinner } from "@/components/ui/misc";
import { GenderBadge, TournamentStatusBadge, TournamentTypeBadge } from "@/components/ui/badges";
import { TournamentForm } from "@/components/forms/TournamentForm";
import { TorneoForm } from "@/components/forms/TorneoForm";
import type { TournamentEvent } from "@shared/types";
import { tournamentPath } from "@shared/site";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { TeamsTab } from "./TeamsTab";
import { ScoringTab } from "./ScoringTab";
import { CreditTab } from "./CreditTab";
import { ImportTab } from "./import/ImportTab";
import { FixtureTab } from "./fixture/FixtureTab";

const TABS = [
  { key: "resumen", label: "Resumen" },
  { key: "parejas", label: "Parejas y resultados" },
  { key: "fixture", label: "Fixture" },
  { key: "importar", label: "Importar cuadro" },
  { key: "puntuacion", label: "Puntuación" },
  { key: "acreditacion", label: "Acreditación" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const TRANSITION_LABEL: Record<TournamentStatus, string> = {
  programado: "Volver a programado",
  en_curso: "Iniciar torneo",
  finalizado: "Finalizar",
  cancelado: "Cancelar torneo",
};

function Summary({ t, onTab }: { t: Tournament; onTab: (k: TabKey) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [pendingStatus, setPendingStatus] = useState<TournamentStatus | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.tournaments });
    void qc.invalidateQueries({ queryKey: keys.dashboard });
    void qc.invalidateQueries({ queryKey: keys.seasons });
  };
  const setStatus = useMutation({
    mutationFn: (status: TournamentStatus) => api.patch<{ item: Tournament }>(`/tournaments/${t.id}/status`, { status }),
    onSuccess: ({ item }) => {
      invalidate();
      toast(`${item.name}: ${TOURNAMENT_STATUS_LABEL[item.status]}`);
    },
  });
  const locked = t.seasonStatus === "cerrada";
  const credited = t.creditedVersion !== null;
  const canDelete = !locked && (t.status === "programado" || t.status === "cancelado") && t.teamCount === 0;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Datos del torneo" />
        <dl className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <div className="flex gap-3"><Trophy className="mt-0.5 size-4 text-slate-400" /><div><dt className="text-xs text-slate-500">Categoría</dt><dd className="text-sm font-medium">{t.categoryName} {GENDER_LABEL[t.gender]}{t.divisionName ? ` · División ${t.divisionName}` : ""}</dd></div></div>
          <div className="flex gap-3"><CalendarDays className="mt-0.5 size-4 text-slate-400" /><div><dt className="text-xs text-slate-500">{t.type === "americano" ? "Fecha" : "Fechas"}</dt><dd className="text-sm font-medium">{formatRange(t.startDate, t.endDate)}</dd></div></div>
          <div className="flex gap-3"><MapPin className="mt-0.5 size-4 text-slate-400" /><div><dt className="text-xs text-slate-500">Sede</dt><dd className="text-sm font-medium">{t.venue ?? "—"}</dd></div></div>
          <div className="flex gap-3"><Users className="mt-0.5 size-4 text-slate-400" /><div><dt className="text-xs text-slate-500">Parejas inscriptas</dt><dd className="text-sm font-medium">{t.teamCount}</dd></div></div>
          {t.notes && <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-600 sm:col-span-2">{t.notes}</p>}
        </dl>
        {canDelete && (
          <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
            <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>
              Eliminar esta categoría
            </Button>
          </div>
        )}
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Estado" />
          <div className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap gap-2"><TournamentStatusBadge status={t.status} />{credited && <Badge tone="green"><ShieldCheck className="size-3" />Acreditado v{t.creditedVersion}</Badge>}{t.publicVisible ? <a href={tournamentPath(t)} target="_blank" rel="noopener"><Badge tone="blue">En la web ↗</Badge></a> : <Badge tone="gray">No publicado en la web</Badge>}</div>
            {locked ? (
              <p className="text-sm text-slate-500">La temporada {t.seasonName} está cerrada: el torneo es de sólo lectura.</p>
            ) : credited ? (
              <p className="text-sm text-slate-500">Con puntos acreditados el estado queda fijo. Para cambiarlo, revertí la acreditación.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {TOURNAMENT_TRANSITIONS[t.status].map((s) => (
                  <Button key={s} size="sm" variant={s === "cancelado" ? "ghost" : s === "programado" ? "secondary" : "primary"}
                    loading={setStatus.isPending && setStatus.variables === s}
                    onClick={() => (s === "cancelado" || s === "finalizado" ? setPendingStatus(s) : setStatus.mutate(s))}>
                    {t.status === "finalizado" && s === "en_curso" ? "Reabrir" : t.status === "cancelado" && s === "programado" ? "Reprogramar" : TRANSITION_LABEL[s]}
                  </Button>
                ))}
              </div>
            )}
            {setStatus.isError && <p className="text-sm text-red-600">{setStatus.error.message}</p>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Próximo paso" />
          <div className="space-y-2 p-4 text-sm text-slate-600 sm:p-5">
            {t.teamCount === 0 ? (
              <><p>Inscribí las parejas del torneo.</p><Button size="sm" variant="secondary" onClick={() => onTab("parejas")}>Ir a parejas</Button></>
            ) : !credited ? (
              <><p>Cargá la instancia de cada pareja y confirmá la acreditación de puntos.</p><Button size="sm" variant="secondary" onClick={() => onTab("acreditacion")}>Ir a acreditación</Button></>
            ) : (
              <><p>Los puntos ya están en los rankings.</p><Link to="/rankings"><Button size="sm" variant="secondary">Ver rankings</Button></Link></>
            )}
          </div>
        </Card>
      </div>

      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Eliminar categoría"
        message="La categoría se eliminará del torneo (si era la única, se elimina el torneo). Si sólo no se va a jugar, conviene cancelarla para conservar el registro."
        confirmLabel="Eliminar"
        onConfirm={async () => {
          await api.delete(`/tournaments/${t.id}`);
          invalidate();
          toast("Torneo eliminado");
          navigate("/torneos");
        }} />
      <ConfirmDialog open={!!pendingStatus} onClose={() => setPendingStatus(null)}
        title={pendingStatus === "cancelado" ? "Cancelar torneo" : "Finalizar torneo"}
        message={pendingStatus === "cancelado" ? "El torneo quedará cancelado. Podés reprogramarlo después." : "El torneo quedará finalizado. Después confirmá la acreditación de puntos."}
        confirmLabel={pendingStatus === "cancelado" ? "Cancelar torneo" : "Finalizar"}
        tone={pendingStatus === "cancelado" ? "danger" : "primary"}
        onConfirm={() => setStatus.mutateAsync(pendingStatus!)} />
    </div>
  );
}

export function TournamentPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const tab = (TABS.find((t) => t.key === params.get("tab"))?.key ?? "resumen") as TabKey;
  const setTab = (k: TabKey) => setParams(k === "resumen" ? {} : { tab: k }, { replace: true });
  const query = useQuery({
    queryKey: keys.tournament(id!),
    queryFn: async () => (await api.get<{ item: Tournament }>(`/tournaments/${id}`)).item,
  });
  // El torneo general y todas sus categorías (cada una, una competencia independiente).
  const eventId = query.data?.eventId ?? null;
  const event = useQuery({
    // Se vuelve a pedir cuando cambia el estado, la acreditación o las parejas de la categoría actual.
    queryKey: [...keys.events, "detail", String(eventId), query.data?.status, query.data?.creditedVersion, query.data?.teamCount],
    queryFn: async () => (await api.get<{ item: TournamentEvent }>(`/events/${eventId}`)).item,
    enabled: eventId !== null,
  });

  if (query.isPending) return <Spinner />;
  if (query.isError) return <ErrorState message={query.error.message} />;
  const t = query.data;

  return (
    <>
      <Link to="/torneos" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" /> Torneos
      </Link>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold uppercase tracking-wide text-navy sm:text-3xl">{t.eventName ?? t.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>{t.seasonName}</span>·<span>{formatRange(t.startDate, t.endDate)}</span>
            <TournamentTypeBadge type={t.type} />
            <GenderBadge gender={t.gender} />
            <TournamentStatusBadge status={t.status} />
            {t.creditedVersion !== null && <Badge tone="green"><ShieldCheck className="size-3" />Acreditado</Badge>}
          </div>
        </div>
        {t.seasonStatus !== "cerrada" && (
          <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar datos</Button>
        )}
      </div>

      {/* Una pestaña por categoría del torneo: cada una con sus parejas, fixture, puntos y acreditación. */}
      <nav className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Categorías del torneo">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Categorías</span>
          {(event.data?.tournaments ?? [t]).map((x) => (x.id === t.id ? t : x)).map((c) => (
            <Link key={c.id} to={`/torneos/${c.id}${tab === "resumen" || (tab === "fixture" && c.type !== "largo") ? "" : `?tab=${tab}`}`} aria-current={c.id === t.id ? "page" : undefined}
              className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition-colors",
                c.id === t.id ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-slate-700 ring-slate-300 hover:bg-brand-50")}>
              {c.categoryName}{c.divisionName ? ` · ${c.divisionName}` : ""}
              <span className={cn("text-xs font-medium", c.id === t.id ? "text-brand-100" : "text-slate-500")}>{TOURNAMENT_STATUS_LABEL[c.status]}</span>
              {c.creditedVersion !== null && <ShieldCheck className="size-3.5" aria-label="Acreditado" />}
            </Link>
          ))}
          {t.seasonStatus !== "cerrada" && event.data && (
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setEditing(true)}>Agregar categoría</Button>
          )}
        </div>
      </nav>

      <div className="-mx-4 mb-5 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Secciones del torneo">
        <div className="flex gap-1">
          {TABS.filter((x) => x.key !== "fixture" || t.type === "largo").map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)}
              className={cn("whitespace-nowrap border-b-[3px] px-3 py-2.5 font-brand text-[13px] font-bold transition-colors",
                tab === x.key ? "border-ball-400 text-brand-700" : "border-transparent text-slate-500 hover:text-brand-700")}>
              {x.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "resumen" && <Summary t={t} onTab={setTab} />}
      {tab === "parejas" && <TeamsTab tournament={t} onGoToScoring={() => setTab("puntuacion")} onGoToFixture={t.type === "largo" ? () => setTab("fixture") : undefined} />}
      {tab === "fixture" && t.type === "largo" && <FixtureTab tournament={t} onGoToCredit={() => setTab("acreditacion")} />}
      {tab === "importar" && <ImportTab tournament={t} onDone={() => setTab("acreditacion")} onManualLoad={() => setTab("parejas")} />}
      {tab === "puntuacion" && <ScoringTab tournament={t} />}
      {tab === "acreditacion" && <CreditTab tournament={t} />}

      {editing && (event.data
        ? <TorneoForm event={event.data} onClose={() => setEditing(false)} />
        : <TournamentForm tournament={t} onClose={() => setEditing(false)} />)}
    </>
  );
}
