/**
 * Motor de fixtures de torneos largos (Fase 9). Funciones puras: no tocan la base ni la red,
 * así que el panel, la API y las pruebas usan exactamente la misma lógica.
 *
 * Alcance: fase de grupos (todos contra todos), tablas de posiciones con desempates configurables,
 * clasificación a Copa de Oro / Copa de Plata y cuadros de eliminación directa con BYE.
 * Los Satélites / Americanos NO usan este módulo.
 *
 * Reglas tomadas del reglamento publicado de Padel Time (página Reglamentos):
 *  - partidos a 3 sets con tie break en 6-6 (configurable);
 *  - grupos todos contra todos; los primeros a Copa de Oro y los restantes a Copa de Plata;
 *  - Master: cabezas de serie por ranking (suma de los dos integrantes) y cruces 1°A vs 4°B, 2°A vs 3°B…
 *    (es lo que produce el sembrado estándar con dos grupos).
 * Lo que el reglamento no define (orden de desempates, cómo cuenta un W.O.) es configurable por competencia.
 */
import { z } from "zod";

// ─────────────────────────── Constantes ───────────────────────────
export const FIXTURE_PHASES = ["grupos", "oro", "plata", "cuadro"] as const;
export type FixturePhase = (typeof FIXTURE_PHASES)[number];
export type BracketPhase = Exclude<FixturePhase, "grupos">;
export const PHASE_LABEL: Record<FixturePhase, string> = {
  grupos: "Fase de grupos",
  oro: "Copa de Oro",
  plata: "Copa de Plata",
  cuadro: "Cuadro principal",
};

export const MATCH_STATUSES = ["pendiente", "jugado", "retiro", "wo", "administrativo", "bye"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  pendiente: "Pendiente",
  jugado: "Jugado",
  retiro: "Retiro",
  wo: "W.O.",
  administrativo: "Resultado administrativo",
  bye: "Pase libre (BYE)",
};
/** Estados que el organizador puede cargar (el BYE lo asigna el sistema). */
export const RESULT_STATUSES = ["jugado", "retiro", "wo", "administrativo"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];
export const isDecided = (s: MatchStatus) => s !== "pendiente";

export const GROUP_TIEBREAKERS = ["ganados", "directo", "dif_sets", "dif_games", "sets_ganados", "games_ganados"] as const;
export type GroupTiebreaker = (typeof GROUP_TIEBREAKERS)[number];
export const GROUP_TIEBREAKER_LABEL: Record<GroupTiebreaker, string> = {
  ganados: "Partidos ganados",
  directo: "Resultado entre las parejas empatadas",
  dif_sets: "Diferencia de sets",
  dif_games: "Diferencia de games",
  sets_ganados: "Sets ganados",
  games_ganados: "Games ganados",
};

export const FIXTURE_FORMATS = ["grupos_copas", "eliminacion"] as const;
export type FixtureFormat = (typeof FIXTURE_FORMATS)[number];
export const FIXTURE_FORMAT_LABEL: Record<FixtureFormat, string> = {
  grupos_copas: "Fase de grupos y copas (Oro / Plata)",
  eliminacion: "Eliminación directa",
};

// ─────────────────────────── Configuración ───────────────────────────
const int = (min: number, max: number, msg: string) => z.coerce.number({ message: msg }).int(msg).min(min, msg).max(max, msg);

export const matchFormatSchema = z.object({
  setsToWin: int(1, 3, "Sets para ganar inválidos"),
  gamesPerSet: int(3, 9, "Games por set inválidos"),
  tiebreak: z.boolean(),
  finalSet: z.enum(["set", "super_tiebreak"]),
  superTiebreakPoints: int(7, 15, "Puntos del súper tie break inválidos"),
});
export type MatchFormat = z.output<typeof matchFormatSchema>;

export const fixtureConfigSchema = z
  .object({
    format: z.enum(FIXTURE_FORMATS),
    /** Cupo de parejas (null = sin límite). */
    maxTeams: z.union([int(2, 64, "Cupo inválido"), z.null()]),
    groupCount: int(1, 8, "Cantidad de grupos inválida"),
    /** Posiciones de cada grupo que pasan a Copa de Oro (los primeros N). */
    goldPerGroup: int(1, 16, "Clasificados a Oro inválidos"),
    /** Copa de Plata: con los restantes, con una cantidad fija por grupo, o sin Copa de Plata. */
    silver: z.enum(["resto", "cantidad", "ninguna"]),
    silverPerGroup: int(1, 16, "Clasificados a Plata inválidos"),
    match: matchFormatSchema,
    tiebreakers: z
      .array(z.enum(GROUP_TIEBREAKERS))
      .min(1, "Elegí al menos un criterio")
      .max(GROUP_TIEBREAKERS.length)
      .refine((l) => new Set(l).size === l.length, { message: "Hay criterios repetidos" }),
    /** Cómo cuenta un W.O. en sets y games: sólo el partido, o como victoria por el marcador mínimo (6-0 6-0). */
    walkover: z.enum(["sin_games", "como_resultado"]),
  })
  .strict();
export type FixtureConfig = z.output<typeof fixtureConfigSchema>;

export const DEFAULT_FIXTURE_CONFIG: FixtureConfig = {
  format: "grupos_copas",
  maxTeams: null,
  groupCount: 2,
  goldPerGroup: 2,
  silver: "resto",
  silverPerGroup: 2,
  // Reglamento: "3 sets con tie break en 6-6 y punto de oro".
  match: { setsToWin: 2, gamesPerSet: 6, tiebreak: true, finalSet: "set", superTiebreakPoints: 10 },
  // El reglamento publicado no fija el orden de desempate: es una propuesta editable.
  tiebreakers: ["ganados", "directo", "dif_sets", "dif_games"],
  walkover: "sin_games",
};

