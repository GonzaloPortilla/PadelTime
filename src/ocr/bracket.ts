/**
 * Interpretación de un cuadro eliminatorio: a partir de lo leído (o corregido por el organizador)
 * deduce ganadores, identifica las parejas que avanzan y calcula la instancia final de cada una.
 * Funciones puras: se recalculan en vivo mientras el organizador corrige datos.
 *
 * Nunca inventa: si un dato no se puede deducir con evidencia, queda vacío y se informa.
 */
import { nameSimilarity, normalizeName, splitTeam } from "@shared/names";
import type { StageConfig } from "@shared/scoring";

export type StageKey = "campeon" | "finalista" | "semifinal" | "cuartos" | "octavos" | "16avos" | "32avos";

export const STAGE_KEY_LABEL: Record<StageKey, string> = {
  campeon: "Campeón",
  finalista: "Finalista",
  semifinal: "Semifinal",
  cuartos: "Cuartos de final",
  octavos: "Octavos de final",
  "16avos": "16avos de final",
  "32avos": "32avos de final",
};

/** Rondas desde la final hacia atrás. */
const ROUND_FROM_END: StageKey[] = ["finalista", "semifinal", "cuartos", "octavos", "16avos", "32avos"];
export const ROUND_LABEL: Record<string, string> = {
  finalista: "Final", semifinal: "Semifinales", cuartos: "Cuartos de final", octavos: "Octavos de final", "16avos": "16avos de final", "32avos": "32avos de final",
};

export interface DraftSide {
  text: string;
  score: number | null;
  marked: boolean | null;
  /** Confianza del OCR (0-100) o null si fue escrito/corregido a mano. */
  conf: number | null;
  image?: string | null;
  scoreImage?: string | null;
}

export interface DraftMatch {
  id: string;
  round: number;
  sides: [DraftSide, DraftSide];
  /** Ganador elegido a mano (0 o 1). Tiene prioridad sobre lo deducido. */
  winnerOverride: 0 | 1 | null;
}

export interface DraftRound {
  /** Texto del encabezado leído (para mostrar). */
  label: string;
  key: StageKey;
}

export interface BracketDraft {
  rounds: DraftRound[];
  matches: DraftMatch[];
}

export interface Issue {
  level: "error" | "warning";
  message: string;
  matchId?: string;
  teamKey?: number;
}

export type WinnerSource = "manual" | "resultado" | "avance" | "indicador";

export interface InterpretedMatch {
  id: string;
  round: number;
  teamKeys: [number | null, number | null];
  winner: 0 | 1 | null;
  sources: WinnerSource[];
}

export interface InterpretedTeam {
  key: number;
  /** Nombres de los dos integrantes (texto elegido como más confiable). */
  players: string[];
  text: string;
  rounds: number[];
  stage: StageKey | null;
  matchesPlayed: number;
  matchesWon: number;
}

export interface Interpretation {
  matches: InterpretedMatch[];
  teams: InterpretedTeam[];
  issues: Issue[];
  champion: number | null;
  markMeaning: "perdedor" | "ganador" | null;
  canImport: boolean;
}

// ───────────────────────── Desde el OCR ─────────────────────────

export interface RawLike {
  blocks: { id: string; column: number; headerText: string; rows: { nameText: string; nameConf: number; nameImage?: string; score: number | null; scoreImage?: string | null; marked: boolean | null }[] }[];
}

/** Reconoce el nombre de una ronda en el texto de un encabezado. */
export function roundKeyFromText(text: string): StageKey | null {
  // Se conservan los dígitos ("16avos").
  const t = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!t) return null;
  if (t.includes("semi")) return "semifinal";
  if (t.includes("cuarto")) return "cuartos";
  if (t.includes("octavo")) return "octavos";
  if (t.includes("16") || t.includes("dieciseis")) return "16avos";
  if (t.includes("final")) return "finalista";
  return null;
}

const KEY_BY_COUNT: Record<number, StageKey> = { 1: "finalista", 2: "semifinal", 4: "cuartos", 8: "octavos", 16: "16avos", 32: "32avos" };

/**
 * Identifica la ronda de cada columna. En un cuadro eliminatorio cada ronda tiene la mitad de
 * partidos que la anterior (8, 4, 2, 1): esa cantidad es la señal más confiable, y permite
 * detectar que falta una ronda (p. ej. la final quedó fuera del recorte). Si el cuadro no es
 * estándar se usa el texto de los encabezados y, en último caso, la posición.
 */
