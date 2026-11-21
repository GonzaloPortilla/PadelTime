import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Plus, Save, Trash2, Users } from "lucide-react";
import { teamSchema } from "@shared/schemas";
import { teamName, teamPoints } from "@shared/scoring";
import type { Team, Tournament, TournamentScoring } from "@shared/types";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { keys } from "@/hooks/data";
import { Button, IconButton } from "@/components/ui/Button";
import { FormError, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Card, EmptyState, ErrorState, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { PlayerPicker, type PickedPlayer } from "@/components/forms/PlayerPicker";
import { PlayerForm } from "@/components/forms/PlayerForm";
import { cn } from "@/lib/cn";

interface Draft { stageId: string; matchesPlayed: string; matchesWon: string }
const toDraft = (t: Team): Draft => ({ stageId: t.stageId ? String(t.stageId) : "", matchesPlayed: String(t.matchesPlayed), matchesWon: String(t.matchesWon) });
const sameDraft = (a: Draft, b: Draft) => a.stageId === b.stageId && Number(a.matchesPlayed) === Number(b.matchesPlayed) && Number(a.matchesWon) === Number(b.matchesWon);

export function useTournamentData(id: number) {
  const scoring = useQuery({
    queryKey: [...keys.tournaments, id, "scoring"],
    queryFn: () => api.get<{ item: TournamentScoring | null; locked: string | null }>(`/tournaments/${id}/scoring`),
  });
  const teams = useQuery({
    queryKey: [...keys.tournaments, id, "teams"],
    queryFn: () => api.get<{ items: Team[]; locked: string | null; fixtureLocked?: string | null }>(`/tournaments/${id}/teams`),
  });
  return { scoring, teams };
}

function TeamForm({ tournament, team, registered, onClose }: { tournament: Tournament; team: Team | null; registered: Set<number>; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const toPicked = (i: number): PickedPlayer | null => {
    const p = team?.players[i];
    return p ? { id: p.id, code: p.code, firstName: p.firstName, lastName: p.lastName, mainCategoryName: p.mainCategoryName } : null;
  };
  const [p1, setP1] = useState<PickedPlayer | null>(toPicked(0));
  const [p2, setP2] = useState<PickedPlayer | null>(toPicked(1));
  const [creatingFor, setCreatingFor] = useState<1 | 2 | null>(null);
  const form = useForm({ seed: team?.seed ? String(team.seed) : "" });

  // Los integrantes actuales de la pareja que se edita sí se pueden volver a elegir.
  const own = new Set(team?.players.map((p) => p.id) ?? []);
  const excludedFor = (other: PickedPlayer | null) => new Set([...registered].filter((id) => !own.has(id)).concat(other ? [other.id] : []));

  const save = useMutation({
    mutationFn: (body: unknown) => (team ? api.put(`/teams/${team.id}`, body) : api.post(`/tournaments/${tournament.id}/teams`, body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...keys.tournaments, tournament.id] });
      void qc.invalidateQueries({ queryKey: keys.tournaments });
      toast(team ? "Pareja actualizada" : "Pareja inscripta");
      onClose();
    },
    onError: form.handleApiError,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = teamSchema.safeParse({ player1Id: p1?.id, player2Id: p2?.id, seed: form.values.seed });
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join(".") || "_"] ??= issue.path[0] === "player1Id" || issue.path[0] === "player2Id" ? (issue.message.includes("distintos") ? issue.message : "Elegí un jugador") : issue.message;
      form.setErrors(fields);
      form.setFormError("Completá la pareja");
      return;
    }
    save.mutate(parsed.data);
  }

  return (
    <>
      <Modal
        open={creatingFor === null}
        onClose={onClose}
        title={team ? "Editar pareja" : "Inscribir pareja"}
        description="Las parejas son fijas durante todo el torneo. Cada integrante recibe la misma puntuación."
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" form="team-form" loading={save.isPending}>{team ? "Guardar" : "Inscribir"}</Button>
          </>
        }
      >
        <form id="team-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={form.formError} />
          <PlayerPicker label="Jugador 1" value={p1} onChange={setP1} gender={tournament.gender} excluded={excludedFor(p2)} error={form.errors.player1Id}
            onCreateNew={() => setCreatingFor(1)} />
          <PlayerPicker label="Jugador 2" value={p2} onChange={setP2} gender={tournament.gender} excluded={excludedFor(p1)} error={form.errors.player2Id}
            onCreateNew={() => setCreatingFor(2)} />
          <TextField label="Cabeza de serie" type="number" min={1} inputMode="numeric" containerClassName="max-w-40" value={form.values.seed}
            onChange={(e) => form.set("seed", e.target.value)} error={form.errors.seed} hint="Opcional." />
        </form>
      </Modal>
      {creatingFor !== null && (
        <PlayerForm
          player={null}
          defaults={{ gender: tournament.gender, mainCategoryId: tournament.categoryId }}
          onClose={() => setCreatingFor(null)}
          onSaved={(p) => {
            const picked = { id: p.id, code: p.code, firstName: p.firstName, lastName: p.lastName, mainCategoryName: p.mainCategoryName };
            if (creatingFor === 1) setP1(picked);
            else setP2(picked);
          }}
        />
      )}
    </>
  );
}