/** Completa una configuración guardada con los valores por defecto (compatibilidad hacia adelante). */
export function parseFixtureConfig(raw: unknown): FixtureConfig {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const merged = { ...DEFAULT_FIXTURE_CONFIG, ...obj, match: { ...DEFAULT_FIXTURE_CONFIG.match, ...((obj.match as object) ?? {}) } };
  const r = fixtureConfigSchema.safeParse(merged);
  return r.success ? r.data : DEFAULT_FIXTURE_CONFIG;
}

// ─────────────────────────── Tipos del motor ───────────────────────────
export type SetScore = [number, number];

export interface FxTeam { id: number; name: string; seed: number | null; withdrawn: boolean }
export interface FxGroup { id: number; name: string; teamIds: number[]; manualOrder: number[] | null }

/** Origen de un lugar en la primera ronda de un cuadro. */
export type SlotSource =
  | { kind: "grupo"; groupId: number; position: number }
  | { kind: "pareja"; teamId: number }
  | { kind: "bye" };

export interface FxMatch {
  id: number;
  phase: FixturePhase;
  groupId: number | null;
  round: number;
  slot: number;
  team1Id: number | null;
  team2Id: number | null;
  source1: SlotSource | null;
  source2: SlotSource | null;
  status: MatchStatus;
  winner: 1 | 2 | null;
  sets: SetScore[];
  date: string | null;
  time: string | null;
  court: string | null;
}

// ─────────────────────────── Marcadores ───────────────────────────
export type ScoreCheck = { ok: true; winner: 1 | 2 | null; sets: SetScore[] } | { ok: false; error: string };

const maxSets = (f: MatchFormat) => f.setsToWin * 2 - 1;

/** ¿Es válido un set terminado? Devuelve el ganador del set (1 o 2) o un error. */
function setWinner(f: MatchFormat, [a, b]: SetScore, isFinal: boolean): 1 | 2 | string {
  if (a === b) return "un set no puede terminar empatado";
  const w = Math.max(a, b);
  const l = Math.min(a, b);
  const side: 1 | 2 = a > b ? 1 : 2;
  if (isFinal && f.finalSet === "super_tiebreak") {
    const p = f.superTiebreakPoints;
    if (w < p) return `el súper tie break se gana con ${p} puntos`;
    if (w - l < 2) return "el súper tie break se gana por 2 puntos de diferencia";
    if (w > p && w - l !== 2) return "marcador de súper tie break imposible";
    return side;
  }
  const g = f.gamesPerSet;
  if (w === g && l <= g - 2) return side;
  if (f.tiebreak) {
    if (w === g + 1 && (l === g - 1 || l === g)) return side;
    return `un set termina ${g}-x con 2 de diferencia, ${g + 1}-${g - 1} o ${g + 1}-${g} (tie break)`;
  }
  if (w > g && w - l === 2) return side;
  return `un set termina ${g}-x con 2 games de diferencia`;
}

/**
 * Valida un resultado. Para "jugado" el ganador sale del marcador; para "retiro", "wo" y
 * "administrativo" lo indica el organizador (el marcador es parcial u opcional).
 */
export function checkScore(f: MatchFormat, status: MatchStatus, sets: SetScore[], winner: 1 | 2 | null): ScoreCheck {
  if (status === "pendiente") return { ok: true, winner: null, sets: [] };
  if (status === "bye") return { ok: false, error: "El pase libre lo asigna el sistema" };
  for (const s of sets) {
    if (s.length !== 2 || s.some((x) => !Number.isInteger(x) || x < 0 || x > 99)) return { ok: false, error: "Hay games inválidos" };
  }
  if (sets.length > maxSets(f)) return { ok: false, error: `Como máximo ${maxSets(f)} sets` };

  if (status === "wo") {
    if (sets.length) return { ok: false, error: "Un W.O. no lleva marcador" };
    if (!winner) return { ok: false, error: "Indicá qué pareja gana por W.O." };
    return { ok: true, winner, sets: [] };
  }

  if (status === "jugado") {
    if (!sets.length) return { ok: false, error: "Cargá el marcador" };
    const won = [0, 0];
    for (const [i, s] of sets.entries()) {
      if (won[0] === f.setsToWin || won[1] === f.setsToWin) return { ok: false, error: "Hay sets de más: el partido ya estaba definido" };
      const isFinal = i === maxSets(f) - 1;
      const r = setWinner(f, s, isFinal);
      if (typeof r === "string") return { ok: false, error: `Set ${i + 1}: ${r}` };
      won[r - 1]! += 1;
    }
    if (won[0] !== f.setsToWin && won[1] !== f.setsToWin) return { ok: false, error: `El partido no está terminado: se gana con ${f.setsToWin} set${f.setsToWin > 1 ? "s" : ""}` };
    const w: 1 | 2 = won[0] === f.setsToWin ? 1 : 2;
    if (winner && winner !== w) return { ok: false, error: "El ganador no coincide con el marcador" };
    return { ok: true, winner: w, sets };
  }

  // retiro / administrativo: marcador parcial opcional, ganador obligatorio.
  if (!winner) return { ok: false, error: status === "retiro" ? "Indicá qué pareja gana (la que no se retiró)" : "Indicá qué pareja gana" };
  const cap = Math.max(f.gamesPerSet + 1, f.finalSet === "super_tiebreak" ? 99 : 0);
  for (const [i, [a, b]] of sets.entries()) {
    if (a > cap || b > cap) return { ok: false, error: `Set ${i + 1}: games fuera de rango` };
  }
  return { ok: true, winner, sets };
}

/** Texto del marcador desde la pareja 1: "6-4 3-6 7-6". */
export function scoreText(m: Pick<FxMatch, "status" | "sets">): string {
  if (m.status === "wo") return "W.O.";
  if (m.status === "bye") return "BYE";
  const s = m.sets.map(([a, b]) => `${a}-${b}`).join(" ");
  if (m.status === "retiro") return `${s}${s ? " " : ""}(ret.)`;
  if (m.status === "administrativo") return s ? `${s} (adm.)` : "Adm.";
  return s;
}

