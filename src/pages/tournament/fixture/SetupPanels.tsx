import { useState } from "react";
import { ArrowDown, ArrowUp, Dices, Plus, Trash2, UserMinus, UserPlus, Wand2, X } from "lucide-react";
import {
  FIXTURE_FORMAT_LABEL, GROUP_TIEBREAKERS, GROUP_TIEBREAKER_LABEL, distributeGroups, drawOrder, groupName,
  type FixtureConfig, type GroupTiebreaker,
} from "@shared/fixture";
import { Button } from "@/components/ui/Button";
import { Checkbox, SelectField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Card, CardHeader } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { ErrorNote, fx, useFixtureMutation, type FxCtx } from "./common";

const num = (v: string, fallback: number) => (v === "" || Number.isNaN(Number(v)) ? fallback : Number(v));

// ─────────────────────────── Configuración ───────────────────────────
export function ConfigPanel({ ctx }: { ctx: FxCtx }) {
  const { state } = ctx;
  const [cfg, setCfg] = useState<FixtureConfig>(state.config);
  const [seedCount, setSeedCount] = useState(String(state.config.groupCount));
  const save = useFixtureMutation(ctx.tid, (body: unknown) => fx.put(ctx.tid, "/config", body), "Configuración guardada");
  const seed = useFixtureMutation(ctx.tid, (body: unknown) => fx.post(ctx.tid, "/seed-by-ranking", body), "Cabezas de serie definidas por ranking");
  const dirty = JSON.stringify(cfg) !== JSON.stringify(state.config);
  const set = <K extends keyof FixtureConfig>(k: K, v: FixtureConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const setMatch = <K extends keyof FixtureConfig["match"]>(k: K, v: FixtureConfig["match"][K]) => setCfg((c) => ({ ...c, match: { ...c.match, [k]: v } }));
  const structureLocked = state.matches.length > 0;
  const groupsLocked = state.groups.length > 0;
  const cupsLocked = state.matches.some((m) => m.phase !== "grupos");
  const moveTb = (i: number, d: -1 | 1) => {
    const list = [...cfg.tiebreakers];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    set("tiebreakers", list);
  };
  const unused = GROUP_TIEBREAKERS.filter((t) => !cfg.tiebreakers.includes(t));
  const ro = ctx.readOnly;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Formato" subtitle="Cómo se juega esta categoría." />
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-2" role="radiogroup" aria-label="Formato">
            {(Object.keys(FIXTURE_FORMAT_LABEL) as FixtureConfig["format"][]).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={cfg.format === f} disabled={ro || structureLocked} onClick={() => set("format", f)}
                className={cn("rounded-lg px-3 py-2 text-left text-sm ring-1 ring-inset disabled:opacity-60", cfg.format === f ? "bg-brand-50 font-semibold ring-brand-600" : "bg-white ring-slate-300 hover:bg-slate-50")}>
                {FIXTURE_FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
          {structureLocked && <p className="text-xs text-slate-500">Con partidos armados, el formato queda fijo.</p>}
          <TextField label="Cupo de parejas" type="number" min={2} max={64} disabled={ro} value={cfg.maxTeams ?? ""} placeholder="Sin límite"
            onChange={(e) => set("maxTeams", e.target.value === "" ? null : num(e.target.value, 2))} hint={`Inscriptas: ${state.teams.length}.`} />
          {cfg.format === "grupos_copas" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Cantidad de grupos" type="number" min={1} max={8} disabled={ro || groupsLocked} value={cfg.groupCount} onChange={(e) => set("groupCount", num(e.target.value, 1))} />
                <TextField label="Pasan a Copa de Oro (por grupo)" type="number" min={1} max={16} disabled={ro || cupsLocked} value={cfg.goldPerGroup} onChange={(e) => set("goldPerGroup", num(e.target.value, 1))} hint="Los primeros de cada grupo." />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label="Copa de Plata" disabled={ro || cupsLocked} value={cfg.silver} onChange={(e) => set("silver", e.target.value as FixtureConfig["silver"])}>
                  <option value="resto">Con todas las restantes</option>
                  <option value="cantidad">Con una cantidad por grupo</option>
                  <option value="ninguna">Sin Copa de Plata</option>
                </SelectField>
                {cfg.silver === "cantidad" && <TextField label="Pasan a Copa de Plata (por grupo)" type="number" min={1} max={16} disabled={ro || cupsLocked} value={cfg.silverPerGroup} onChange={(e) => set("silverPerGroup", num(e.target.value, 1))} />}
              </div>
              {groupsLocked && <p className="text-xs text-slate-500">Para cambiar la cantidad de grupos, primero borrá los grupos (sólo sin resultados).</p>}
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Partidos" subtitle="Reglamento: 3 sets con tie break en 6-6." />
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Sets" disabled={ro} value={cfg.match.setsToWin} onChange={(e) => setMatch("setsToWin", Number(e.target.value))}>
              <option value={1}>A 1 set</option><option value={2}>Al mejor de 3</option><option value={3}>Al mejor de 5</option>
            </SelectField>
            <TextField label="Games por set" type="number" min={3} max={9} disabled={ro} value={cfg.match.gamesPerSet} onChange={(e) => setMatch("gamesPerSet", num(e.target.value, 6))} />
          </div>
          <Checkbox label={`Tie break en ${cfg.match.gamesPerSet}-${cfg.match.gamesPerSet}`} checked={cfg.match.tiebreak} onChange={(v) => !ro && setMatch("tiebreak", v)} />
          {cfg.match.setsToWin > 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Último set" disabled={ro} value={cfg.match.finalSet} onChange={(e) => setMatch("finalSet", e.target.value as FixtureConfig["match"]["finalSet"])}>
                <option value="set">Set completo</option><option value="super_tiebreak">Súper tie break</option>
              </SelectField>
              {cfg.match.finalSet === "super_tiebreak" && <TextField label="Súper tie break a" type="number" min={7} max={15} disabled={ro} value={cfg.match.superTiebreakPoints} onChange={(e) => setMatch("superTiebreakPoints", num(e.target.value, 10))} />}
            </div>
          )}
          <SelectField label="W.O. en la tabla" disabled={ro} value={cfg.walkover} onChange={(e) => set("walkover", e.target.value as FixtureConfig["walkover"])}
            hint="El reglamento publicado no lo define: confirmalo con la organización.">
            <option value="sin_games">Cuenta el partido, sin sets ni games</option>
            <option value="como_resultado">Como victoria {cfg.match.gamesPerSet}-0 en los sets necesarios</option>
          </SelectField>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Desempates en la tabla de posiciones" subtitle="Se aplican en este orden. Si un empate sigue sin resolverse, se define a mano (por ejemplo, por sorteo)." />
        <div className="space-y-3 p-4 sm:p-5">
          <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">El reglamento publicado no fija el orden de desempate: revisalo antes de empezar la competencia.</p>
          <ol className="space-y-1.5">
            {cfg.tiebreakers.map((t, i) => (
              <li key={t} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-inset ring-slate-200">
                <span className="w-5 text-sm font-bold text-brand-700">{i + 1}.</span>
                <span className="flex-1 text-sm">{GROUP_TIEBREAKER_LABEL[t]}</span>
                {!ro && (
                  <>
                    <button type="button" className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30" disabled={i === 0} onClick={() => moveTb(i, -1)} aria-label="Subir"><ArrowUp className="size-4" /></button>
                    <button type="button" className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30" disabled={i === cfg.tiebreakers.length - 1} onClick={() => moveTb(i, 1)} aria-label="Bajar"><ArrowDown className="size-4" /></button>
                    <button type="button" className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30" disabled={cfg.tiebreakers.length === 1} onClick={() => set("tiebreakers", cfg.tiebreakers.filter((x) => x !== t))} aria-label="Quitar"><X className="size-4" /></button>
                  </>
                )}
              </li>
            ))}
          </ol>
          {!ro && unused.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {unused.map((t: GroupTiebreaker) => <Button key={t} size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => set("tiebreakers", [...cfg.tiebreakers, t])}>{GROUP_TIEBREAKER_LABEL[t]}</Button>)}
            </div>
          )}
        </div>
      </Card>

      {!ro && (
        <div className="space-y-2 lg:col-span-2">
          <ErrorNote message={save.error} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate({ version: state.version, config: cfg })}>Guardar configuración</Button>
            {dirty && <Button variant="ghost" onClick={() => setCfg(state.config)}>Descartar cambios</Button>}
          </div>
        </div>
      )}

      {!ro && !state.groups.length && !state.matches.length && (
        <Card className="lg:col-span-2">
          <CardHeader title="Cabezas de serie por ranking" subtitle="Ordena por la suma de puntos de la temporada de los dos integrantes (como en el Master). También se pueden cargar a mano en Parejas." />
          <div className="flex flex-wrap items-end gap-3 p-4 sm:p-5">
            <TextField label="Cantidad de cabezas de serie" type="number" min={0} max={64} value={seedCount} onChange={(e) => setSeedCount(e.target.value)} containerClassName="w-56" />
            <Button variant="secondary" icon={<Wand2 className="size-4" />} loading={seed.isPending} onClick={() => seed.mutate({ version: state.version, count: num(seedCount, 0) })}>Definir por ranking</Button>
            <ErrorNote message={seed.error} />
          </div>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────── Grupos y parejas ───────────────────────────
export function GroupsPanel({ ctx }: { ctx: FxCtx }) {
  const { state } = ctx;
  const active = state.teams.filter((t) => !t.withdrawn);
  const hasResults = state.matches.some((m) => m.phase === "grupos" && m.status !== "pendiente");
  const hasBrackets = state.matches.some((m) => m.phase !== "grupos");
  const editable = !ctx.readOnly && !hasResults && !hasBrackets;
  const [draft, setDraft] = useState<number[][] | null>(null);
  const [withdrawing, setWithdrawing] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveGroups = useFixtureMutation(ctx.tid, (body: unknown) => fx.put(ctx.tid, "/groups", body), "Grupos confirmados y partidos generados");
  const delGroups = useFixtureMutation(ctx.tid, (body: unknown) => fx.del(ctx.tid, "/groups", body), "Grupos borrados");
  const reinstate = useFixtureMutation(ctx.tid, (teamId: number) => fx.post(ctx.tid, `/teams/${teamId}/reinstate`, { version: state.version }), "Retiro deshecho");
  const count = state.config.groupCount;

  const propose = (draw: boolean) => setDraft(distributeGroups(drawOrder(state.teams, draw ? Math.floor(Math.random() * 2 ** 31) : null), count).map((g) => g.map((t) => t.id)));
  const moveTo = (teamId: number, gi: number) => setDraft((d) => d!.map((g, i) => (i === gi ? [...g.filter((x) => x !== teamId), teamId] : g.filter((x) => x !== teamId))));
  const name = (id: number) => state.teams.find((t) => t.id === id)?.name ?? `Pareja ${id}`;
  const seedOf = (id: number) => state.teams.find((t) => t.id === id)?.seed;

  if (state.config.format !== "grupos_copas") {
    return <TeamsCard ctx={ctx} onWithdraw={setWithdrawing} reinstate={(id) => reinstate.mutate(id)} withdrawing={withdrawing} setWithdrawing={setWithdrawing} />;
  }

  return (
    <div className="space-y-6">
      {draft ? (
        <Card>
          <CardHeader title="Armado de grupos" subtitle="Propuesta en serpentina: las cabezas de serie quedan en grupos distintos. Podés mover parejas antes de confirmar." />
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
            {draft.map((g, gi) => (
              <div key={gi} className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                <h4 className="mb-2 font-display text-sm font-bold uppercase text-navy">Grupo {groupName(gi)} <span className="font-sans text-xs font-normal text-slate-500">({g.length})</span></h4>
                <ul className="space-y-1.5">
                  {g.map((id) => (
                    <li key={id} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-sm ring-1 ring-inset ring-slate-200">
                      <span className="min-w-0 flex-1 truncate">{seedOf(id) ? <Badge tone="green">CS {seedOf(id)}</Badge> : null} {name(id)}</span>
                      <select aria-label={`Mover ${name(id)}`} value={gi} onChange={(e) => moveTo(id, Number(e.target.value))} className="h-8 rounded-md border-0 py-0 pl-2 pr-7 text-xs ring-1 ring-inset ring-slate-300">
                        {draft.map((_, i) => <option key={i} value={i}>Grupo {groupName(i)}</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t border-slate-100 p-4 sm:p-5">
            <ErrorNote message={saveGroups.error} />
            <div className="flex flex-wrap gap-2">
              <Button loading={saveGroups.isPending} disabled={draft.some((g) => g.length < 2)} onClick={() => saveGroups.mutate({ version: state.version, groups: draft }, { onSuccess: () => setDraft(null) })}>Confirmar grupos y generar partidos</Button>
              <Button variant="secondary" icon={<Dices className="size-4" />} onClick={() => propose(true)}>Sortear de nuevo</Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button>
            </div>
            {draft.some((g) => g.length < 2) && <p className="text-xs text-red-600">Cada grupo necesita al menos 2 parejas.</p>}
          </div>
        </Card>
      ) : state.groups.length === 0 ? (
        <Card>
          <CardHeader title="Grupos" subtitle={`${count} grupo${count === 1 ? "" : "s"} configurado${count === 1 ? "" : "s"} · ${active.length} parejas activas`} />
          <div className="space-y-3 p-4 sm:p-5">
            {active.length < count * 2 ? (
              <p className="text-sm text-slate-600">Se necesitan al menos {count * 2} parejas para {count} grupo(s). Inscribilas en la pestaña Parejas.</p>
            ) : !ctx.readOnly && (
              <div className="flex flex-wrap gap-2">
                <Button icon={<Wand2 className="size-4" />} onClick={() => propose(false)}>Proponer grupos (orden de inscripción)</Button>
                <Button variant="secondary" icon={<Dices className="size-4" />} onClick={() => propose(true)}>Proponer con sorteo</Button>
              </div>
            )}
            <p className="text-xs text-slate-500">Las cabezas de serie (pestaña Parejas o «Definir por ranking» en Configuración) van primero, una por grupo.</p>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Grupos" subtitle={hasResults ? "Con resultados cargados los grupos quedan fijos." : "Todavía sin resultados: se pueden rearmar."}
            action={editable ? (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDraft(state.groups.map((g) => [...g.teamIds]))}>Rearmar</Button>
                <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>Borrar</Button>
              </div>
            ) : undefined} />
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
            {state.groups.map((g) => (
              <div key={g.id} className="rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                <h4 className="mb-2 font-display text-sm font-bold uppercase text-navy">Grupo {g.name}</h4>
                <ul className="space-y-1 text-sm">{g.teamIds.map((id) => <li key={id} className="truncate">{seedOf(id) ? <Badge tone="green">CS {seedOf(id)}</Badge> : null} {name(id)}</li>)}</ul>
              </div>
            ))}
          </div>
          <ErrorNote message={delGroups.error} />
        </Card>
      )}

      <TeamsCard ctx={ctx} onWithdraw={setWithdrawing} reinstate={(id) => reinstate.mutate(id)} withdrawing={withdrawing} setWithdrawing={setWithdrawing} />
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Borrar grupos" message="Se borran los grupos y sus partidos (todavía sin resultados). Las parejas no se tocan."
        confirmLabel="Borrar grupos" onConfirm={() => delGroups.mutateAsync({ version: state.version })} />
    </div>
  );
}

function TeamsCard({ ctx, withdrawing, setWithdrawing, onWithdraw, reinstate }: { ctx: FxCtx; withdrawing: number | null; setWithdrawing: (v: number | null) => void; onWithdraw: (id: number) => void; reinstate: (id: number) => void }) {
  const { state } = ctx;
  return (
    <Card>
      <CardHeader title={`Parejas (${state.teams.length})`} subtitle="Las altas, bajas y cabezas de serie se cargan en la pestaña Parejas. Una vez en el fixture, la pareja queda fija: si no puede seguir, registrá su retiro." />
      <ul className="divide-y divide-slate-100">
        {state.teams.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5">
            <span className={cn("min-w-0 flex-1 text-sm", t.withdrawn && "text-slate-400 line-through")}>{t.seed ? <Badge tone="green">CS {t.seed}</Badge> : null} {t.name}</span>
            {t.withdrawn && <Badge tone="amber">Retirada{t.withdrawnReason ? `: ${t.withdrawnReason}` : ""}</Badge>}
            {!ctx.readOnly && (t.withdrawn
              ? <Button size="sm" variant="ghost" icon={<UserPlus className="size-4" />} onClick={() => reinstate(t.id)}>Deshacer retiro</Button>
              : <Button size="sm" variant="ghost" icon={<UserMinus className="size-4" />} onClick={() => onWithdraw(t.id)}>Retirar</Button>)}
          </li>
        ))}
      </ul>
      {withdrawing !== null && <WithdrawModal ctx={ctx} teamId={withdrawing} onClose={() => setWithdrawing(null)} />}
    </Card>
  );
}

function WithdrawModal({ ctx, teamId, onClose }: { ctx: FxCtx; teamId: number; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [walkover, setWalkover] = useState(true);
  const m = useFixtureMutation(ctx.tid, (body: unknown) => fx.post(ctx.tid, `/teams/${teamId}/withdraw`, body), "Retiro registrado");
  const team = ctx.state.teams.find((t) => t.id === teamId);
  const pending = ctx.state.matches.filter((x) => x.status === "pendiente" && x.team1Id !== null && x.team2Id !== null && (x.team1Id === teamId || x.team2Id === teamId)).length;
  return (
    <Modal open onClose={onClose} title="Retirar pareja" description={team?.name}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button variant="danger" loading={m.isPending} disabled={reason.trim().length < 3} onClick={() => m.mutate({ version: ctx.state.version, reason, walkover }, { onSuccess: onClose })}>Registrar retiro</Button></>}>
      <div className="space-y-4">
        <ErrorNote message={m.error} />
        <TextField label="Motivo" required value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        <Checkbox label={`Dar por perdidos por W.O. sus ${pending} partido(s) pendiente(s)`} checked={walkover} onChange={setWalkover}
          hint="Los partidos ya jugados se conservan. La pareja queda al final de la tabla de su grupo." />
      </div>
    </Modal>
  );
}
