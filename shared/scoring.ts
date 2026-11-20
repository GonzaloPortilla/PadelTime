/**
 * Motor de puntuación de Padel Time. Funciones PURAS: las usan la API (para acreditar)
 * y el frontend (para previsualizar mientras se cargan resultados), así ambos calculan igual.
 */
import { DEFAULT_TIEBREAKERS, TIEBREAKERS, type Gender, type Tiebreaker } from "./constants";

export interface StageConfig {
  id: number;
  label: string;
  /** 1 = campeón, 2 = finalista, 3 = semifinal... (menor = mejor). */
  rank: number;
  points: number;
  maxTeams: number | null;
}

export interface ScoringConfig {
  /** Reglamento especial: suma la instancia alcanzada y todas las anteriores. */
  cumulative: boolean;
  participationBonus: number;
  matchPlayedBonus: number;
  matchWonBonus: number;
  stages: StageConfig[];
}

export interface ScoringPlayer {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  mainCategoryId: number;
  mainCategoryName: string;
  active: boolean;
}

export interface ScoringTeam {
  id: number;
  seed: number | null;
  stageId: number | null;
  matchesPlayed: number;
  matchesWon: number;
  players: ScoringPlayer[];
}

export interface ScoringTournament {
  categoryId: number;
  divisionId: number | null;
  gender: Gender;
}

export interface PreviewRow {
  teamId: number;
  playerId: number;
  code: string;
  name: string;
  partnerName: string;
  /** Categoría principal del jugador: es donde se acreditan los puntos. */
  categoryId: number;
  categoryName: string;
  /** División del torneo, sólo si coincide con la categoría acreditada. */
  divisionId: number | null;
  stageId: number | null;
  stageLabel: string;
  stageRank: number | null;
  stagePoints: number;
  bonusPoints: number;
  points: number;
  matchesPlayed: number;
  matchesWon: number;
  /** El jugador juega en una categoría distinta de su principal. */
  otherCategory: boolean;
  inactive: boolean;
}

export interface Issue {
  level: "error" | "warning";
  code: string;
  message: string;
  teamId?: number;
}

export interface Preview {
  rows: PreviewRow[];
  issues: Issue[];
  totals: { teams: number; players: number; points: number };
  canConfirm: boolean;
}

export const playerName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;
export const teamName = (players: { firstName: string; lastName: string }[]) =>
  players.map((p) => p.lastName).join(" / ") || "Pareja incompleta";

/**
 * Puntos deportivos por la instancia alcanzada.
 * Regla general: el campeón recibe los puntos de campeón, NO la suma de las fases anteriores.
 * Sólo con `cumulative` (reglamento especial) se suman la instancia y todas las previas (rank mayor).
 */
export function stagePoints(config: Pick<ScoringConfig, "cumulative" | "stages">, stage: StageConfig): number {
  if (!config.cumulative) return stage.points;
  return config.stages.filter((s) => s.rank >= stage.rank).reduce((sum, s) => sum + s.points, 0);
}

export function bonusPoints(config: ScoringConfig, team: Pick<ScoringTeam, "matchesPlayed" | "matchesWon">): number {
  return config.participationBonus + team.matchesPlayed * config.matchPlayedBonus + team.matchesWon * config.matchWonBonus;
}

/** Puntos de una pareja (cada integrante recibe exactamente esto). */
export function teamPoints(config: ScoringConfig, team: Pick<ScoringTeam, "stageId" | "matchesPlayed" | "matchesWon">) {
  const stage = config.stages.find((s) => s.id === team.stageId) ?? null;
  const sp = stage ? stagePoints(config, stage) : 0;
  const bp = stage ? bonusPoints(config, team) : 0;
  return { stage, stagePoints: sp, bonusPoints: bp, points: sp + bp };
}