// ─────────────────────────── Grupos y todos contra todos ───────────────────────────
/** Generador pseudoaleatorio con semilla (mulberry32): el sorteo es reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Orden para el armado de grupos: primero las cabezas de serie (1, 2, 3…), después el resto,
 * en orden de inscripción o sorteado (si se indica semilla). Las parejas retiradas no entran.
 */
export function drawOrder(teams: FxTeam[], drawSeed: number | null): FxTeam[] {
  const active = teams.filter((t) => !t.withdrawn);
  const seeded = active.filter((t) => t.seed !== null).sort((a, b) => a.seed! - b.seed! || a.id - b.id);
  const rest = active.filter((t) => t.seed === null);
  if (drawSeed !== null) {
    const rnd = seededRandom(drawSeed);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
  }
  return [...seeded, ...rest];
}

/**
 * Reparte en grupos "en serpentina": 1-2-3-4 / 8-7-6-5… Así cada cabeza de serie queda en un
 * grupo distinto y los tamaños difieren a lo sumo en uno.
 */
export function distributeGroups<T>(ordered: T[], groupCount: number): T[][] {
  const groups: T[][] = Array.from({ length: groupCount }, () => []);
  ordered.forEach((item, i) => {
    const round = Math.floor(i / groupCount);
    const pos = i % groupCount;
    groups[round % 2 === 0 ? pos : groupCount - 1 - pos]!.push(item);
  });
  return groups;
}

export const groupName = (i: number) => String.fromCharCode(65 + i); // A, B, C…

/**
 * Todos contra todos (método del círculo). Devuelve un partido por par de parejas, repartidos
 * en fechas (rondas) de modo que nadie juegue dos veces en la misma fecha. Con cantidad impar,
 * en cada fecha una pareja queda libre.
 */
export function roundRobin(teamIds: number[]): { round: number; slot: number; team1Id: number; team2Id: number }[] {
  const list: (number | null)[] = [...teamIds];
  if (list.length < 2) return [];
  if (list.length % 2) list.push(null);
  const n = list.length;
  const out: { round: number; slot: number; team1Id: number; team2Id: number }[] = [];
  for (let r = 0; r < n - 1; r++) {
    let slot = 0;
    for (let i = 0; i < n / 2; i++) {
      const a = list[i]!;
      const b = list[n - 1 - i]!;
      if (a !== null && b !== null) {
        // Se alterna quién figura primero para repartir el "local".
        const [t1, t2] = r % 2 === 0 || i > 0 ? [a, b] : [b, a];
        out.push({ round: r + 1, slot: slot++, team1Id: t1, team2Id: t2 });
      }
    }
    // Rotación: el primero queda fijo.
    list.splice(1, 0, list.pop()!);
  }
  return out;
}

// ─────────────────────────── Tablas de posiciones ───────────────────────────
export interface SideStats { played: number; won: number; lost: number; setsWon: number; setsLost: number; gamesWon: number; gamesLost: number }
const zero = (): SideStats => ({ played: 0, won: 0, lost: 0, setsWon: 0, setsLost: 0, gamesWon: 0, gamesLost: 0 });

/**
 * Lo que suma cada pareja en un partido decidido. Convenciones:
 *  - el súper tie break cuenta como un set ganado, sin sumar games;
 *  - W.O.: según la configuración, sólo el partido o el marcador mínimo (6-0 en los sets necesarios);
 *  - retiro y resultado administrativo: cuentan los games cargados.
 */
export function matchStats(cfg: FixtureConfig, m: FxMatch): [SideStats, SideStats] | null {
  if (!isDecided(m.status) || m.status === "bye" || !m.winner || m.team1Id === null || m.team2Id === null) return null;
  const s1 = zero();
  const s2 = zero();
  s1.played = s2.played = 1;
  if (m.winner === 1) { s1.won = 1; s2.lost = 1; } else { s2.won = 1; s1.lost = 1; }
  let sets = m.sets;
  if (m.status === "wo" && cfg.walkover === "como_resultado") {
    const g = cfg.match.gamesPerSet;
    sets = Array.from({ length: cfg.match.setsToWin }, () => (m.winner === 1 ? [g, 0] : [0, g]) as SetScore);
  }
  const superTb = cfg.match.finalSet === "super_tiebreak";
  sets.forEach(([a, b], i) => {
    const isSuper = superTb && i === maxSets(cfg.match) - 1;
    const complete = a !== b && (isSuper || Math.max(a, b) >= cfg.match.gamesPerSet);
    if (complete) {
      if (a > b) { s1.setsWon++; s2.setsLost++; } else { s2.setsWon++; s1.setsLost++; }
    }
    if (!isSuper) { s1.gamesWon += a; s1.gamesLost += b; s2.gamesWon += b; s2.gamesLost += a; }
  });
  return [s1, s2];
}

export interface StandingRow extends SideStats {
  teamId: number;
  position: number;
  /** Empate que ningún criterio resolvió (necesita definición manual). */
  tied: boolean;
  withdrawn: boolean;
}
export interface GroupStanding { groupId: number; rows: StandingRow[]; complete: boolean; played: number; total: number; unresolved: number[][] }

function addStats(a: SideStats, b: SideStats) {
  a.played += b.played; a.won += b.won; a.lost += b.lost;
  a.setsWon += b.setsWon; a.setsLost += b.setsLost; a.gamesWon += b.gamesWon; a.gamesLost += b.gamesLost;
}