export function roundKeys(counts: number[], headerKeys: (StageKey | null)[]): StageKey[] {
  const n = counts.length;
  const standard = counts.every((c, i) => KEY_BY_COUNT[c] && (i === 0 || c * 2 === counts[i - 1]));
  if (standard) return counts.map((c) => KEY_BY_COUNT[c]!);
  const order = ["32avos", "16avos", "octavos", "cuartos", "semifinal", "finalista"];
  const fromHeaders = headerKeys.every((k, i) => k && (i === 0 || order.indexOf(k) > order.indexOf(headerKeys[i - 1]!)));
  if (fromHeaders) return headerKeys as StageKey[];
  return counts.map((_, i) => ROUND_FROM_END[n - 1 - i] ?? "32avos");
}

/** Convierte la lectura del OCR en un borrador editable. Las rondas se ordenan por columna. */
export function draftFromRaw(raw: RawLike): BracketDraft {
  const columns = [...new Set(raw.blocks.map((b) => b.column))].sort((a, b) => a - b);
  const headerTexts = columns.map((col) => raw.blocks.filter((b) => b.column === col).map((b) => b.headerText));
  const headerKeys = headerTexts.map((texts) => {
    const votes = texts.map(roundKeyFromText).filter((k): k is StageKey => k !== null);
    return votes.sort((a, b) => votes.filter((v) => v === b).length - votes.filter((v) => v === a).length)[0] ?? null;
  });
  const keys = roundKeys(columns.map((col) => raw.blocks.filter((b) => b.column === col).length), headerKeys);
  const rounds: DraftRound[] = columns.map((_, i) => {
    const key = keys[i]!;
    const label = headerTexts[i]!.find((t) => roundKeyFromText(t)) ?? ROUND_LABEL[key]!;
    return { label, key };
  });
  const matches: DraftMatch[] = raw.blocks.map((b) => ({
    id: b.id,
    round: columns.indexOf(b.column),
    winnerOverride: null,
    sides: b.rows.slice(0, 2).map((r) => ({
      text: r.nameText,
      score: r.score,
      marked: r.marked,
      conf: r.nameConf,
      image: r.nameImage ?? null,
      scoreImage: r.scoreImage ?? null,
    })) as [DraftSide, DraftSide],
  }));
  return { rounds, matches };
}

// ───────────────────────── Interpretación ─────────────────────────

/** Similitud entre dos parejas leídas (sin importar el orden de los integrantes). */
export function teamSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const na = a.map(normalizeName);
  const nb = b.map(normalizeName);
  const whole = nameSimilarity(na.join(" "), nb.join(" "));
  if (na.length < 2 || nb.length < 2) return whole;
  const direct = (nameSimilarity(na[0]!, nb[0]!) + nameSimilarity(na[1]!, nb[1]!)) / 2;
  const crossed = (nameSimilarity(na[0]!, nb[1]!) + nameSimilarity(na[1]!, nb[0]!)) / 2;
  return Math.max(whole, direct, crossed);
}

export const SAME_TEAM_THRESHOLD = 0.86;
const LOW_CONFIDENCE = 70;