export function TeamsTab({ tournament, onGoToScoring, onGoToFixture }: { tournament: Tournament; onGoToScoring: () => void; onGoToFixture?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { scoring, teams } = useTournamentData(tournament.id);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [editing, setEditing] = useState<Team | null | "new">(null);
  const [deleting, setDeleting] = useState<Team | null>(null);

  const serverTeams = useMemo(() => teams.data?.items ?? [], [teams.data]);
  // Al recibir datos del servidor se conservan las ediciones locales sin guardar.
  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<number, Draft> = {};
      for (const t of serverTeams) {
        const old = prev[t.id];
        next[t.id] = old && !sameDraft(old, toDraft(t)) ? old : toDraft(t);
      }
      return next;
    });
  }, [serverTeams]);

  const config = scoring.data?.item ?? null;
  const locked = teams.data?.locked ?? scoring.data?.locked ?? null;
  // Fase 10: con fixture, las instancias salen de Fixture → Puntos (se pueden seguir inscribiendo parejas).
  const resultsLocked = locked ?? teams.data?.fixtureLocked ?? null;
  const dirty = serverTeams.filter((t) => drafts[t.id] && !sameDraft(drafts[t.id]!, toDraft(t)));
  const registered = useMemo(() => new Set(serverTeams.flatMap((t) => t.players.map((p) => p.id))), [serverTeams]);

  const stageCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of Object.values(drafts)) if (d.stageId) m.set(d.stageId, (m.get(d.stageId) ?? 0) + 1);
    return m;
  }, [drafts]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/tournaments/${tournament.id}/results`, {
        results: dirty.map((t) => {
          const d = drafts[t.id]!;
          return { teamId: t.id, stageId: d.stageId ? Number(d.stageId) : null, matchesPlayed: Number(d.matchesPlayed) || 0, matchesWon: Number(d.matchesWon) || 0 };
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...keys.tournaments, tournament.id] });
      toast("Resultados guardados");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const remove = async (t: Team) => {
    await api.delete(`/teams/${t.id}`);
    void qc.invalidateQueries({ queryKey: [...keys.tournaments, tournament.id] });
    void qc.invalidateQueries({ queryKey: keys.tournaments });
    toast("Pareja quitada");
  };

  if (teams.isPending || scoring.isPending) return <Spinner />;
  if (teams.isError) return <ErrorState message={teams.error.message} onRetry={() => void teams.refetch()} />;

  const setDraft = (id: number, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));

  return (
    <div className="space-y-4">
      {locked && <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">{locked}</p>}
      {!locked && teams.data?.fixtureLocked && (
        <div className="flex flex-col gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-800 ring-1 ring-inset ring-brand-200 sm:flex-row sm:items-center sm:justify-between">
          <p>{teams.data.fixtureLocked}</p>
          {onGoToFixture && <Button size="sm" variant="secondary" onClick={onGoToFixture}>Ir al fixture</Button>}
        </div>
      )}
      {!config && (
        <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-inset ring-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <p>Este torneo todavía no tiene puntuación configurada. Elegí una plantilla para poder cargar instancias.</p>
          <Button size="sm" variant="secondary" onClick={onGoToScoring}>Configurar puntuación</Button>
        </div>
      )}
      {tournament.creditedVersion !== null && (
        <p className="flex items-start gap-2 rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-inset ring-sky-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Este torneo ya tiene puntos acreditados (v{tournament.creditedVersion}). Si modificás resultados, los rankings no cambian hasta confirmar la corrección en la pestaña Acreditación.
        </p>
      )}

      {config && config.stages.length > 0 && serverTeams.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Parejas por instancia">
          {config.stages.map((s) => {
            const n = stageCounts.get(String(s.id)) ?? 0;
            const over = s.maxTeams !== null && n > s.maxTeams;
            return (
              <Badge key={s.id} tone={over ? "red" : n > 0 ? "green" : "gray"}>
                {s.label}: {n}{s.maxTeams !== null ? `/${s.maxTeams}` : ""}
              </Badge>
            );
          })}
          <Badge tone={Object.values(drafts).some((d) => !d.stageId) ? "amber" : "gray"}>
            Sin instancia: {Object.values(drafts).filter((d) => !d.stageId).length}
          </Badge>
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">Parejas inscriptas <span className="font-normal text-slate-400">({serverTeams.length})</span></h2>
          {!locked && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Inscribir pareja</Button>}
        </div>
        {serverTeams.length === 0 ? (
          <EmptyState icon={<Users className="size-6" />} title="Todavía no hay parejas" description="Inscribí las parejas para cargar la instancia final que alcanzó cada una." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {serverTeams.map((t, i) => {
              const d = drafts[t.id] ?? toDraft(t);
              const pts = config ? teamPoints(config, { stageId: d.stageId ? Number(d.stageId) : null, matchesPlayed: Number(d.matchesPlayed) || 0, matchesWon: Number(d.matchesWon) || 0 }) : null;
              const changed = !sameDraft(d, toDraft(t));
              const name = teamName(t.players);
              return (
                <li key={t.id} className={cn("flex flex-col gap-3 px-4 py-3 sm:px-5 lg:flex-row lg:items-center", changed && "bg-ball-300/15")} data-testid="team-row">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="mt-0.5 w-7 shrink-0 text-center text-xs font-semibold text-slate-400 tabular" title={t.seed ? "Cabeza de serie" : "Orden"}>
                      {t.seed ? `#${t.seed}` : i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                      <p className="text-xs text-slate-500">
                        {t.players.map((p, j) => (
                          <span key={p.id}>
                            {j > 0 && " · "}
                            {p.firstName} {p.lastName} <span className="font-mono">{p.code}</span>
                            {p.mainCategoryId !== tournament.categoryId && <span className="text-amber-700"> (suma en {p.mainCategoryName})</span>}
                          </span>
                        ))}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-2 pl-10 lg:pl-0">
                    <label className="flex flex-col text-xs text-slate-500">
                      Instancia
                      <select
                        aria-label={`Instancia de ${name}`}
                        value={d.stageId}
                        disabled={!!resultsLocked || !config}
                        onChange={(e) => setDraft(t.id, { stageId: e.target.value })}
                        className={cn("mt-0.5 h-9 w-44 rounded-lg border-0 bg-white px-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-brand-600 disabled:bg-slate-50",
                          d.stageId ? "ring-slate-300" : "ring-amber-400")}
                      >
                        <option value="">Sin cargar</option>
                        {config?.stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col text-xs text-slate-500">
                      PJ
                      <input aria-label={`Partidos jugados por ${name}`} type="number" min={0} inputMode="numeric" value={d.matchesPlayed} disabled={!!resultsLocked}
                        onChange={(e) => setDraft(t.id, { matchesPlayed: e.target.value })}
                        className="mt-0.5 h-9 w-14 rounded-lg border-0 bg-white px-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-600 disabled:bg-slate-50" />
                    </label>
                    <label className="flex flex-col text-xs text-slate-500">
                      PG
                      <input aria-label={`Partidos ganados por ${name}`} type="number" min={0} inputMode="numeric" value={d.matchesWon} disabled={!!resultsLocked}
                        onChange={(e) => setDraft(t.id, { matchesWon: e.target.value })}
                        className={cn("mt-0.5 h-9 w-14 rounded-lg border-0 bg-white px-2 text-sm shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-brand-600 disabled:bg-slate-50",
                          Number(d.matchesWon) > Number(d.matchesPlayed) ? "ring-red-400" : "ring-slate-300")} />
                    </label>
                    <div className="w-20 text-right">
                      <p className="text-[10px] uppercase text-slate-400">c/u</p>
                      <p className="text-base font-bold tabular text-slate-900" data-testid="team-points">{pts ? pts.points : "—"}</p>
                    </div>
                    {!locked && (
                      <div className="flex">
                        <IconButton label={`Editar pareja ${name}`} onClick={() => setEditing(t)}><Pencil className="size-4" /></IconButton>
                        <IconButton label={`Quitar pareja ${name}`} className="hover:text-red-600" onClick={() => setDeleting(t)}><Trash2 className="size-4" /></IconButton>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {dirty.length > 0 && !resultsLocked && (
        <div className="sticky bottom-4 z-20 flex flex-col gap-2 rounded-xl bg-ink-950 p-3 text-white shadow-xl sm:flex-row sm:items-center sm:justify-between">
          <p className="px-1 text-sm">{dirty.length === 1 ? "1 pareja con cambios sin guardar" : `${dirty.length} parejas con cambios sin guardar`}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => setDrafts(Object.fromEntries(serverTeams.map((t) => [t.id, toDraft(t)])))}>
              Descartar
            </Button>
            <Button size="sm" className="bg-ball-400 text-ink-950 hover:bg-ball-300" icon={<Save className="size-4" />} loading={save.isPending} onClick={() => save.mutate()}>
              Guardar resultados
            </Button>
          </div>
        </div>
      )}

      {editing && <TeamForm tournament={tournament} team={editing === "new" ? null : editing} registered={registered} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Quitar pareja"
        message={`Se quitará la pareja ${deleting ? teamName(deleting.players) : ""} del torneo.${tournament.creditedVersion !== null ? " Sus puntos se descontarán al confirmar la corrección." : ""}`}
        confirmLabel="Quitar"
        onConfirm={() => remove(deleting!)}
      />
    </div>
  );
}