export function computePreview(config: ScoringConfig | null, teams: ScoringTeam[], tournament: ScoringTournament): Preview {
  const issues: Issue[] = [];
  const rows: PreviewRow[] = [];

  if (!config || config.stages.length === 0) {
    issues.push({ level: "error", code: "sin_puntuacion", message: "El torneo no tiene configurada la puntuación." });
  }
  if (teams.length === 0) {
    issues.push({ level: "error", code: "sin_parejas", message: "No hay parejas registradas." });
  }

  const stageCount = new Map<number, number>();
  const seenPlayers = new Set<number>();

  for (const team of teams) {
    const name = teamName(team.players);
    if (team.players.length !== 2) {
      issues.push({ level: "error", code: "pareja_incompleta", teamId: team.id, message: `La pareja ${name} no tiene dos integrantes.` });
    }
    if (team.matchesWon > team.matchesPlayed) {
      issues.push({ level: "error", code: "partidos_invalidos", teamId: team.id, message: `${name}: los partidos ganados superan a los jugados.` });
    }
    const stage = config?.stages.find((s) => s.id === team.stageId) ?? null;
    if (!stage) {
      issues.push({ level: "error", code: "sin_instancia", teamId: team.id, message: `Falta cargar la instancia alcanzada por ${name}.` });
    } else {
      stageCount.set(stage.id, (stageCount.get(stage.id) ?? 0) + 1);
    }
    const tp = config ? teamPoints(config, team) : { stagePoints: 0, bonusPoints: 0, points: 0 };

    for (const p of team.players) {
      if (seenPlayers.has(p.id)) {
        issues.push({ level: "error", code: "jugador_repetido", teamId: team.id, message: `${playerName(p)} figura en más de una pareja.` });
      }
      seenPlayers.add(p.id);
      if (p.gender !== tournament.gender) {
        issues.push({ level: "error", code: "rama_distinta", teamId: team.id, message: `${playerName(p)} no pertenece a la rama del torneo.` });
      }
      if (!p.active) {
        issues.push({ level: "warning", code: "jugador_inactivo", teamId: team.id, message: `${playerName(p)} está inactivo: igual recibirá sus puntos.` });
      }
      const partner = team.players.find((x) => x.id !== p.id);
      rows.push({
        teamId: team.id,
        playerId: p.id,
        code: p.code,
        name: playerName(p),
        partnerName: partner ? playerName(partner) : "",
        categoryId: p.mainCategoryId,
        categoryName: p.mainCategoryName,
        divisionId: p.mainCategoryId === tournament.categoryId ? tournament.divisionId : null,
        stageId: stage?.id ?? null,
        stageLabel: stage?.label ?? "Sin instancia",
        stageRank: stage?.rank ?? null,
        stagePoints: tp.stagePoints,
        bonusPoints: tp.bonusPoints,
        points: tp.points,
        matchesPlayed: team.matchesPlayed,
        matchesWon: team.matchesWon,
        otherCategory: p.mainCategoryId !== tournament.categoryId,
        inactive: !p.active,
      });
    }
  }

  if (config) {
    for (const s of config.stages) {
      const n = stageCount.get(s.id) ?? 0;
      if (s.maxTeams !== null && n > s.maxTeams) {
        issues.push({
          level: "error",
          code: "cupo_excedido",
          message: `"${s.label}" admite ${s.maxTeams} pareja${s.maxTeams === 1 ? "" : "s"} y hay ${n}. Corregí los resultados o el cupo en la configuración.`,
        });
      }
    }
    const best = [...config.stages].sort((a, b) => a.rank - b.rank)[0];
    if (best && teams.length > 0 && !stageCount.get(best.id)) {
      issues.push({ level: "warning", code: "sin_campeon", message: `Ninguna pareja tiene la instancia "${best.label}".` });
    }
  }

  // Orden: mejor instancia primero, luego apellido.
  rows.sort((a, b) => (a.stageRank ?? 999) - (b.stageRank ?? 999) || a.teamId - b.teamId || a.name.localeCompare(b.name, "es"));

  return {
    rows,
    issues,
    totals: { teams: teams.length, players: rows.length, points: rows.reduce((s, r) => s + r.points, 0) },
    canConfirm: !issues.some((i) => i.level === "error"),
  };
}

/** Representación canónica de lo que se acreditaría: si cambia algo, cambia la huella. */
export function previewFingerprint(rows: PreviewRow[]): string {
  const canonical = [...rows]
    .sort((a, b) => a.playerId - b.playerId)
    .map((r) => [r.playerId, r.teamId, r.categoryId, r.divisionId, r.stageId, r.stageLabel, r.stageRank, r.stagePoints, r.bonusPoints, r.points, r.matchesPlayed, r.matchesWon, r.partnerName]);
  return JSON.stringify(canonical);
}