export function interpret(draft: BracketDraft): Interpretation {
  const issues: Issue[] = [];
  const lastRound = draft.rounds.length - 1;
  const hasFinal = draft.rounds[lastRound]?.key === "finalista";
  if (draft.rounds.length > 0 && !hasFinal) {
    issues.push({ level: "error", message: `No se encontró la final en la imagen (la última ronda reconocida es ${ROUND_LABEL[draft.rounds[lastRound]!.key]}). Agregala con el botón “Agregar la final” o revisá el recorte.` });
  }
  const roundName = (r: number) => ROUND_LABEL[draft.rounds[r]?.key ?? ""] ?? `Ronda ${r + 1}`;

  // 1) Lados: texto → integrantes.
  interface Side { matchIdx: number; side: 0 | 1; players: string[]; text: string; conf: number | null }
  const sides: Side[] = [];
  draft.matches.forEach((m, mi) => {
    m.sides.forEach((s, si) => {
      const text = s.text.trim();
      if (!text) {
        issues.push({ level: "error", matchId: m.id, message: `${roundName(m.round)}: falta el nombre de una pareja.` });
        return;
      }
      const split = splitTeam(text);
      if (split.players.length !== 2) {
        issues.push({ level: "error", matchId: m.id, message: `${roundName(m.round)}: no se distinguen los dos integrantes de "${text}". Separalos con un guion.` });
      } else if (!split.ok) {
        issues.push({ level: "warning", matchId: m.id, message: `${roundName(m.round)}: revisá cómo se separaron los integrantes de "${text}".` });
      }
      if (s.conf !== null && s.conf < LOW_CONFIDENCE) {
        issues.push({ level: "warning", matchId: m.id, message: `${roundName(m.round)}: lectura dudosa de "${text}" (confianza ${s.conf}%).` });
      }
      sides.push({ matchIdx: mi, side: si as 0 | 1, players: split.players, text, conf: s.conf });
    });
  });

  // 2) Agrupa en parejas los textos que se refieren a la misma pareja (en distintas rondas).
  const parent = sides.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < sides.length; i++) {
    for (let j = i + 1; j < sides.length; j++) {
      if (sides[i]!.matchIdx === sides[j]!.matchIdx) continue;
      if (teamSimilarity(sides[i]!.players, sides[j]!.players) >= SAME_TEAM_THRESHOLD) parent[find(i)] = find(j);
    }
  }
  const groupOf = new Map<number, number>();
  const groups: Side[][] = [];
  sides.forEach((s, i) => {
    const root = find(i);
    if (!groupOf.has(root)) { groupOf.set(root, groups.length); groups.push([]); }
    groups[groupOf.get(root)!]!.push(s);
  });
  const teamOfSide = new Map<string, number>();
  groups.forEach((g, key) => g.forEach((s) => teamOfSide.set(`${s.matchIdx}:${s.side}`, key)));

  const matchTeams = draft.matches.map((_, mi) => [teamOfSide.get(`${mi}:0`) ?? null, teamOfSide.get(`${mi}:1`) ?? null] as [number | null, number | null]);
  const roundsOfTeam = groups.map(() => new Set<number>());
  draft.matches.forEach((m, mi) => matchTeams[mi]!.forEach((t) => t !== null && roundsOfTeam[t]!.add(m.round)));

  // Una pareja no puede aparecer dos veces en la misma ronda.
  draft.matches.forEach((m, mi) => {
    const [a, b] = matchTeams[mi]!;
    if (a !== null && a === b) issues.push({ level: "error", matchId: m.id, message: `${roundName(m.round)}: la misma pareja figura en los dos lados del partido.` });
  });
  groups.forEach((g, key) => {
    const perRound = new Map<number, number>();
    for (const s of g) {
      const r = draft.matches[s.matchIdx]!.round;
      perRound.set(r, (perRound.get(r) ?? 0) + 1);
    }
    for (const [r, n] of perRound) {
      if (n > 1) issues.push({ level: "error", teamKey: key, message: `"${g[0]!.text}" figura ${n} veces en ${roundName(r)} (¿pareja duplicada o nombre mal leído?).` });
    }
  });

  // 3) Qué significa la marca: se aprende de los partidos con resultado claro.
  let markLoser = 0;
  let markWinner = 0;
  for (const m of draft.matches) {
    const [a, b] = m.sides;
    if (a.score === null || b.score === null || a.score === b.score) continue;
    if (a.marked === b.marked || a.marked === null || b.marked === null) continue;
    const markedIsLower = a.marked ? a.score < b.score : b.score < a.score;
    if (markedIsLower) markLoser++; else markWinner++;
  }
  const markMeaning = markLoser === 0 && markWinner === 0 ? null : markLoser >= markWinner ? "perdedor" : "ganador";
  if (markLoser > 0 && markWinner > 0) {
    issues.push({ level: "warning", message: `Las marcas no son consistentes: ${markLoser} indican al perdedor y ${markWinner} al ganador.` });
  }

  // 4) Ganador de cada partido, combinando evidencias.
  const matches: InterpretedMatch[] = draft.matches.map((m, mi) => {
    const [ta, tb] = matchTeams[mi]!;
    const votes: { source: WinnerSource; winner: 0 | 1 }[] = [];
    const [a, b] = m.sides;
    if (a.score !== null && b.score !== null && a.score !== b.score) votes.push({ source: "resultado", winner: a.score > b.score ? 0 : 1 });
    if (m.round < lastRound) {
      const advA = ta !== null && roundsOfTeam[ta]!.has(m.round + 1);
      const advB = tb !== null && roundsOfTeam[tb]!.has(m.round + 1);
      if (advA && !advB) votes.push({ source: "avance", winner: 0 });
      else if (advB && !advA) votes.push({ source: "avance", winner: 1 });
      else if (advA && advB) issues.push({ level: "error", matchId: m.id, message: `${roundName(m.round)}: las dos parejas aparecen en la ronda siguiente.` });
    }
    if (markMeaning && a.marked !== null && b.marked !== null && a.marked !== b.marked) {
      const markedSide: 0 | 1 = a.marked ? 0 : 1;
      votes.push({ source: "indicador", winner: markMeaning === "perdedor" ? (markedSide === 0 ? 1 : 0) : markedSide });
    }
    if (a.score !== null && b.score !== null && a.score === b.score) {
      issues.push({ level: "warning", matchId: m.id, message: `${roundName(m.round)}: resultado empatado (${a.score}-${b.score}).` });
    }
    let winner: 0 | 1 | null = null;
    let sources: WinnerSource[] = [];
    if (m.winnerOverride !== null) {
      winner = m.winnerOverride;
      sources = ["manual"];
    } else if (votes.length) {
      const distinct = new Set(votes.map((v) => v.winner));
      // Prioridad ante conflicto: avance (estructura del cuadro) > resultado > indicador.
      const pick = votes.find((v) => v.source === "avance") ?? votes.find((v) => v.source === "resultado") ?? votes[0]!;
      winner = pick.winner;
      sources = votes.filter((v) => v.winner === winner).map((v) => v.source);
      if (distinct.size > 1) {
        issues.push({ level: "warning", matchId: m.id, message: `${roundName(m.round)}: hay datos contradictorios (${votes.map((v) => `${v.source} → ${m.sides[v.winner].text || "?"}`).join("; ")}). Verificá el ganador.` });
      }
    } else if (ta !== null && tb !== null) {
      issues.push({
        level: m.round === lastRound ? "error" : "warning",
        matchId: m.id,
        message: `${roundName(m.round)}: no se puede determinar el ganador (resultado ilegible y sin otra evidencia). Elegilo a mano.`,
      });
    }
    return { id: m.id, round: m.round, teamKeys: [ta, tb], winner, sources };
  });

  // 5) Instancia final de cada pareja.
  const finalMatch = hasFinal ? matches.find((m) => m.round === lastRound) : undefined;
  const champion = finalMatch && finalMatch.winner !== null ? finalMatch.teamKeys[finalMatch.winner] : null;
  const teams: InterpretedTeam[] = groups.map((g, key) => {
    const rounds = [...roundsOfTeam[key]!].sort((a, b) => a - b);
    const maxRound = rounds[rounds.length - 1]!;
    // Texto más confiable: el de mayor confianza (o el corregido a mano).
    const bestSide = [...g].sort((x, y) => (y.conf ?? 101) - (x.conf ?? 101))[0]!;
    let stage: StageKey | null;
    if (maxRound === lastRound && hasFinal) {
      stage = champion === null ? null : champion === key ? "campeon" : "finalista";
    } else if (maxRound === lastRound) {
      // Falta la final: quien perdió en la última ronda reconocida queda en esa instancia;
      // quien ganó no tiene instancia hasta completar la final.
      const m = matches.find((x) => x.round === maxRound && x.teamKeys.includes(key));
      stage = m && m.winner !== null && m.teamKeys[m.winner] !== key ? draft.rounds[maxRound]!.key : null;
    } else {
      stage = draft.rounds[maxRound]!.key;
      const m = matches.find((x) => x.round === maxRound && x.teamKeys.includes(key));
      if (m && m.winner !== null && m.teamKeys[m.winner] === key) {
        issues.push({ level: "warning", teamKey: key, message: `"${bestSide.text}" ganó en ${roundName(maxRound)} pero no figura en ${roundName(maxRound + 1)} (¿nombre mal leído en la ronda siguiente?).` });
      }
    }
    for (let r = rounds[0]!; r < maxRound; r++) {
      if (!rounds.includes(r)) {
        issues.push({ level: "warning", teamKey: key, message: `"${bestSide.text}" figura en ${roundName(maxRound)} pero no en ${roundName(r)}.` });
        break;
      }
    }
    const won = matches.filter((m) => m.winner !== null && m.teamKeys[m.winner] === key).length;
    return { key, players: bestSide.players, text: bestSide.text, rounds, stage, matchesPlayed: rounds.length, matchesWon: won };
  });
  if (finalMatch && champion === null) {
    issues.push({ level: "error", matchId: finalMatch.id, message: "No se pudo determinar el campeón: elegí el ganador de la final." });
  }

  return { matches, teams, issues, champion, markMeaning, canImport: !issues.some((i) => i.level === "error") && teams.length > 0 };
}

