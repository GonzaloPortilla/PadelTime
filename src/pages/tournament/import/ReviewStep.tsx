import { useMemo } from "react";
import { AlertCircle, AlertTriangle, ArrowRight, Check, CornerDownRight, Trophy, Wand2 } from "lucide-react";
import { addFinalRound, fillNextRounds, interpret, ROUND_LABEL, STAGE_KEY_LABEL, type BracketDraft, type DraftSide } from "@/ocr/bracket";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

interface Props {
  draft: BracketDraft;
  onChange: (d: BracketDraft) => void;
  onBack: () => void;
  onNext: () => void;
  mode: "estructura" | "texto" | "manual";
}

const SOURCE_LABEL = { manual: "elegido a mano", resultado: "por resultado", avance: "avanza de ronda", indicador: "por indicador" } as const;

export function ReviewStep({ draft, onChange, onBack, onNext, mode }: Props) {
  const result = useMemo(() => interpret(draft), [draft]);
  const errors = result.issues.filter((i) => i.level === "error");
  const warnings = result.issues.filter((i) => i.level === "warning");
  const champion = result.teams.find((t) => t.key === result.champion);
  const finalists = result.teams.filter((t) => t.stage === "finalista");
  const hasEmptySlots = draft.matches.some((m) => m.round > 0 && m.sides.some((s) => !s.text.trim()));
  const missingFinal = draft.rounds.length > 0 && draft.rounds[draft.rounds.length - 1]!.key !== "finalista";

  const update = (matchId: string, side: 0 | 1, patch: Partial<DraftSide>) =>
    onChange({
      ...draft,
      matches: draft.matches.map((m) =>
        m.id !== matchId ? m : { ...m, sides: m.sides.map((s, i) => (i === side ? { ...s, ...patch, conf: patch.text !== undefined ? null : s.conf } : s)) as [DraftSide, DraftSide] },
      ),
    });
  const setWinner = (matchId: string, w: 0 | 1 | null) => onChange({ ...draft, matches: draft.matches.map((m) => (m.id === matchId ? { ...m, winnerOverride: w } : m)) });

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Revisión del cuadro</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {mode === "manual" ? "Completá los nombres y resultados." : `Se reconocieron ${draft.matches.length} partidos en ${draft.rounds.length} rondas${mode === "texto" ? " (lectura aproximada: revisá con atención)" : ""}.`}
              {" "}Corregí cualquier dato: el resultado se recalcula al instante.
            </p>
          </div>
          {missingFinal && (
            <Button size="sm" variant="secondary" onClick={() => onChange(fillNextRounds(addFinalRound(draft)))}>Agregar la final</Button>
          )}
          {hasEmptySlots && (
            <Button size="sm" variant="secondary" icon={<Wand2 className="size-4" />} onClick={() => onChange(fillNextRounds(draft))}>
              Completar rondas con los ganadores
            </Button>
          )}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="bracket-summary">
          <div className={cn("flex items-center gap-3 rounded-lg p-3 ring-1 ring-inset", champion ? "bg-ball-300/40 ring-ball-500/40" : "bg-red-50 ring-red-200")}>
            <Trophy className={cn("size-5 shrink-0", champion ? "text-ink-900" : "text-red-600")} />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Campeones</p>
              <p className="truncate text-sm font-semibold text-slate-900" data-testid="champion">{champion?.text ?? "Sin determinar"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <Trophy className="size-5 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Finalistas</p>
              <p className="truncate text-sm font-semibold text-slate-900" data-testid="finalists">{finalists[0]?.text ?? "Sin determinar"}</p>
            </div>
          </div>
        </div>
        {result.markMeaning && <p className="mt-2 text-xs text-slate-500">Indicador detectado: la marca “X” señala al {result.markMeaning} del partido.</p>}
      </Card>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="space-y-2" data-testid="review-issues">
          {errors.map((i, k) => (
            <p key={`e${k}`} className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200"><AlertCircle className="mt-0.5 size-4 shrink-0" />{i.message}</p>
          ))}
          {warnings.map((i, k) => (
            <p key={`w${k}`} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{i.message}</p>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:overflow-x-auto lg:pb-2">
        {draft.rounds.map((round, r) => (
          <section key={r} className="lg:w-[27rem] lg:shrink-0" aria-label={round.label}>
            <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span>{ROUND_LABEL[round.key]}</span>
              {round.label && round.label.toUpperCase() !== ROUND_LABEL[round.key]!.toUpperCase() && <span className="font-normal normal-case text-slate-400">leído: “{round.label}”</span>}
            </h3>
            <div className="space-y-3">
              {draft.matches.filter((m) => m.round === r).map((m) => {
                const im = result.matches.find((x) => x.id === m.id);
                const hasIssue = result.issues.some((i) => i.matchId === m.id);
                return (
                  <div key={m.id} data-testid="match-card" className={cn("rounded-xl bg-white p-2.5 shadow-sm ring-1", hasIssue ? "ring-amber-300" : "ring-slate-200")}>
                    {m.sides.map((s, si) => {
                      const isWinner = im?.winner === si;
                      return (
                        <div key={si} className={cn("rounded-lg p-1.5", isWinner && "bg-brand-50")}>
                          {s.image && <img src={s.image} alt={`Texto original: ${s.text}`} className="mb-1 h-5 max-w-full rounded-sm object-contain object-left opacity-90" />}
                          <div className="flex items-center gap-1.5">
                            <input
                              aria-label={`Pareja ${si + 1} del partido ${m.id}`}
                              value={s.text}
                              placeholder="NOMBRE APELLIDO - NOMBRE APELLIDO"
                              onChange={(e) => update(m.id, si as 0 | 1, { text: e.target.value.toUpperCase() })}
                              className={cn("h-8 min-w-0 flex-1 rounded-md border-0 px-2 text-[11px] font-medium uppercase ring-1 ring-inset focus:ring-2 focus:ring-brand-600",
                                s.conf !== null && s.conf < 70 ? "bg-amber-50 ring-amber-300" : "bg-white ring-slate-300")}
                            />
                            <input
                              aria-label={`Resultado de la pareja ${si + 1} del partido ${m.id}`}
                              value={s.score ?? ""}
                              inputMode="numeric"
                              placeholder="–"
                              onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 2); update(m.id, si as 0 | 1, { score: v === "" ? null : Number(v) }); }}
                              className={cn("h-8 w-9 rounded-md border-0 text-center text-sm font-bold tabular ring-1 ring-inset focus:ring-2 focus:ring-brand-600",
                                s.score === null ? "bg-amber-50 ring-amber-300" : "ring-slate-300")}
                            />
                            {s.marked !== null && (
                              <button type="button" title="Indicador (X) leído en la imagen" onClick={() => update(m.id, si as 0 | 1, { marked: !s.marked })}
                                className={cn("h-8 w-6 rounded-md text-xs font-bold", s.marked ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-300")}>X</button>
                            )}
                            <button type="button" aria-label={`Marcar ganadora a la pareja ${si + 1} del partido ${m.id}`} aria-pressed={m.winnerOverride === si}
                              onClick={() => setWinner(m.id, m.winnerOverride === si ? null : (si as 0 | 1))}
                              className={cn("flex h-8 w-8 items-center justify-center rounded-md ring-1 ring-inset",
                                isWinner ? "bg-brand-700 text-white ring-brand-700" : "text-slate-300 ring-slate-200 hover:text-slate-500")}>
                              <Check className="size-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    <p className="mt-1 px-1.5 text-[11px] text-slate-400">
                      {im?.winner === null || !im ? "Ganador sin determinar" : `Ganador ${im.sources.map((x) => SOURCE_LABEL[x]).join(" + ")}`}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <Card>
        <CardHeader title="Instancia final deducida" subtitle="Cada pareja recibe la instancia más avanzada que alcanzó. No hace falta cargar partido por partido." />
        <ul className="divide-y divide-slate-100" data-testid="deduced-list">
          {[...result.teams].sort((a, b) => order(a.stage) - order(b.stage)).map((t) => (
            <li key={t.key} className="flex items-center gap-3 px-4 py-2 text-sm sm:px-5">
              <CornerDownRight className="size-4 shrink-0 text-slate-300" />
              <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{t.text}</span>
              <span className="hidden text-xs text-slate-400 sm:inline">{t.matchesPlayed} PJ · {t.matchesWon} PG</span>
              <Badge tone={t.stage === "campeon" ? "lime" : t.stage === "finalista" ? "green" : t.stage ? "gray" : "red"}>{t.stage ? STAGE_KEY_LABEL[t.stage] : "Sin determinar"}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="secondary" onClick={onBack}>Volver a la imagen</Button>
        <Button icon={<ArrowRight className="size-4" />} disabled={!result.canImport} onClick={onNext}>
          {result.canImport ? "Continuar con los jugadores" : `Corregí ${errors.length} error${errors.length === 1 ? "" : "es"} para continuar`}
        </Button>
      </div>
    </div>
  );
}

const ORDER = ["campeon", "finalista", "semifinal", "cuartos", "octavos", "16avos", "32avos"];
const order = (s: string | null) => (s ? ORDER.indexOf(s) : 99);