export function groupStanding(cfg: FixtureConfig, group: FxGroup, matches: FxMatch[], teams: FxTeam[]): GroupStanding {
  const gm = matches.filter((m) => m.phase === "grupos" && m.groupId === group.id);
  const stats = new Map(group.teamIds.map((id) => [id, zero()]));
  const decided = gm.map((m) => ({ m, s: matchStats(cfg, m) })).filter((x) => x.s);
  for (const { m, s } of decided) {
    if (stats.has(m.team1Id!)) addStats(stats.get(m.team1Id!)!, s![0]);
    if (stats.has(m.team2Id!)) addStats(stats.get(m.team2Id!)!, s![1]);
  }

  const value = (crit: GroupTiebreaker, id: number, subset: number[]): number => {
    const s = stats.get(id)!;
    switch (crit) {
      case "ganados": return s.won;
      case "dif_sets": return s.setsWon - s.setsLost;
      case "dif_games": return s.gamesWon - s.gamesLost;
      case "sets_ganados": return s.setsWon;
      case "games_ganados": return s.gamesWon;
      case "directo": {
        // Partidos ganados sólo entre las parejas empatadas (con dos, es el enfrentamiento directo).
        const set = new Set(subset);
        return decided.filter(({ m }) => set.has(m.team1Id!) && set.has(m.team2Id!) && (m.winner === 1 ? m.team1Id : m.team2Id) === id).length;
      }
    }
  };

  // Ordena aplicando los criterios en orden; cada criterio sólo desempata a los que siguen empatados.
  const rank = (ids: number[], k: number): number[][] => {
    if (ids.length <= 1 || k >= cfg.tiebreakers.length) return [ids];
    const crit = cfg.tiebreakers[k]!;
    const buckets = new Map<number, number[]>();
    for (const id of ids) {
      const v = value(crit, id, ids);
      buckets.set(v, [...(buckets.get(v) ?? []), id]);
    }
    return [...buckets.entries()].sort((a, b) => b[0] - a[0]).flatMap(([, b]) => rank(b, k + 1));
  };

  // Las parejas retiradas van al final, en el orden en que se inscribieron al grupo.
  const withdrawn = new Set(teams.filter((t) => t.withdrawn).map((t) => t.id));
  const activeIds = group.teamIds.filter((id) => !withdrawn.has(id));
  const tiers = [...rank(activeIds, 0), ...group.teamIds.filter((id) => withdrawn.has(id)).map((id) => [id])];
  const manual = group.manualOrder ?? [];
  const rows: StandingRow[] = [];
  const unresolved: number[][] = [];
  for (const tier of tiers) {
    let ordered = tier;
    let tied = false;
    if (tier.length > 1) {
      // Último recurso: el orden definido a mano por el organizador (sorteo u otra regla del reglamento).
      if (tier.every((id) => manual.includes(id))) ordered = [...tier].sort((a, b) => manual.indexOf(a) - manual.indexOf(b));
      else { tied = true; unresolved.push(tier); }
    }
    for (const id of ordered) rows.push({ teamId: id, position: rows.length + 1, tied, withdrawn: withdrawn.has(id), ...stats.get(id)! });
  }
  // Las posiciones empatadas comparten número para no sugerir un orden que no existe.
  for (const tier of unresolved) {
    const first = Math.min(...tier.map((id) => rows.find((r) => r.teamId === id)!.position));
    for (const r of rows) if (tier.includes(r.teamId)) r.position = first;
  }
  // Completo: están todos los cruces del todos contra todos y todos tienen resultado.
  const n = group.teamIds.length;
  const total = Math.max(gm.length, (n * (n - 1)) / 2);
  const complete = n > 1 && gm.length >= total && gm.every((m) => isDecided(m.status));
  return { groupId: group.id, rows, complete, played: decided.length, total, unresolved };
}

// ─────────────────────────── Clasificación y cuadros ───────────────────────────
/** Posiciones de un grupo que van a cada copa. */
export function cupPositions(cfg: FixtureConfig, groupSize: number): { oro: number[]; plata: number[] } {
  const gold = Array.from({ length: Math.min(cfg.goldPerGroup, groupSize) }, (_, i) => i + 1);
  let silver: number[] = [];
  if (cfg.silver === "resto") silver = Array.from({ length: Math.max(0, groupSize - gold.length) }, (_, i) => gold.length + i + 1);
  else if (cfg.silver === "cantidad") silver = Array.from({ length: Math.max(0, Math.min(cfg.silverPerGroup, groupSize - gold.length)) }, (_, i) => gold.length + i + 1);
  return { oro: gold, plata: silver };
}

export const bracketSize = (n: number) => (n <= 1 ? 2 : 2 ** Math.ceil(Math.log2(n)));