// ─────────────── Vinculación con la puntuación del torneo ───────────────

const STAGE_PATTERNS: Record<StageKey, RegExp> = {
  campeon: /(^|[^b])campe/, finalista: /finalista|subcampe/, semifinal: /semi/, cuartos: /cuarto/, octavos: /octavo/, "16avos": /16|dieciseis/, "32avos": /32|treinta/,
};
const STAGE_RANK: Record<StageKey, number> = { campeon: 1, finalista: 2, semifinal: 3, cuartos: 4, octavos: 5, "16avos": 6, "32avos": 7 };

/**
 * Asocia cada instancia del cuadro con una instancia de la puntuación del torneo:
 * primero por nombre ("Cuartos de final" ↔ cuartos), y si no, por orden (campeón = 1.ª, finalista = 2.ª...).
 */
export function mapStagesToTournament(keys: StageKey[], stages: StageConfig[]): Map<StageKey, StageConfig | null> {
  const result = new Map<StageKey, StageConfig | null>();
  const used = new Set<number>();
  for (const k of keys) {
    const byName = stages.find((s) => !used.has(s.id) && STAGE_PATTERNS[k].test(normalizeName(s.label)) && !(k === "finalista" && /semi/.test(normalizeName(s.label))));
    if (byName) { result.set(k, byName); used.add(byName.id); }
  }
  for (const k of keys) {
    if (result.has(k)) continue;
    const byRank = stages.find((s) => !used.has(s.id) && s.rank === STAGE_RANK[k]);
    result.set(k, byRank ?? null);
    if (byRank) used.add(byRank.id);
  }
  return result;
}

