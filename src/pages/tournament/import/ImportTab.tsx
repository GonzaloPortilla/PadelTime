import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import type { BracketImportRecord, DirectoryEntry, Player, Tournament } from "@shared/types";
import { api, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { keys, useCategories } from "@/hooks/data";
import { draftFromRaw, emptyDraft, interpret, type BracketDraft } from "@/ocr/bracket";
import type { RawBracket } from "@/ocr/recognize";
import { Card, CardHeader, ErrorState, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { useTournamentData } from "../TeamsTab";
import { ImageStep } from "./ImageStep";
import { ReviewStep } from "./ReviewStep";
import { PlayersStep } from "./PlayersStep";
import { ConfirmStep, type ConfirmRow } from "./ConfirmStep";
import { buildSlots, type Slot } from "./linking";

type Step = "imagen" | "revision" | "jugadores" | "confirmar";
const STEPS: { key: Step; label: string }[] = [
  { key: "imagen", label: "Imagen" },
  { key: "revision", label: "Cuadro" },
  { key: "jugadores", label: "Jugadores" },
  { key: "confirmar", label: "Confirmar" },
];

/** Cantidad de datos que el organizador corrigió respecto de lo leído. */
function countCorrections(original: BracketDraft | null, current: BracketDraft): number {
  if (!original) return 0;
  let n = 0;
  for (const m of current.matches) {
    const o = original.matches.find((x) => x.id === m.id);
    if (!o) continue;
    if (m.winnerOverride !== null) n++;
    m.sides.forEach((s, i) => {
      if (s.text !== o.sides[i]!.text) n++;
      if (s.score !== o.sides[i]!.score) n++;
    });
  }
  return n;
}

export function ImportTab({ tournament, onDone, onManualLoad }: { tournament: Tournament; onDone: () => void; onManualLoad: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const categories = useCategories();
  const { scoring, teams } = useTournamentData(tournament.id);
  const [step, setStep] = useState<Step>("imagen");
  const [draft, setDraft] = useState<BracketDraft | null>(null);
  const original = useRef<BracketDraft | null>(null);
  const [source, setSource] = useState<{ fileName: string | null; mode: "estructura" | "texto" | "manual"; elapsedMs: number | null }>({ fileName: null, mode: "manual", elapsedMs: null });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const directory = useQuery({
    queryKey: ["players", "directory", tournament.gender],
    queryFn: async () => (await api.get<{ items: DirectoryEntry[] }>(`/players/directory?gender=${tournament.gender}`)).items,
  });
  const history = useQuery({
    queryKey: [...keys.tournaments, tournament.id, "imports"],
    queryFn: async () => (await api.get<{ items: BracketImportRecord[] }>(`/tournaments/${tournament.id}/imports`)).items,
  });
  const result = useMemo(() => (draft ? interpret(draft) : null), [draft]);

  if (scoring.isPending || teams.isPending || directory.isPending || categories.isPending) return <Spinner />;
  if (directory.isError) return <ErrorState message={directory.error.message} />;
  const locked = scoring.data?.locked ?? null;
  if (locked) return <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-600">{locked}</p>;
  const config = scoring.data?.item;
  if (!config) {
    return <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">Configurá la puntuación del torneo (pestaña Puntuación) antes de importar un cuadro.</p>;
  }

  const goPlayers = () => {
    setSlots((prev) => buildSlots(result!, directory.data!, tournament.categoryId, prev));
    setStep("jugadores");
  };

  const doImport = async (rows: ConfirmRow[], mode: "reemplazar" | "agregar") => {
    setBusy(true);
    setError(null);
    try {
      // 1) Jugadores nuevos confirmados por el organizador (uno por uno, con las validaciones habituales).
      const created = new Map<string, number>();
      for (const s of slots) {
        if (s.resolution.kind !== "new") continue;
        const r = s.resolution;
        const res = await api.post<{ item: Player }>("/players", {
          firstName: r.firstName.trim(), lastName: r.lastName.trim(), gender: tournament.gender, mainCategoryId: r.categoryId,
          notes: `Creado desde la importación de un cuadro (${tournament.name}). Texto leído: "${s.ocrName}".`,
        });
        created.set(s.id, res.item.id);
        // Si la importación falla después, al reintentar estos jugadores ya existen y se vinculan solos.
        setSlots((prev) => prev.map((x) => (x.id === s.id ? { ...x, resolution: { kind: "existing", playerId: res.item.id } } : x)));
      }
      const playerId = (s: Slot) => (s.resolution.kind === "existing" ? s.resolution.playerId : created.get(s.id)!);
      // 2) Parejas + instancias (una sola operación atómica). No acredita puntos.
      const corrected = countCorrections(original.current, draft!);
      await api.post(`/tournaments/${tournament.id}/import`, {
        mode,
        teams: rows.map((r) => ({
          player1Id: playerId(r.slots[0]!), player2Id: playerId(r.slots[1]!), stageId: r.stageId, matchesPlayed: r.matchesPlayed, matchesWon: r.matchesWon,
        })),
        source: {
          fileName: source.fileName,
          recognitionMode: source.mode,
          elapsedMs: source.elapsedMs,
          createdPlayers: created.size,
          correctedFields: corrected,
          warnings: result!.issues.filter((i) => i.level === "warning").map((i) => i.message).slice(0, 200),
          summary: rows.map((r) => ({ ocrText: r.ocrText.slice(0, 200), players: r.slots.map(playerId), stage: r.stageKey, corrected: false })),
        },
      });
      void qc.invalidateQueries({ queryKey: keys.tournaments });
      void qc.invalidateQueries({ queryKey: keys.players });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
      toast(`Cuadro importado: ${rows.length} parejas. Revisá y confirmá la acreditación.`);
      setDraft(null);
      setStep("imagen");
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo importar. Revisá la conexión y reintentá.");
      void qc.invalidateQueries({ queryKey: ["players", "directory"] });
    } finally {
      setBusy(false);
    }
  };

  const current = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="space-y-4">
      <ol className="flex items-center gap-1 overflow-x-auto text-xs font-medium" aria-label="Pasos de la importación">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1">
            <span className={cn("flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1",
              i === current ? "bg-ink-950 text-white" : i < current ? "bg-brand-50 text-brand-800" : "bg-slate-100 text-slate-400")}>
              <span className="tabular">{i + 1}</span>{s.label}
            </span>
            {i < STEPS.length - 1 && <span className="text-slate-300">›</span>}
          </li>
        ))}
      </ol>

      {step === "imagen" && (
        <ImageStep
          onRecognized={(raw: RawBracket, fileName) => {
            const d = draftFromRaw(raw);
            original.current = JSON.parse(JSON.stringify(d));
            setDraft(d);
            setSource({ fileName, mode: raw.mode, elapsedMs: raw.elapsedMs });
            setSlots([]);
            setStep("revision");
          }}
          onManual={(n) => {
            const d = emptyDraft(n);
            original.current = null;
            setDraft(d);
            setSource({ fileName: null, mode: "manual", elapsedMs: null });
            setSlots([]);
            setStep("revision");
          }}
          onManualLoad={onManualLoad}
        />
      )}
      {step === "revision" && draft && (
        <ReviewStep draft={draft} onChange={setDraft} mode={source.mode} onBack={() => setStep("imagen")} onNext={goPlayers} />
      )}
      {step === "jugadores" && result && (
        <PlayersStep tournament={tournament} slots={slots} directory={directory.data!} categories={categories.data ?? []}
          onChange={setSlots} onBack={() => setStep("revision")} onNext={() => setStep("confirmar")} />
      )}
      {step === "confirmar" && result && (
        <ConfirmStep result={result} slots={slots} directory={directory.data!} scoring={config} existingTeams={teams.data?.items ?? []}
          warnings={result.issues.filter((i) => i.level === "warning").map((i) => i.message)}
          busy={busy} error={error} onBack={() => setStep("jugadores")} onImport={(rows, mode) => void doImport(rows, mode)} />
      )}

      {step === "imagen" && history.data && history.data.length > 0 && (
        <Card>
          <CardHeader title="Importaciones anteriores" action={<History className="size-4 text-slate-400" />} />
          <ul className="divide-y divide-slate-100 text-sm">
            {history.data.map((h) => (
              <li key={h.id} className="px-4 py-2.5 sm:px-5">
                <p className="text-slate-800">{h.fileName ?? "Cuadro manual"} · {h.teamCount} parejas · {h.importMode === "reemplazar" ? "reemplazó" : "agregó"}</p>
                <p className="text-xs text-slate-500">
                  {h.createdByName ?? "—"} · {formatDateTime(h.createdAt)} · lectura {h.recognitionMode === "estructura" ? "por estructura" : h.recognitionMode === "texto" ? "por texto" : "manual"}
                  {h.correctedFields ? ` · ${h.correctedFields} correcciones` : ""}{h.createdPlayers ? ` · ${h.createdPlayers} jugadores creados` : ""}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