/** Orden estándar de cabezas de serie: para 8 lugares, 1-8, 4-5, 2-7, 3-6 (el 1 y el 2 sólo se cruzan en la final). */
export function seedPositions(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function roundLabel(size: number, round: number): string {
  const teams = size / 2 ** (round - 1);
  if (teams === 2) return "Final";
  if (teams === 4) return "Semifinales";
  if (teams === 8) return "Cuartos de final";
  if (teams === 16) return "Octavos de final";
  if (teams >= 32) return `${teams / 2}avos de final`;
  return `Ronda ${round}`;
}
export const bracketRounds = (size: number) => Math.log2(size);

type Entry = { source: SlotSource; group: number | null };

/** Arma los cruces de la primera ronda a partir de las entradas ordenadas por siembra (1 = mejor). Los lugares sobrantes son BYE. */
export function placeEntries(entries: SlotSource[]): [SlotSource, SlotSource][] {
  const size = bracketSize(entries.length);
  const pos = seedPositions(size);
  const at = (seed: number): SlotSource => entries[seed - 1] ?? { kind: "bye" };
  const pairs: [SlotSource, SlotSource][] = [];
  for (let i = 0; i < size; i += 2) pairs.push([at(pos[i]!), at(pos[i + 1]!)]);
  return pairs;
}

/**
 * Siembra de una copa desde los grupos: primero todos los 1°, después los 2°, etc. Dentro de cada
 * nivel se busca el orden que evita que dos parejas del mismo grupo se crucen en primera ronda
 * (y, si se puede, en segunda). Con dos grupos produce el cruce del reglamento: 1°A–último B, 2°A–3°B…
 * Es una propuesta: el organizador puede intercambiar lugares antes de confirmar.
 */
export function seedFromGroups(groupsInOrder: { groupId: number; positions: number[] }[]): SlotSource[] {
  const maxPos = Math.max(0, ...groupsInOrder.map((g) => g.positions.length));
  const tiers: Entry[][] = [];
  for (let level = 0; level < maxPos; level++) {
    const tier = groupsInOrder.filter((g) => g.positions[level] !== undefined)
      .map((g) => ({ source: { kind: "grupo", groupId: g.groupId, position: g.positions[level]! } as SlotSource, group: g.groupId }));
    if (tier.length) tiers.push(tier);
  }
  const total = tiers.reduce((n, t) => n + t.length, 0);
  if (total === 0) return [];
  const size = bracketSize(total);
  const pos = seedPositions(size);
  // Para cada número de siembra: con qué siembra juega en 1ª ronda y en qué cuarto del cuadro queda.
  const slotOf = new Map(pos.map((seed, i) => [seed, i]));
  const cost = (list: Entry[]): number => {
    let c = 0;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        if (list[a]!.group === null || list[a]!.group !== list[b]!.group) continue;
        const sa = slotOf.get(a + 1)!;
        const sb = slotOf.get(b + 1)!;
        if (Math.floor(sa / 2) === Math.floor(sb / 2)) c += 100; // primera ronda
        else if (Math.floor(sa / 4) === Math.floor(sb / 4)) c += 1; // segunda ronda
      }
    }
    return c;
  };
  let chosen: Entry[] = [];
  for (const tier of tiers) {
    let best = [...chosen, ...tier];
    let bestCost = cost(best);
    if (bestCost > 0) {
      for (const perm of permutations(tier, 5040)) {
        const cand = [...chosen, ...perm];
        const c = cost(cand);
        if (c < bestCost) { best = cand; bestCost = c; if (c === 0) break; }
      }
    }
    chosen = best;
  }
  return chosen.map((e) => e.source);
}

function* permutations<T>(items: T[], limit: number): Generator<T[]> {
  let count = 0;
  const a = [...items];
  const c = new Array(a.length).fill(0);
  yield [...a];
  let i = 0;
  while (i < a.length && ++count < limit) {
    if (c[i] < i) {
      const k = i % 2 ? c[i] : 0;
      [a[k], a[i]] = [a[i]!, a[k]!];
      yield [...a];
      c[i]++;
      i = 0;
    } else { c[i] = 0; i++; }
  }
}

/** Siembra para eliminación directa: cabezas de serie primero, el resto en orden de inscripción. */
export function seedFromTeams(teams: FxTeam[]): SlotSource[] {
  return drawOrder(teams, null).map((t) => ({ kind: "pareja", teamId: t.id }) as SlotSource);
}

/** Partidos (vacíos) de un cuadro: primera ronda con sus orígenes, el resto se completa con los ganadores. */
export function bracketSkeleton(phase: BracketPhase, pairs: [SlotSource, SlotSource][]): Omit<FxMatch, "id">[] {
  const size = pairs.length * 2;
  const out: Omit<FxMatch, "id">[] = [];
  for (let r = 1; r <= bracketRounds(size); r++) {
    const count = size / 2 ** r;
    for (let s = 0; s < count; s++) {
      const [s1, s2] = r === 1 ? pairs[s]! : [null, null];
      out.push({ phase, groupId: null, round: r, slot: s, team1Id: null, team2Id: null, source1: s1, source2: s2, status: "pendiente", winner: null, sets: [], date: null, time: null, court: null });
    }
  }
  return out;
}

// ─────────────────────────── Sincronización de cuadros y conflictos ───────────────────────────
export interface MatchUpdate { matchId: number; team1Id: number | null; team2Id: number | null; status: MatchStatus; winner: 1 | 2 | null }
export interface FixtureConflict { matchId: number; side: 1 | 2; current: number | null; expected: number | null; message: string }

/**
 * Qué pareja corresponde a un origen de grupo: sólo cuando el grupo terminó y esa posición no
 * está empatada. undefined = todavía no se sabe.
 */
export function resolveGroupSource(src: SlotSource, standings: Map<number, GroupStanding>): number | null | undefined {
  if (src.kind === "bye") return null;
  if (src.kind === "pareja") return src.teamId;
  const st = standings.get(src.groupId);
  if (!st || !st.complete) return undefined;
  const rows = st.rows.filter((r) => r.position === src.position);
  if (rows.length !== 1) return rows.length === 0 ? null : undefined;
  return rows[0]!.teamId;
}

const winnerOf = (m: { status: MatchStatus; winner: 1 | 2 | null; team1Id: number | null; team2Id: number | null }) =>
  isDecided(m.status) && m.winner ? (m.winner === 1 ? m.team1Id : m.team2Id) : undefined;

/**
 * Recorre los cuadros ronda por ronda y calcula qué pareja debería ocupar cada lugar:
 *  - si el partido no se jugó, se actualiza solo (avance de ronda, BYE, cambio de clasificados);
 *  - si el partido YA tiene resultado y la pareja esperada es otra, NO se toca: se informa el conflicto
 *    para que un administrador lo resuelva.
 */
