import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarClock, Check, ClipboardEdit, Repeat2, Trash2, Undo2 } from "lucide-react";
import {
  MATCH_STATUS_LABEL, PHASE_LABEL, bracketRounds, roundLabel, type BracketPhase, type FixtureHistoryItem, type FixtureMatchRow, type FixturePhase, type SlotSource,
} from "@shared/fixture";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Checkbox, FilterSelect, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { ErrorNote, fmtDay, fx, scoreLabel, sourceLabel, teamName, useFixtureMutation, type FxCtx } from "./common";
import { ResultModal } from "./ResultModal";

// ─────────────────────────── Partido (fila) ───────────────────────────
function MatchRow({ ctx, m, onResult, onSchedule }: { ctx: FxCtx; m: FixtureMatchRow; onResult: () => void; onSchedule: () => void }) {
  const s = ctx.state;
  const conflict = s.conflicts.some((c) => c.matchId === m.id);
  const canPlay = m.team1Id !== null && m.team2Id !== null && m.status !== "bye";
  const when = [fmtDay(m.date), m.time, m.court].filter(Boolean).join(" · ");
  return (
    <li className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5", conflict && "bg-red-50")} data-testid={`match-${m.id}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className={cn(m.winner === 1 && "font-bold text-navy")}>{m.team1Id === null && m.round === 1 ? sourceLabel(s, m.source1) : teamName(s, m.team1Id)}</span>
          <span className="mx-1.5 text-xs text-slate-400">vs</span>
          <span className={cn(m.winner === 2 && "font-bold text-navy")}>{m.team2Id === null && m.round === 1 ? sourceLabel(s, m.source2) : teamName(s, m.team2Id)}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          {when || "Sin programar"}
          {conflict && <Badge tone="red"><AlertTriangle className="size-3" />Conflicto</Badge>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {m.status === "pendiente" ? <Badge tone="gray">Pendiente</Badge>
          : m.status === "bye" ? <Badge tone="sky">BYE</Badge>
            : <span className="font-display text-base font-semibold tabular-nums text-navy" title={MATCH_STATUS_LABEL[m.status]}>{scoreLabel(m)}</span>}
        {!ctx.readOnly && m.status !== "bye" && (
          <>
            <Button size="sm" variant="ghost" icon={<CalendarClock className="size-4" />} onClick={onSchedule} aria-label="Programar" />
            <Button size="sm" variant={m.status === "pendiente" ? "secondary" : "ghost"} icon={<ClipboardEdit className="size-4" />} disabled={!canPlay} onClick={onResult}>
              {m.status === "pendiente" ? "Resultado" : "Corregir"}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function ScheduleModal({ ctx, m, onClose }: { ctx: FxCtx; m: FixtureMatchRow; onClose: () => void }) {
  const [date, setDate] = useState(m.date ?? "");
  const [time, setTime] = useState(m.time ?? "");
  const [court, setCourt] = useState(m.court ?? "");
  const save = useFixtureMutation(ctx.tid, (body: unknown) => fx.put(ctx.tid, `/matches/${m.id}/schedule`, body), "Partido programado");
  return (
    <Modal open onClose={onClose} title="Programar partido" description={`${teamName(ctx.state, m.team1Id)} vs ${teamName(ctx.state, m.team2Id)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate({ version: m.version, date: date || null, time: time || null, court: court || null }, { onSuccess: onClose })}>Guardar</Button></>}>
      <div className="space-y-4">
        <ErrorNote message={save.error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Hora" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <TextField label="Cancha" value={court} maxLength={40} placeholder="Ej.: Cancha 2" onChange={(e) => setCourt(e.target.value)} />
      </div>
    </Modal>
  );
}

function BulkSchedule({ ctx, phase, groupId }: { ctx: FxCtx; phase: FixturePhase; groupId: number | null }) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [interval, setInterval] = useState("7");
  const [time, setTime] = useState("21:00");
  const [court, setCourt] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const save = useFixtureMutation(ctx.tid, (body: unknown) => fx.post(ctx.tid, "/schedule", body), "Fechas asignadas");
  if (ctx.readOnly) return null;
  return (
    <>
      <Button size="sm" variant="secondary" icon={<CalendarClock className="size-4" />} onClick={() => setOpen(true)}>Programar por fechas</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Programar por fechas"
        description={phase === "grupos" ? "La fecha 1 se juega el día de inicio y cada fecha siguiente, el intervalo indicado después (reglamento: una por semana, siempre el mismo día)." : "Cada ronda se juega el intervalo indicado después de la anterior."}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><Button loading={save.isPending} disabled={!startDate}
          onClick={() => save.mutate({ version: ctx.state.version, phase, groupId, startDate, intervalDays: Number(interval) || 0, time: time || null, court: court || null, overwrite }, { onSuccess: () => setOpen(false) })}>Asignar</Button></>}>
        <div className="space-y-4">
          <ErrorNote message={save.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Primera fecha" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <TextField label="Días entre fechas" type="number" min={0} max={60} value={interval} onChange={(e) => setInterval(e.target.value)} />
            <TextField label="Hora" type="time" value={time} onChange={(e) => setTime(e.target.value)} hint="Vacía = no se cambia." />
            <TextField label="Cancha" value={court} maxLength={40} onChange={(e) => setCourt(e.target.value)} hint="Vacía = no se cambia." />
          </div>
          <Checkbox label="Reemplazar fechas ya cargadas" checked={overwrite} onChange={setOverwrite} hint="Nunca se tocan partidos con resultado." />
        </div>
      </Modal>
    </>
  );
}

// ─────────────────────────── Partidos ───────────────────────────
export function MatchesPanel({ ctx }: { ctx: FxCtx }) {
  const s = ctx.state;
  const phases = [...new Set(s.matches.map((m) => m.phase))];
  const [phase, setPhase] = useState<FixturePhase>(phases[0] ?? "grupos");
  const [groupId, setGroupId] = useState<number | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);
  const [result, setResult] = useState<FixtureMatchRow | null>(null);
  const [schedule, setSchedule] = useState<FixtureMatchRow | null>(null);
  const list = s.matches.filter((m) => m.phase === phase && (groupId === null || m.groupId === groupId) && (!onlyPending || m.status === "pendiente"));
  const size = s.matches.filter((m) => m.phase === phase && m.round === 1).length * 2;
  const rounds = [...new Set(list.map((m) => m.round))].sort((a, b) => a - b);
  // Al recargar el estado, el partido abierto se toma del estado nuevo (versión actual).
  const fresh = (m: FixtureMatchRow | null) => (m ? s.matches.find((x) => x.id === m.id) ?? null : null);

  if (!s.matches.length) return <Card><EmptyState title="Todavía no hay partidos" description={s.config.format === "grupos_copas" ? "Armá los grupos para generar los partidos todos contra todos." : "Armá el cuadro en la pestaña Cuadro."} /></Card>;
  return (
    <Card>
      <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:p-4">
        <FilterSelect value={phase} aria-label="Fase" onChange={(e) => { setPhase(e.target.value as FixturePhase); setGroupId(null); }}>
          {phases.map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
        </FilterSelect>
        {phase === "grupos" && (
          <FilterSelect value={groupId ?? ""} aria-label="Grupo" onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Todos los grupos</option>
            {s.groups.map((g) => <option key={g.id} value={g.id}>Grupo {g.name}</option>)}
          </FilterSelect>
        )}
        <Checkbox label="Sólo pendientes" checked={onlyPending} onChange={setOnlyPending} />
        <div className="sm:ml-auto"><BulkSchedule ctx={ctx} phase={phase} groupId={groupId} /></div>
      </div>
      {rounds.map((r) => (
        <section key={r}>
          <h3 className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:px-5">{phase === "grupos" ? `Fecha ${r}` : roundLabel(size, r)}</h3>
          <ul className="divide-y divide-slate-100">
            {list.filter((m) => m.round === r).map((m) => (
              <MatchRow key={m.id} ctx={ctx} m={m} onResult={() => setResult(m)} onSchedule={() => setSchedule(m)} />
            ))}
          </ul>
        </section>
      ))}
      {list.length === 0 && <p className="p-5 text-sm text-slate-500">No hay partidos con esos filtros.</p>}
      {fresh(result) && <ResultModal ctx={ctx} match={fresh(result)!} onClose={() => setResult(null)} />}
      {fresh(schedule) && <ScheduleModal ctx={ctx} m={fresh(schedule)!} onClose={() => setSchedule(null)} />}
    </Card>
  );
}

// ─────────────────────────── Posiciones ───────────────────────────
export function StandingsPanel({ ctx }: { ctx: FxCtx }) {
  const s = ctx.state;
  const [ordering, setOrdering] = useState<number | null>(null);
  if (!s.groups.length) return <Card><EmptyState title="Sin grupos" description="Las tablas aparecen cuando se arman los grupos." /></Card>;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {s.standings.map((st) => {
        const g = s.groups.find((x) => x.id === st.groupId)!;
        return (
          <Card key={st.groupId}>
            <CardHeader title={`Grupo ${g.name}`} subtitle={`${st.played} de ${st.total} partidos con resultado${st.complete ? " · terminado" : ""}`}
              action={!ctx.readOnly && (st.unresolved.length > 0 || g.manualOrder) ? <Button size="sm" variant={st.unresolved.length ? "primary" : "secondary"} onClick={() => setOrdering(g.id)}>Definir orden</Button> : undefined} />
            {st.unresolved.length > 0 && (
              <p className="mx-4 mb-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-200 sm:mx-5">
                Empate que los criterios configurados no resuelven. {st.complete ? "Definí el orden a mano (por ejemplo, por sorteo) para poder armar las copas." : "Puede resolverse con los partidos que faltan."}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr><th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Pareja</th><th className="px-2 py-2 text-right">PJ</th><th className="px-2 py-2 text-right">PG</th><th className="px-2 py-2 text-right">PP</th><th className="px-2 py-2 text-right">Sets</th><th className="px-3 py-2 text-right">Games</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {st.rows.map((r) => (
                    <tr key={r.teamId} className={cn(r.withdrawn && "text-slate-400")}>
                      <td className="px-3 py-2 font-bold text-brand-700">{r.position}{r.tied ? "*" : ""}</td>
                      <td className="px-3 py-2">{teamName(s, r.teamId)}{r.withdrawn ? " (retirada)" : ""}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.played}</td>
                      <td className="px-2 py-2 text-right font-semibold tabular-nums">{r.won}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.lost}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.setsWon}-{r.setsLost}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.gamesWon}-{r.gamesLost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
      <p className="text-xs text-slate-500 xl:col-span-2">Desempate: {s.config.tiebreakers.length} criterio(s) configurado(s) en Configuración. * = empate sin resolver.</p>
      {ordering !== null && <OrderModal ctx={ctx} groupId={ordering} onClose={() => setOrdering(null)} />}
    </div>
  );
}

function OrderModal({ ctx, groupId, onClose }: { ctx: FxCtx; groupId: number; onClose: () => void }) {
  const st = ctx.state.standings.find((x) => x.groupId === groupId)!;
  const g = ctx.state.groups.find((x) => x.id === groupId)!;
  const [order, setOrder] = useState<number[]>(st.rows.map((r) => r.teamId));
  const save = useFixtureMutation(ctx.tid, (body: unknown) => fx.put(ctx.tid, `/groups/${groupId}/order`, body), "Orden definido");
  const move = (i: number, d: -1 | 1) => setOrder((o) => { const n = [...o]; const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  return (
    <Modal open onClose={onClose} title={`Orden manual · Grupo ${g.name}`} description="Sólo se usa para desempatar lo que los criterios no resuelven. Queda registrado en la auditoría."
      footer={<>
        {g.manualOrder && <Button variant="ghost" onClick={() => save.mutate({ version: ctx.state.version, teamIds: null }, { onSuccess: onClose })}>Quitar orden manual</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button loading={save.isPending} onClick={() => save.mutate({ version: ctx.state.version, teamIds: order }, { onSuccess: onClose })}>Guardar</Button>
      </>}>
      <ErrorNote message={save.error} />
      <ol className="space-y-1.5">
        {order.map((id, i) => (
          <li key={id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-200">
            <span className="w-5 font-bold text-brand-700">{i + 1}.</span><span className="flex-1">{teamName(ctx.state, id)}</span>
            <button type="button" className="rounded p-1 hover:bg-white disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir"><ArrowUp className="size-4" /></button>
            <button type="button" className="rounded p-1 hover:bg-white disabled:opacity-30" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="Bajar"><ArrowDown className="size-4" /></button>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

// ─────────────────────────── Copas / cuadro ───────────────────────────
interface Proposal { ready: boolean; reason: string | null; brackets: { phase: BracketPhase; pairs: [SlotSource, SlotSource][] }[] }

export function BracketsPanel({ ctx }: { ctx: FxCtx }) {
  const s = ctx.state;
  const built = s.matches.some((m) => m.phase !== "grupos");
  const [result, setResult] = useState<FixtureMatchRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useFixtureMutation(ctx.tid, (body: unknown) => fx.del(ctx.tid, "/brackets", body), "Cuadros borrados");
  const phases = (["cuadro", "oro", "plata"] as const).filter((p) => s.matches.some((m) => m.phase === p));
  const fresh = result ? s.matches.find((x) => x.id === result.id) ?? null : null;
  if (!built) return <BracketBuilder ctx={ctx} />;
  const anyResult = s.matches.some((m) => m.phase !== "grupos" && m.status !== "pendiente" && m.status !== "bye");
  return (
    <div className="space-y-6">
      {phases.map((p) => {
        const ms = s.matches.filter((m) => m.phase === p);
        const size = ms.filter((m) => m.round === 1).length * 2;
        return (
          <Card key={p}>
            <CardHeader title={PHASE_LABEL[p]} subtitle={`${size} lugares · ${roundLabel(size, 1)}`} />
            <div className="flex gap-3 overflow-x-auto p-4 sm:p-5">
              {Array.from({ length: bracketRounds(size) }, (_, i) => i + 1).map((r) => (
                <div key={r} className="flex min-w-52 flex-1 flex-col justify-around gap-3">
                  <h4 className="text-center text-xs font-semibold uppercase text-slate-500">{roundLabel(size, r)}</h4>
                  {ms.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot).map((m) => {
                    const conflict = s.conflicts.some((c) => c.matchId === m.id);
                    const canPlay = !ctx.readOnly && m.team1Id !== null && m.team2Id !== null && m.status !== "bye";
                    return (
                      <button key={m.id} type="button" disabled={!canPlay} onClick={() => setResult(m)} data-testid={`bracket-${m.id}`}
                        className={cn("rounded-lg bg-white text-left text-sm ring-1 ring-inset transition-colors", conflict ? "ring-red-400" : "ring-slate-200", canPlay && "hover:ring-brand-400")}>
                        {([1, 2] as const).map((side) => {
                          const id = side === 1 ? m.team1Id : m.team2Id;
                          const src = side === 1 ? m.source1 : m.source2;
                          return (
                            <div key={side} className={cn("flex justify-between gap-2 px-2.5 py-1.5", side === 2 && "border-t border-slate-100", m.winner === side && "bg-ball-50 font-semibold text-navy")}>
                              <span className="min-w-0 truncate">{id !== null ? teamName(s, id) : r === 1 ? sourceLabel(s, src) : "—"}</span>
                              <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-500">{m.status === "wo" ? (m.winner === side ? "W.O." : "") : m.sets.map((x) => x[side - 1]).join(" ")}</span>
                            </div>
                          );
                        })}
                        {conflict && <p className="border-t border-red-100 px-2.5 py-1 text-xs font-medium text-red-600">Conflicto</p>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>
        );
      })}
      {!ctx.readOnly && !anyResult && (
        <div><Button variant="ghost" className="text-red-600" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>Borrar cuadros</Button><ErrorNote message={del.error} /></div>
      )}
      {fresh && <ResultModal ctx={ctx} match={fresh} onClose={() => setResult(null)} />}
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Borrar cuadros" message="Se borran los cuadros (todavía sin resultados). Los grupos y sus resultados no se tocan."
        confirmLabel="Borrar cuadros" onConfirm={() => del.mutateAsync({ version: s.version })} />
    </div>
  );
}

function BracketBuilder({ ctx }: { ctx: FxCtx }) {
  const s = ctx.state;
  const proposal = useQuery({
    queryKey: ["fixture-proposal", ctx.tid, s.version],
    queryFn: () => api.get<Proposal>(`/tournaments/${ctx.tid}/fixture/brackets/proposal`),
  });
  const [edited, setEdited] = useState<Proposal["brackets"] | null>(null);
  const [picked, setPicked] = useState<{ b: number; p: number; side: 0 | 1 } | null>(null);
  const create = useFixtureMutation(ctx.tid, (body: unknown) => fx.post(ctx.tid, "/brackets", body), "Cuadros armados");
  const brackets = edited ?? proposal.data?.brackets ?? [];
  const pick = (b: number, p: number, side: 0 | 1) => {
    if (!picked) return setPicked({ b, p, side });
    if (picked.b !== b) return setPicked({ b, p, side });
    const next = structuredClone(brackets);
    const a = next[b]!.pairs[picked.p]![picked.side]!;
    next[b]!.pairs[picked.p]![picked.side] = next[b]!.pairs[p]![side]!;
    next[b]!.pairs[p]![side] = a;
    if (next[b]!.pairs.some(([x, y]) => x.kind === "bye" && y.kind === "bye")) { setPicked(null); return; }
    setEdited(next);
    setPicked(null);
  };
  const label = s.config.format === "eliminacion" ? "Armar el cuadro" : "Armar Copa de Oro y Copa de Plata";
  const sizes = useMemo(() => brackets.map((b) => b.pairs.length * 2), [brackets]);

  if (proposal.isPending) return <Spinner />;
  if (proposal.isError) return <ErrorState message={proposal.error.message} onRetry={() => void proposal.refetch()} />;
  if (!proposal.data.ready) return <Card><EmptyState title={label} description={proposal.data.reason ?? ""} /></Card>;
  return (
    <Card>
      <CardHeader title={`Propuesta: ${label.toLowerCase()}`} subtitle="Siembra estándar: los primeros de grupo arriba y separados; con dos grupos, 1° A contra el último de B, 2° A contra 3° B… Tocá dos lugares para intercambiarlos." />
      <div className="space-y-5 p-4 sm:p-5">
        {brackets.map((b, bi) => (
          <div key={b.phase}>
            <h4 className="mb-2 font-display text-sm font-bold uppercase text-navy">{PHASE_LABEL[b.phase]} · {roundLabel(sizes[bi]!, 1)}</h4>
            <ol className="grid gap-2 sm:grid-cols-2">
              {b.pairs.map((pair, pi) => (
                <li key={pi} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm ring-1 ring-inset ring-slate-200">
                  {([0, 1] as const).map((side) => (
                    <button key={side} type="button" disabled={ctx.readOnly} onClick={() => pick(bi, pi, side)}
                      className={cn("flex-1 truncate rounded-md px-2 py-1.5 text-left ring-1 ring-inset", picked?.b === bi && picked.p === pi && picked.side === side ? "bg-brand-100 ring-brand-500" : "bg-white ring-slate-200 hover:ring-brand-300", pair[side]!.kind === "bye" && "text-slate-400")}>
                      {sourceLabel(s, pair[side]!)}
                    </button>
                  )).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, <span key="vs" className="text-xs text-slate-400">vs</span>, el] : [el]), [])}
                </li>
              ))}
            </ol>
          </div>
        ))}
        <ErrorNote message={create.error} />
        {!ctx.readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button icon={<Check className="size-4" />} loading={create.isPending} onClick={() => create.mutate({ version: s.version, brackets })}>Confirmar</Button>
            {edited && <Button variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => { setEdited(null); setPicked(null); }}>Volver a la propuesta</Button>}
            {picked && <span className="inline-flex items-center gap-1 text-sm text-brand-700"><Repeat2 className="size-4" />Elegí el lugar con el que intercambiar</span>}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─────────────────────────── Problemas ───────────────────────────
export function IssuesPanel({ ctx }: { ctx: FxCtx }) {
  const s = ctx.state;
  const [annul, setAnnul] = useState<FixtureMatchRow | null>(null);
  const [reason, setReason] = useState("");
  const m = useFixtureMutation(ctx.tid, (body: { id: number; version: number; reason: string }) => fx.post(ctx.tid, `/matches/${body.id}/annul`, { version: body.version, reason: body.reason }), "Resultado anulado");
  if (!s.issues.length) return <Card><EmptyState icon={<Check className="size-6" />} title="Sin problemas detectados" description="No hay conflictos, empates sin resolver ni superposiciones de horarios." /></Card>;
  return (
    <Card>
      <CardHeader title="Problemas detectados" subtitle="Los conflictos aparecen cuando una corrección cambia quién debía jugar un partido que ya se jugó: nada se sobrescribe solo." />
      <ul className="divide-y divide-slate-100">
        {s.issues.map((i, k) => {
          const match = i.code === "conflicto" ? s.matches.find((x) => x.id === i.matchIds[0]) : undefined;
          return (
            <li key={k} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
              <Badge tone={i.level === "error" ? "red" : "amber"}>{i.level === "error" ? "Error" : "Aviso"}</Badge>
              <p className="flex-1 text-sm">{i.message}</p>
              {match && (ctx.isAdmin ? (
                <Button size="sm" variant="secondary" onClick={() => { setAnnul(match); setReason(""); }}>Anular ese resultado</Button>
              ) : <span className="text-xs text-slate-500">Lo resuelve un administrador.</span>)}
            </li>
          );
        })}
      </ul>
      <Modal open={!!annul} onClose={() => setAnnul(null)} title="Anular resultado" description="El partido vuelve a pendiente y se completa con la pareja que corresponde. Después se vuelve a cargar el resultado."
        footer={<><Button variant="secondary" onClick={() => setAnnul(null)}>Cancelar</Button><Button variant="danger" loading={m.isPending} disabled={reason.trim().length < 5}
          onClick={() => m.mutate({ id: annul!.id, version: s.matches.find((x) => x.id === annul!.id)?.version ?? annul!.version, reason }, { onSuccess: () => setAnnul(null) })}>Anular</Button></>}>
        <div className="space-y-3">
          <ErrorNote message={m.error} />
          <TextField label="Motivo" required value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Modal>
    </Card>
  );
}

// ─────────────────────────── Historial ───────────────────────────
const ACTION_LABEL: Record<string, string> = { resultado: "Carga", correccion: "Corrección", anulacion: "Anulación", retiro: "Retiro (W.O.)", programacion: "Programación" };

export function HistoryPanel({ ctx }: { ctx: FxCtx }) {
  const q = useQuery({
    queryKey: ["fixture-history", ctx.tid, ctx.state.version],
    queryFn: async () => (await api.get<{ items: FixtureHistoryItem[] }>(`/tournaments/${ctx.tid}/fixture/history`)).items,
  });
  const s = ctx.state;
  const describe = (v: unknown) => {
    const x = v as { status?: FixtureMatchRow["status"]; sets?: [number, number][]; team1Id?: number | null; team2Id?: number | null } | null;
    if (!x?.status) return "—";
    return x.status === "pendiente" ? "Pendiente" : `${scoreLabel({ status: x.status, sets: x.sets ?? [] })} · ${MATCH_STATUS_LABEL[x.status]}`;
  };
  if (q.isPending) return <Spinner />;
  if (q.isError) return <ErrorState message={q.error.message} />;
  if (!q.data.length) return <Card><EmptyState title="Sin cambios de resultados todavía" /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-slate-100">
        {q.data.map((h) => {
          const m = s.matches.find((x) => x.id === h.matchId);
          const after = h.after as { team1Id?: number | null; team2Id?: number | null } | null;
          return (
            <li key={h.id} className="px-4 py-3 text-sm sm:px-5">
              <p className="flex flex-wrap items-center gap-2"><Badge tone={h.action === "correccion" || h.action === "anulacion" ? "amber" : "blue"}>{ACTION_LABEL[h.action] ?? h.action}</Badge>
                <span className="font-medium">{teamName(s, after?.team1Id ?? m?.team1Id ?? null)} vs {teamName(s, after?.team2Id ?? m?.team2Id ?? null)}</span></p>
              <p className="mt-1 text-slate-600">{describe(h.before)} → <b>{describe(h.after)}</b></p>
              <p className="mt-0.5 text-xs text-slate-500">{new Date(h.createdAt).toLocaleString("es-AR")} · {h.createdByName ?? "—"}{h.reason ? ` · Motivo: ${h.reason}` : ""}</p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
