import { matchPlayer, normalizeName, suggestNewPlayer, type PlayerMatch } from "@shared/names";
import type { DirectoryEntry } from "@shared/types";
import type { Interpretation } from "@/ocr/bracket";

export type Resolution =
  | { kind: "existing"; playerId: number }
  | { kind: "new"; firstName: string; lastName: string; categoryId: number; confirmed: boolean }
  | { kind: "pending" };

/** Un integrante de una pareja del cuadro, con su vinculación a un jugador. */
export interface Slot {
  id: string; // `${teamKey}:${index}`
  teamKey: number;
  teamText: string;
  ocrName: string;
  match: PlayerMatch;
  resolution: Resolution;
}

export function buildSlots(result: Interpretation, directory: DirectoryEntry[], defaultCategoryId: number, previous?: Slot[]): Slot[] {
  const prevByName = new Map((previous ?? []).map((s) => [`${s.teamKey}:${normalizeName(s.ocrName)}`, s]));
  return result.teams.flatMap((t) =>
    t.players.map((name, i) => {
      const prev = prevByName.get(`${t.key}:${normalizeName(name)}`);
      const match = matchPlayer(name, directory);
      let resolution: Resolution;
      if (prev) resolution = prev.resolution;
      else if ((match.status === "exacto" || match.status === "probable") && match.candidates[0]!.player.active) {
        resolution = { kind: "existing", playerId: match.candidates[0]!.player.id };
      } else if (match.status === "desconocido") {
        const s = suggestNewPlayer(name);
        resolution = { kind: "new", firstName: s.firstName, lastName: s.lastName, categoryId: defaultCategoryId, confirmed: false };
      } else resolution = { kind: "pending" };
      return { id: `${t.key}:${i}`, teamKey: t.key, teamText: t.text, ocrName: name, match, resolution };
    }),
  );
}

export interface SlotProblem { slotId: string; message: string }

export function slotProblems(slots: Slot[], directory: DirectoryEntry[]): SlotProblem[] {
  const problems: SlotProblem[] = [];
  const used = new Map<number, string>();
  for (const s of slots) {
    const r = s.resolution;
    if (r.kind === "pending") problems.push({ slotId: s.id, message: `Elegí qué jugador es “${s.ocrName}”.` });
    else if (r.kind === "new") {
      if (!r.firstName.trim() || !r.lastName.trim()) problems.push({ slotId: s.id, message: `Completá nombre y apellido para crear a “${s.ocrName}”.` });
      else if (!r.confirmed) problems.push({ slotId: s.id, message: `Confirmá la creación de ${r.firstName} ${r.lastName}.` });
    } else {
      const p = directory.find((d) => d.id === r.playerId);
      if (p && !p.active) problems.push({ slotId: s.id, message: `${p.firstName} ${p.lastName} está inactivo: reactivalo o elegí otro jugador.` });
      const other = used.get(r.playerId);
      if (other) problems.push({ slotId: s.id, message: `${p ? `${p.firstName} ${p.lastName}` : "Un jugador"} quedó vinculado a dos nombres distintos (“${other}” y “${s.ocrName}”).` });
      used.set(r.playerId, s.ocrName);
    }
  }
  // Dos jugadores nuevos idénticos (mismo nombre en dos parejas) también es sospechoso.
  const newNames = new Map<string, string>();
  for (const s of slots) {
    if (s.resolution.kind !== "new") continue;
    const key = normalizeName(`${s.resolution.firstName} ${s.resolution.lastName}`);
    if (newNames.has(key)) problems.push({ slotId: s.id, message: `Se crearían dos jugadores llamados “${s.resolution.firstName} ${s.resolution.lastName}”. Si es la misma persona, no puede estar en dos parejas.` });
    newNames.set(key, s.id);
  }
  return problems;
}