export function syncBrackets(matches: FxMatch[], standings: Map<number, GroupStanding>, teamName: (id: number | null) => string = (id) => (id === null ? "—" : `#${id}`)): { updates: MatchUpdate[]; conflicts: FixtureConflict[] } {
  const updates: MatchUpdate[] = [];
  const conflicts: FixtureConflict[] = [];
  const state = new Map(matches.map((m) => [m.id, { ...m }]));
  for (const phase of ["cuadro", "oro", "plata"] as const) {
    const bm = matches.filter((m) => m.phase === phase).sort((a, b) => a.round - b.round || a.slot - b.slot);
    const at = (round: number, slot: number) => bm.find((m) => m.round === round && m.slot === slot);
    for (const orig of bm) {
      const m = state.get(orig.id)!;
      let exp1: number | null | undefined;
      let exp2: number | null | undefined;
      let bye1 = false;
      let bye2 = false;
      if (m.round === 1) {
        exp1 = m.source1 ? resolveGroupSource(m.source1, standings) : null;
        exp2 = m.source2 ? resolveGroupSource(m.source2, standings) : null;
        bye1 = m.source1?.kind === "bye";
        bye2 = m.source2?.kind === "bye";
      } else {
        const f1 = at(m.round - 1, m.slot * 2);
        const f2 = at(m.round - 1, m.slot * 2 + 1);
        exp1 = f1 ? winnerOf(state.get(f1.id)!) : null;
        exp2 = f2 ? winnerOf(state.get(f2.id)!) : null;
      }
      const e1 = exp1 ?? null;
      const e2 = exp2 ?? null;
      const played = m.status !== "pendiente" && m.status !== "bye";
      if (played) {
        if (e1 !== m.team1Id) conflicts.push({ matchId: m.id, side: 1, current: m.team1Id, expected: e1, message: conflictMessage(phase, m, teamName(m.team1Id), teamName(e1)) });
        if (e2 !== m.team2Id) conflicts.push({ matchId: m.id, side: 2, current: m.team2Id, expected: e2, message: conflictMessage(phase, m, teamName(m.team2Id), teamName(e2)) });
        continue;
      }
      // Pase libre: una pareja contra un lugar vacío por BYE.
      let status: MatchStatus = "pendiente";
      let winner: 1 | 2 | null = null;
      if (bye1 && e2 !== null) { status = "bye"; winner = 2; }
      else if (bye2 && e1 !== null) { status = "bye"; winner = 1; }
      if (e1 !== m.team1Id || e2 !== m.team2Id || status !== m.status || winner !== m.winner) {
        Object.assign(m, { team1Id: e1, team2Id: e2, status, winner, sets: status === "bye" ? [] : m.sets });
        updates.push({ matchId: m.id, team1Id: e1, team2Id: e2, status, winner });
      }
    }
  }
  return { updates, conflicts };
}

function conflictMessage(phase: FixturePhase, m: FxMatch, current: string, expected: string) {
  return `${PHASE_LABEL[phase]}, partido ${m.round}-${m.slot + 1}: se jugó con ${current}, pero según los resultados corresponde ${expected}.`;
}

// ─────────────────────────── Inconsistencias ───────────────────────────
export interface FixtureIssue { level: "error" | "aviso"; code: string; message: string; matchIds: number[] }

export function fixtureIssues(
  cfg: FixtureConfig, teams: FxTeam[], groups: FxGroup[], matches: FxMatch[], standings: Map<number, GroupStanding>, conflicts: FixtureConflict[],
): FixtureIssue[] {
  const name = (id: number | null) => teams.find((t) => t.id === id)?.name ?? "—";
  const issues: FixtureIssue[] = conflicts.map((c) => ({ level: "error", code: "conflicto", message: c.message, matchIds: [c.matchId] }));

  for (const g of groups) {
    const st = standings.get(g.id);
    if (st?.complete && st.unresolved.length) {
      issues.push({ level: "error", code: "empate", message: `Grupo ${g.name}: empate sin resolver entre ${st.unresolved.map((t) => t.map(name).join(", ")).join(" / ")}. Definí el orden a mano.`, matchIds: [] });
    }
    for (const m of matches.filter((x) => x.phase === "grupos" && x.groupId === g.id)) {
      if ((m.team1Id !== null && !g.teamIds.includes(m.team1Id)) || (m.team2Id !== null && !g.teamIds.includes(m.team2Id))) {
        issues.push({ level: "error", code: "fuera_de_grupo", message: `Grupo ${g.name}: un partido incluye una pareja que ya no está en el grupo. Regenerá los partidos del grupo.`, matchIds: [m.id] });
      }
    }
  }
  const withdrawn = new Set(teams.filter((t) => t.withdrawn).map((t) => t.id));
  if (cfg.format === "grupos_copas" && groups.length) {
    const inGroups = new Set(groups.flatMap((g) => g.teamIds));
    for (const t of teams) {
      if (!t.withdrawn && !inGroups.has(t.id)) issues.push({ level: "aviso", code: "sin_grupo", message: `${t.name} no está en ningún grupo. Rearmá los grupos para incluirla.`, matchIds: [] });
    }
  }
  for (const m of matches) {
    if (m.status === "pendiente" && ((m.team1Id && withdrawn.has(m.team1Id)) || (m.team2Id && withdrawn.has(m.team2Id)))) {
      issues.push({ level: "aviso", code: "retirada", message: `${name(m.team1Id)} vs ${name(m.team2Id)}: una de las parejas se retiró. Cargá el W.O. o un resultado administrativo.`, matchIds: [m.id] });
    }
  }
  // Superposición de horarios: misma cancha o misma pareja en la misma fecha y hora.
  const timed = matches.filter((m) => m.date && m.time && !isDecided(m.status));
  const seen = new Map<string, FxMatch>();
  for (const m of timed) {
    if (m.court) {
      const k = `c|${m.date}|${m.time}|${m.court.toLowerCase()}`;
      const other = seen.get(k);
      if (other) issues.push({ level: "aviso", code: "cancha", message: `${m.court}, ${m.date} ${m.time}: dos partidos en la misma cancha y horario.`, matchIds: [other.id, m.id] });
      else seen.set(k, m);
    }
    for (const t of [m.team1Id, m.team2Id]) {
      if (t === null) continue;
      const k = `t|${m.date}|${m.time}|${t}`;
      const other = seen.get(k);
      if (other) issues.push({ level: "aviso", code: "pareja", message: `${name(t)} tiene dos partidos el ${m.date} a las ${m.time}.`, matchIds: [other.id, m.id] });
      else seen.set(k, m);
    }
  }
  return issues;
}