// ─────────────── Cuadro manual y completado de rondas ───────────────

/** Cuadro vacío para cargar a mano (2, 4, 8, 16 o 32 parejas). */
export function emptyDraft(teams: 2 | 4 | 8 | 16 | 32): BracketDraft {
  const roundsCount = Math.log2(teams);
  const rounds: DraftRound[] = Array.from({ length: roundsCount }, (_, i) => {
    const key = ROUND_FROM_END[roundsCount - 1 - i]!;
    return { key, label: ROUND_LABEL[key]! };
  });
  const matches: DraftMatch[] = [];
  for (let r = 0; r < roundsCount; r++) {
    const n = teams / 2 ** (r + 1);
    for (let i = 0; i < n; i++) {
      matches.push({
        id: `m${r}-${i}`, round: r, winnerOverride: null,
        sides: [0, 1].map(() => ({ text: "", score: null, marked: null, conf: null })) as [DraftSide, DraftSide],
      });
    }
  }
  return { rounds, matches };
}

/**
 * Completa los lugares vacíos de cada ronda con el ganador del partido correspondiente de la
 * ronda anterior (partidos ordenados de arriba hacia abajo: el 1.º y el 2.º alimentan al 1.º de
 * la ronda siguiente, etc.). Sólo usa ganadores determinados: no inventa nada.
 */
export function fillNextRounds(draft: BracketDraft): BracketDraft {
  const next: BracketDraft = JSON.parse(JSON.stringify(draft));
  for (let r = 0; r < next.rounds.length - 1; r++) {
    const current = next.matches.filter((m) => m.round === r);
    const following = next.matches.filter((m) => m.round === r + 1);
    if (following.length * 2 !== current.length) continue; // estructura no estándar: no se completa
    const result = interpret(next);
    current.forEach((m, i) => {
      const im = result.matches.find((x) => x.id === m.id);
      if (!im || im.winner === null) return;
      const slot = following[Math.floor(i / 2)]!.sides[i % 2]!;
      if (!slot.text.trim()) {
        slot.text = m.sides[im.winner].text;
        slot.conf = null;
      }
    });
  }
  return next;
}

/** Agrega una ronda final vacía (cuando la imagen no la incluía). */
export function addFinalRound(draft: BracketDraft): BracketDraft {
  const round = draft.rounds.length;
  return {
    rounds: [...draft.rounds, { key: "finalista", label: "Final" }],
    matches: [...draft.matches, {
      id: `final-${round}`, round, winnerOverride: null,
      sides: [0, 1].map(() => ({ text: "", score: null, marked: null, conf: null })) as [DraftSide, DraftSide],
    }],
  };
}