// ─────────────────────────── Correcciones ───────────────────────────
export interface CreditedRow {
  playerId: number;
  name: string;
  code: string;
  categoryName: string;
  points: number;
  stageLabel: string | null;
}

export interface DiffRow {
  playerId: number;
  name: string;
  code: string;
  categoryName: string;
  before: number | null;
  after: number | null;
  delta: number;
  stageBefore: string | null;
  stageAfter: string | null;
  change: "nuevo" | "quitado" | "modificado" | "igual";
}

export function diffCredit(previous: CreditedRow[], next: PreviewRow[]): DiffRow[] {
  const map = new Map<number, DiffRow>();
  for (const p of previous) {
    map.set(p.playerId, {
      playerId: p.playerId, name: p.name, code: p.code, categoryName: p.categoryName,
      before: p.points, after: null, delta: -p.points, stageBefore: p.stageLabel, stageAfter: null, change: "quitado",
    });
  }
  for (const n of next) {
    const prev = map.get(n.playerId);
    if (prev) {
      prev.after = n.points;
      prev.delta = n.points - (prev.before ?? 0);
      prev.stageAfter = n.stageLabel;
      prev.categoryName = n.categoryName;
      prev.change = prev.delta === 0 && prev.stageBefore === n.stageLabel ? "igual" : "modificado";
    } else {
      map.set(n.playerId, {
        playerId: n.playerId, name: n.name, code: n.code, categoryName: n.categoryName,
        before: null, after: n.points, delta: n.points, stageBefore: null, stageAfter: n.stageLabel, change: "nuevo",
      });
    }
  }
  const order = { modificado: 0, nuevo: 1, quitado: 2, igual: 3 };
  return [...map.values()].sort((a, b) => order[a.change] - order[b.change] || a.name.localeCompare(b.name, "es"));
}

// ─────────────────────────── Rankings ───────────────────────────
export interface RankingStats {
  playerId: number;
  lastName: string;
  firstName: string;
  points: number;
  tournaments: number;
  titles: number;
  finals: number;
  semifinals: number;
  bestTournament: number;
  matchesWon: number;
}

export interface RankedEntry<T extends RankingStats> {
  position: number;
  tied: boolean;
  entry: T;
}

function criterionValue(e: RankingStats, c: Tiebreaker): number {
  switch (c) {
    case "titulos": return e.titles;
    case "finales": return e.finals;
    case "semifinales": return e.semifinals;
    case "mejor_torneo": return e.bestTournament;
    case "partidos_ganados": return e.matchesWon;
    case "mas_torneos": return e.tournaments;
    case "menos_torneos": return -e.tournaments;
  }
}

/** Compara dos jugadores: puntos y luego los criterios de desempate en orden. <0 si `a` va primero. */
export function compareRanking(a: RankingStats, b: RankingStats, tiebreakers: readonly Tiebreaker[]): number {
  if (a.points !== b.points) return b.points - a.points;
  for (const c of tiebreakers) {
    const diff = criterionValue(b, c) - criterionValue(a, c);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Ordena y asigna posiciones (formato "1, 2, 2, 4"): quienes siguen empatados
 * después de aplicar todos los criterios comparten posición.
 */
export function rankPlayers<T extends RankingStats>(entries: T[], tiebreakers: readonly Tiebreaker[]): RankedEntry<T>[] {
  const sorted = [...entries].sort(
    (a, b) => compareRanking(a, b, tiebreakers) || a.lastName.localeCompare(b.lastName, "es") || a.firstName.localeCompare(b.firstName, "es") || a.playerId - b.playerId,
  );
  const result: RankedEntry<T>[] = [];
  sorted.forEach((entry, i) => {
    const prev = result[i - 1];
    const tiedWithPrev = prev !== undefined && compareRanking(prev.entry, entry, tiebreakers) === 0;
    result.push({ position: tiedWithPrev ? prev.position : i + 1, tied: false, entry });
    if (tiedWithPrev) {
      prev.tied = true;
      result[i]!.tied = true;
    }
  });
  return result;
}

export function parseTiebreakers(raw: string | null | undefined): Tiebreaker[] {
  if (!raw) return [...DEFAULT_TIEBREAKERS];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [...DEFAULT_TIEBREAKERS];
    return value.filter((v): v is Tiebreaker => (TIEBREAKERS as readonly string[]).includes(v as string));
  } catch {
    return [...DEFAULT_TIEBREAKERS];
  }
}