// ─────────────────────────── Vista pública (lo que se publica) ───────────────────────────
export interface PublicFixtureMatch {
  id: number; phase: FixturePhase; group: string | null; round: number; roundLabel: string; slot: number;
  team1: string | null; team2: string | null; status: MatchStatus; winner: 1 | 2 | null; score: string; sets: SetScore[];
  date: string | null; time: string | null; court: string | null; bye1: boolean; bye2: boolean;
}
export interface PublicFixture {
  format: FixtureFormat;
  groups: { name: string; rows: (Omit<StandingRow, "teamId"> & { team: string })[]; complete: boolean }[];
  matches: PublicFixtureMatch[];
  brackets: { phase: BracketPhase; size: number; rounds: string[] }[];
  tiebreakers: string[];
}

export function buildPublicFixture(cfg: FixtureConfig, teams: FxTeam[], groups: FxGroup[], matches: FxMatch[]): PublicFixture {
  const name = (id: number | null) => (id === null ? null : teams.find((t) => t.id === id)?.name ?? null);
  const groupNameOf = new Map(groups.map((g) => [g.id, g.name]));
  const sizes = new Map<BracketPhase, number>();
  for (const p of ["cuadro", "oro", "plata"] as const) {
    const r1 = matches.filter((m) => m.phase === p && m.round === 1).length;
    if (r1) sizes.set(p, r1 * 2);
  }
  return {
    format: cfg.format,
    groups: groups.map((g) => {
      const st = groupStanding(cfg, g, matches, teams);
      return { name: g.name, complete: st.complete, rows: st.rows.map(({ teamId, ...r }) => ({ ...r, team: name(teamId) ?? "—" })) };
    }),
    matches: matches.map((m) => ({
      id: m.id, phase: m.phase, group: m.groupId ? groupNameOf.get(m.groupId) ?? null : null, round: m.round,
      roundLabel: m.phase === "grupos" ? `Fecha ${m.round}` : roundLabel(sizes.get(m.phase as BracketPhase) ?? 2, m.round),
      slot: m.slot, team1: name(m.team1Id), team2: name(m.team2Id), status: m.status, winner: m.winner,
      score: isDecided(m.status) ? scoreText(m) : "", sets: m.sets, date: m.date, time: m.time, court: m.court,
      bye1: m.round === 1 && m.source1?.kind === "bye", bye2: m.round === 1 && m.source2?.kind === "bye",
    })),
    brackets: [...sizes.entries()].map(([phase, size]) => ({ phase, size, rounds: Array.from({ length: bracketRounds(size) }, (_, i) => roundLabel(size, i + 1)) })),
    tiebreakers: cfg.tiebreakers.map((t) => GROUP_TIEBREAKER_LABEL[t]),
  };
}

// ─────────────────────────── Estado completo (API → panel) ───────────────────────────
export interface FixtureMatchRow extends FxMatch { version: number; notes: string | null; updatedAt: string; updatedByName: string | null }
export interface FixtureTeamRow extends FxTeam { players: string[]; withdrawnReason: string | null }
export interface FixtureState {
  tournament: { id: number; name: string; status: string; categoryName: string; seasonId: number; publicVisible: boolean; path: string };
  config: FixtureConfig;
  version: number;
  updatedAt: string;
  updatedByName: string | null;
  locked: string | null;
  teams: FixtureTeamRow[];
  groups: FxGroup[];
  matches: FixtureMatchRow[];
  standings: GroupStanding[];
  conflicts: FixtureConflict[];
  issues: FixtureIssue[];
  publication: { publishedAt: string; publishedByName: string | null; fixtureVersion: number } | null;
  /** Fase 10: posiciones finales → puntuación del torneo. */
  final: {
    complete: boolean;
    pending: number;
    placements: FinalPlacement[];
    stages: StageOption[];
    /** Equivalencia guardada (null = todavía no se aplicó). */
    stageMap: Record<string, number | null> | null;
    /** Claves cuya equivalencia el reglamento no define (Copa de Plata): para revisar. */
    review: string[];
    /** Las instancias de las parejas coinciden con las posiciones finales del fixture. */
    applied: boolean;
    creditedVersion: number | null;
  };
}

export interface FixtureHistoryItem {
  id: number; matchId: number; action: string; before: unknown; after: unknown; reason: string | null; createdAt: string; createdByName: string | null;
}

/** Entradas de cada copa según la clasificación de los grupos (en orden de siembra). */
export function cupEntries(cfg: FixtureConfig, groups: FxGroup[]): { oro: SlotSource[]; plata: SlotSource[] } {
  const ordered = [...groups];
  const per = ordered.map((g) => ({ g, pos: cupPositions(cfg, g.teamIds.length) }));
  return {
    oro: seedFromGroups(per.map(({ g, pos }) => ({ groupId: g.id, positions: pos.oro }))),
    plata: seedFromGroups(per.map(({ g, pos }) => ({ groupId: g.id, positions: pos.plata }))),
  };
}

export const sourceKey = (s: SlotSource) => (s.kind === "grupo" ? `g${s.groupId}:${s.position}` : s.kind === "pareja" ? `t${s.teamId}` : "bye");

// ─────────────────────────── Posiciones finales → motor de puntuación (Fase 10) ───────────────────────────
/**
 * Instancia alcanzada por una pareja en la competencia. La clave se usa para asignarle una instancia
 * de la puntuación del torneo (tournament_stages): "oro:1" campeón de Oro, "oro:2" finalista,
 * "oro:4" semifinal, "oro:8" cuartos…, "plata:…" ídem en Plata, "cuadro:…" en eliminación directa
 * y "grupos" para quien no pasó de la fase de grupos.
 */
export interface FinalPlacement {
  teamId: number;
  key: string;
  label: string;
  /** Orden para mostrar (menor = mejor). */
  order: number;
  matchesPlayed: number;
  matchesWon: number;
}

const PHASE_ORDER: Record<FixturePhase, number> = { cuadro: 0, oro: 0, plata: 1000, grupos: 5000 };

export function placementLabel(key: string): string {
  if (key === "grupos") return "Fase de grupos";
  const [phase, n] = key.split(":") as [BracketPhase, string];
  const teams = Number(n);
  const where = phase === "cuadro" ? "" : ` · ${PHASE_LABEL[phase]}`;
  if (teams === 1) return `Campeón${where}`;
  if (teams === 2) return `Finalista${where}`;
  return `${roundLabel(teams, 1).replace("Semifinales", "Semifinal")}${where}`;
}

/** ¿Terminó la competencia? (todos los partidos con resultado y cuadros armados). */
export function fixtureComplete(matches: FxMatch[]): { complete: boolean; pending: number } {
  const pending = matches.filter((m) => !isDecided(m.status)).length;
  const hasBracket = matches.some((m) => m.phase !== "grupos");
  return { complete: matches.length > 0 && pending === 0 && hasBracket, pending };
}

/**
 * Partidos que suman al motor de puntos: los jugados, con retiro o resultado administrativo.
 * Un W.O. o un BYE no son partidos disputados: no cuentan como jugados ni ganados.
 */
const counts = (m: FxMatch) => m.status === "jugado" || m.status === "retiro" || m.status === "administrativo";

export function finalPlacements(teams: FxTeam[], matches: FxMatch[]): FinalPlacement[] {
  const out = new Map<number, FinalPlacement>();
  const mp = new Map<number, number>();
  const mw = new Map<number, number>();
  for (const m of matches) {
    if (!counts(m) || m.team1Id === null || m.team2Id === null) continue;
    for (const [id, side] of [[m.team1Id, 1], [m.team2Id, 2]] as const) {
      mp.set(id, (mp.get(id) ?? 0) + 1);
      if (m.winner === side) mw.set(id, (mw.get(id) ?? 0) + 1);
    }
  }
  for (const phase of ["cuadro", "oro", "plata"] as const) {
    const bm = matches.filter((m) => m.phase === phase);
    if (!bm.length) continue;
    const size = bm.filter((m) => m.round === 1).length * 2;
    const rounds = bracketRounds(size);
    for (const m of bm) {
      const loser = isDecided(m.status) && m.winner ? (m.winner === 1 ? m.team2Id : m.team1Id) : null;
      const winner = isDecided(m.status) && m.winner ? (m.winner === 1 ? m.team1Id : m.team2Id) : null;
      const reached = size / 2 ** (m.round - 1); // equipos en esa ronda
      if (loser !== null && m.status !== "bye") set(loser, `${phase}:${reached}`);
      if (m.round === rounds && winner !== null) set(winner, `${phase}:1`);
    }
    function set(teamId: number, key: string) {
      const n = Number(key.split(":")[1]);
      const order = PHASE_ORDER[phase] + n;
      const cur = out.get(teamId);
      if (!cur || order < cur.order) out.set(teamId, { teamId, key, label: placementLabel(key), order, matchesPlayed: 0, matchesWon: 0 });
    }
  }
  for (const t of teams) {
    if (!out.has(t.id)) out.set(t.id, { teamId: t.id, key: "grupos", label: placementLabel("grupos"), order: PHASE_ORDER.grupos, matchesPlayed: 0, matchesWon: 0 });
  }
  return [...out.values()].map((p) => ({ ...p, matchesPlayed: mp.get(p.teamId) ?? 0, matchesWon: mw.get(p.teamId) ?? 0 }))
    .sort((a, b) => a.order - b.order || a.teamId - b.teamId);
}

/** Instancias de la puntuación del torneo, para proponer la equivalencia con las posiciones finales. */
export interface StageOption { id: number; label: string; rank: number; points: number; maxTeams: number | null }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Propuesta de equivalencia posición final → instancia de la puntuación, por nombre:
 * Campeón, Finalista, Semifinal, Cuartos, Octavos, 16avos, Fase de grupos.
 * Para la Copa de Plata el reglamento no define puntos: se propone "Fase de grupos" (lo que
 * efectivamente alcanzaron en la competencia principal) y se marca para revisar.
 */
export function defaultStageMap(keys: string[], stages: StageOption[]): { map: Record<string, number | null>; review: string[] } {
  const find = (re: RegExp) => stages.find((s) => re.test(norm(s.label)))?.id ?? null;
  const byTeams: Record<number, RegExp> = { 1: /campe/, 2: /finalista|subcampe/, 4: /semi/, 8: /cuarto/, 16: /octavo/, 32: /16 ?avo|dieciseisavo/, 64: /32 ?avo/ };
  const groups = find(/grupo|zona|participa/);
  const map: Record<string, number | null> = {};
  const review: string[] = [];
  for (const key of keys) {
    if (key === "grupos") { map[key] = groups; continue; }
    const [phase, n] = key.split(":") as [BracketPhase, string];
    if (phase === "plata") { map[key] = groups; review.push(key); continue; }
    const re = byTeams[Number(n)];
    map[key] = re ? find(re) : null;
  }
  return { map, review };
}
