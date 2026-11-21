import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  FIXTURE_PHASES, RESULT_STATUSES, buildPublicFixture, bracketSize, bracketSkeleton, checkScore, cupEntries, fixtureConfigSchema,
  fixtureIssues, groupName, groupStanding, isDecided, parseFixtureConfig, placeEntries, roundRobin, seedFromTeams, sourceKey, syncBrackets,
  type BracketPhase, type FixtureConfig, type FixtureHistoryItem, type FixtureMatchRow, type FixtureState, type FixtureTeamRow,
  type FxGroup, type GroupStanding, type SlotSource,
} from "@shared/fixture";
import { tournamentPath } from "@shared/site";
import type { SeasonStatus, TournamentStatus, TournamentType } from "@shared/constants";
import type { AppEnv } from "../types";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors";
import { parseBody, parseId } from "../lib/validate";

/**
 * Fixtures de torneos largos (Fase 9): grupos, partidos, resultados, tablas, Copa de Oro / Plata y publicación.
 * Los Satélites / Americanos no tienen fixture: para ellos siguen los cuadros finales y la acreditación existentes.
 *
 * Edición simultánea: cada operación lee el estado, valida y escribe en UN lote cuyo primer paso incrementa la
 * versión del fixture sólo si nadie la cambió desde la lectura (op_token). Si otro organizador escribió en el
 * medio, el lote no aplica nada y se reintenta o se informa (409). Las operaciones estructurales (grupos,
 * cuadros, configuración, publicación) además exigen la versión que el organizador tenía en pantalla.
 *
 * Avances de ronda: si un partido todavía no se jugó, se completa solo con el ganador correspondiente.
 * Si ya tiene resultado y la pareja que correspondería es otra, NO se sobrescribe: queda como conflicto
 * hasta que un administrador lo resuelva (anulando el resultado posterior o corrigiendo el anterior).
 */
export const fixtureRoutes = new Hono<AppEnv>();

const MAX_BODY = 128 * 1024;
type C = Context<AppEnv>;

// ─────────────────────────── Lectura del estado ───────────────────────────
interface TRow { id: number; name: string; type: TournamentType; status: TournamentStatus; season_id: number; season_status: SeasonStatus; category_name: string; public_visible: number }
interface MRow {
  id: number; phase: FixtureMatchRow["phase"]; group_id: number | null; round: number; slot: number; team1_id: number | null; team2_id: number | null;
  source1: string | null; source2: string | null; scheduled_date: string | null; scheduled_time: string | null; court: string | null;
  status: FixtureMatchRow["status"]; winner: 1 | 2 | null; sets: string; notes: string | null; version: number; updated_at: string; updated_by_name: string | null;
}

interface Loaded extends FixtureState { raw: { standings: Map<number, GroupStanding> } }

const json = <T>(v: string | null, fallback: T): T => {
  if (!v) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};

async function loadState(db: D1Database, tid: number): Promise<Loaded> {
  // El fixture se crea vacío (configuración por defecto) la primera vez que se abre.
  const [tRes, , fxRes, teamRes, gRes, gtRes, mRes, pubRes] = await db.batch([
    db.prepare(
      `SELECT t.id, t.name, t.type, t.status, t.season_id, s.status AS season_status, c.name AS category_name, t.public_visible
         FROM tournaments t JOIN seasons s ON s.id = t.season_id JOIN categories c ON c.id = t.category_id WHERE t.id = ?`,
    ).bind(tid),
    db.prepare("INSERT OR IGNORE INTO tournament_fixtures (tournament_id) SELECT id FROM tournaments WHERE id = ? AND type = 'largo'").bind(tid),
    db.prepare("SELECT f.config, f.version, f.updated_at, u.display_name AS updated_by_name FROM tournament_fixtures f LEFT JOIN users u ON u.id = f.updated_by WHERE f.tournament_id = ?").bind(tid),
    db.prepare(
      `SELECT tt.id, tt.seed, tt.withdrawn_at, tt.withdrawn_reason, p.first_name, p.last_name
         FROM tournament_teams tt LEFT JOIN tournament_team_players ttp ON ttp.team_id = tt.id LEFT JOIN players p ON p.id = ttp.player_id
        WHERE tt.tournament_id = ? ORDER BY tt.id, ttp.rowid`,
    ).bind(tid),
    db.prepare("SELECT id, name, manual_order FROM fixture_groups WHERE tournament_id = ? ORDER BY sort_order, name").bind(tid),
    db.prepare("SELECT group_id, team_id FROM fixture_group_teams WHERE tournament_id = ? ORDER BY sort_order, team_id").bind(tid),
    db.prepare(
      `SELECT m.*, u.display_name AS updated_by_name FROM fixture_matches m LEFT JOIN users u ON u.id = m.updated_by
        WHERE m.tournament_id = ? ORDER BY CASE m.phase WHEN 'grupos' THEN 0 WHEN 'cuadro' THEN 1 WHEN 'oro' THEN 2 ELSE 3 END, m.group_id, m.round, m.slot`,
    ).bind(tid),
    db.prepare("SELECT p.published_at, p.fixture_version, u.display_name AS published_by_name FROM fixture_publications p LEFT JOIN users u ON u.id = p.published_by WHERE p.tournament_id = ?").bind(tid),
  ]);
  const t = tRes!.results[0] as TRow | undefined;
  if (!t) throw notFound("El torneo");
  if (t.type !== "largo") throw conflict("El fixture es sólo para torneos largos. Los Satélites / Americanos se cargan con su cuadro final.");
  const fx = fxRes!.results[0] as { config: string; version: number; updated_at: string; updated_by_name: string | null };
  const config = parseFixtureConfig(json(fx.config, {}));

  const teamMap = new Map<number, FixtureTeamRow>();
  for (const r of teamRes!.results as { id: number; seed: number | null; withdrawn_at: string | null; withdrawn_reason: string | null; first_name: string | null; last_name: string | null }[]) {
    let tm = teamMap.get(r.id);
    if (!tm) {
      tm = { id: r.id, name: "", seed: r.seed, withdrawn: r.withdrawn_at !== null, withdrawnReason: r.withdrawn_reason, players: [] };
      teamMap.set(r.id, tm);
    }
    if (r.first_name !== null) tm.players.push(`${r.first_name} ${r.last_name}`);
  }
  const teams = [...teamMap.values()].map((tm) => ({ ...tm, name: tm.players.join(" / ") || `Pareja ${tm.id}` }));

  const gt = gtRes!.results as { group_id: number; team_id: number }[];
  const groups: FxGroup[] = (gRes!.results as { id: number; name: string; manual_order: string | null }[]).map((g) => ({
    id: g.id, name: g.name, teamIds: gt.filter((x) => x.group_id === g.id).map((x) => x.team_id), manualOrder: json<number[] | null>(g.manual_order, null),
  }));
  const matches: FixtureMatchRow[] = (mRes!.results as MRow[]).map((m) => ({
    id: m.id, phase: m.phase, groupId: m.group_id, round: m.round, slot: m.slot, team1Id: m.team1_id, team2Id: m.team2_id,
    source1: json<SlotSource | null>(m.source1, null), source2: json<SlotSource | null>(m.source2, null),
    status: m.status, winner: m.winner, sets: json(m.sets, []), date: m.scheduled_date, time: m.scheduled_time, court: m.court,
    notes: m.notes, version: m.version, updatedAt: m.updated_at, updatedByName: m.updated_by_name,
  }));
  const standingsList = groups.map((g) => groupStanding(config, g, matches, teams));
  const standings = new Map(standingsList.map((s) => [s.groupId, s]));
  const name = (id: number | null) => (id === null ? "un lugar vacío" : teams.find((x) => x.id === id)?.name ?? `#${id}`);
  const { conflicts } = syncBrackets(matches, standings, name);
  const pub = pubRes!.results[0] as { published_at: string; fixture_version: number; published_by_name: string | null } | undefined;
  const locked = t.season_status === "cerrada" ? "La temporada está cerrada: el fixture es de sólo lectura."
    : t.status === "cancelado" ? "El torneo está cancelado. Reprogramalo para modificar el fixture." : null;
  return {
    tournament: { id: t.id, name: t.name, status: t.status, categoryName: t.category_name, seasonId: t.season_id, publicVisible: t.public_visible === 1, path: tournamentPath(t) },
    config, version: fx.version, updatedAt: fx.updated_at, updatedByName: fx.updated_by_name, locked,
    teams, groups, matches, standings: standingsList, conflicts, issues: fixtureIssues(config, teams, groups, matches, standings, conflicts),
    publication: pub ? { publishedAt: pub.published_at, publishedByName: pub.published_by_name, fixtureVersion: pub.fixture_version } : null,
    raw: { standings },
  };
}

const publicState = ({ raw: _raw, ...s }: Loaded): FixtureState => s;

// ─────────────────────────── Escritura protegida ───────────────────────────
interface Op {
  /** Sentencias a ejecutar si nadie cambió el fixture desde la lectura. `guard` va en el WHERE. */
  stmts: (guard: string) => D1PreparedStatement[];
  /** Estado en memoria después de la operación: se usa para completar avances de ronda y BYE. */
  next?: { matches: FixtureMatchRow[]; groups?: FxGroup[]; teams?: FixtureTeamRow[]; config?: FixtureConfig };
  audit: string;
}

function staleMessage(s: Loaded) {
  const when = new Date(s.updatedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `${s.updatedByName ?? "Otro organizador"} modificó el fixture el ${when}. Recargá para ver los cambios antes de seguir.`;
}

/**
 * Ejecuta una operación sobre el fixture. `build` recibe el estado recién leído (se reintenta una vez si
 * otro organizador escribió en el medio). `expectedVersion`: versión que el organizador tenía en pantalla
 * (obligatoria en operaciones estructurales).
 */
async function mutate(c: C, tid: number, expectedVersion: number | null, build: (s: Loaded) => Op | Promise<Op>): Promise<FixtureState> {
  const db = c.env.DB;
  const user = c.get("user");
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await loadState(db, tid);
    if (s.locked) throw conflict(s.locked);
    if (expectedVersion !== null && expectedVersion !== s.version) throw new HttpError(409, "conflicto", staleMessage(s));
    const op = await build(s);
    const token = crypto.randomUUID();
    const guard = `EXISTS (SELECT 1 FROM tournament_fixtures WHERE tournament_id = ${tid} AND op_token = '${token}')`;
    const now = new Date().toISOString();
    const stmts = [
      db.prepare("UPDATE tournament_fixtures SET version = version + 1, op_token = ?, updated_at = ?, updated_by = ? WHERE tournament_id = ? AND version = ?")
        .bind(token, now, user.id, tid, s.version),
      ...op.stmts(guard),
    ];
    // Avances de ronda y BYE que se desprenden del nuevo estado (sólo en partidos sin resultado).
    if (op.next) {
      const groups = op.next.groups ?? s.groups;
      const teams = op.next.teams ?? s.teams;
      const config = op.next.config ?? s.config;
      const standings = new Map(groups.map((g) => [g.id, groupStanding(config, g, op.next!.matches, teams)]));
      const { updates } = syncBrackets(op.next.matches, standings);
      for (const u of updates) {
        stmts.push(db.prepare(
          `UPDATE fixture_matches SET team1_id = ?, team2_id = ?, status = ?, winner = ?, sets = CASE WHEN ? = 'bye' THEN '[]' ELSE sets END, version = version + 1, updated_at = ?
            WHERE id = ? AND tournament_id = ? AND status IN ('pendiente', 'bye') AND ${guard}`,
        ).bind(u.team1Id, u.team2Id, u.status, u.winner, u.status, now, u.matchId, tid));
      }
    }
    stmts.push(db.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, summary) SELECT ?, 'fixture', 'torneo', ?, ? WHERE ${guard}`)
      .bind(user.id, tid, `${s.tournament.name} (${s.tournament.categoryName}): ${op.audit}`.slice(0, 300)));
    const res = await db.batch(stmts);
    if ((res[0]!.meta.changes ?? 0) > 0) return publicState(await loadState(db, tid));
    if (expectedVersion !== null) throw new HttpError(409, "conflicto", staleMessage(await loadState(db, tid)));
  }
  throw new HttpError(409, "conflicto", "Otro organizador está modificando el fixture en este momento. Probá de nuevo.");
}

const adminOnly = (c: C, what: string) => {
  if (c.get("user").role !== "admin") throw new HttpError(403, "sin_permiso", `Sólo un administrador puede ${what}.`);
};

const hasBrackets = (s: Loaded) => s.matches.some((m) => m.phase !== "grupos");
const anyGroupResult = (s: Loaded) => s.matches.some((m) => m.phase === "grupos" && isDecided(m.status));
const snapshot = (m: FixtureMatchRow) => ({ status: m.status, winner: m.winner, sets: m.sets, team1Id: m.team1Id, team2Id: m.team2Id });

// ─────────────────────────── Esquemas ───────────────────────────
const version = z.number().int().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const sourceSchema: z.ZodType<SlotSource> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("grupo"), groupId: z.number().int().positive(), position: z.number().int().min(1).max(64) }),
  z.object({ kind: z.literal("pareja"), teamId: z.number().int().positive() }),
  z.object({ kind: z.literal("bye") }),
]);
const setsSchema = z.array(z.tuple([z.number().int().min(0).max(99), z.number().int().min(0).max(99)])).max(5);
const reason = z.string().trim().max(300).nullish().transform((v) => (v ? v : null));

// ─────────────────────────── Rutas ───────────────────────────
fixtureRoutes.get("/:id/fixture", async (c) => c.json({ item: publicState(await loadState(c.env.DB, parseId(c.req.param("id"), "El torneo"))) }));

fixtureRoutes.get("/:id/fixture/history", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.match_id, h.action, h.before_json, h.after_json, h.reason, h.created_at, u.display_name AS created_by_name
       FROM fixture_match_history h LEFT JOIN users u ON u.id = h.created_by WHERE h.tournament_id = ? ORDER BY h.id DESC LIMIT 200`,
  ).bind(tid).all<{ id: number; match_id: number; action: string; before_json: string | null; after_json: string | null; reason: string | null; created_at: string; created_by_name: string | null }>();
  const items: FixtureHistoryItem[] = results.map((r) => ({
    id: r.id, matchId: r.match_id, action: r.action, before: json(r.before_json, null), after: json(r.after_json, null),
    reason: r.reason, createdAt: r.created_at, createdByName: r.created_by_name,
  }));
  return c.json({ items });
});

/** Configuración. El formato y las reglas de clasificación no cambian con los grupos o cuadros ya armados. */
fixtureRoutes.put("/:id/fixture/config", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const body = await parseBody(c, z.object({ version, config: fixtureConfigSchema }));
  const cfg = body.config;
  return c.json({ item: await mutate(c, tid, body.version, (s) => {
    if (cfg.maxTeams !== null && s.teams.length > cfg.maxTeams) throw badRequest(`Ya hay ${s.teams.length} parejas inscriptas: el cupo no puede ser menor`, { "config.maxTeams": "Menor que las inscriptas" });
    if (cfg.format !== s.config.format && s.matches.length) throw conflict("Para cambiar el formato primero borrá los grupos y cuadros.");
    if (s.groups.length && cfg.groupCount !== s.config.groupCount) throw conflict("Para cambiar la cantidad de grupos primero borrá los grupos armados.");
    if (hasBrackets(s) && (cfg.goldPerGroup !== s.config.goldPerGroup || cfg.silver !== s.config.silver || cfg.silverPerGroup !== s.config.silverPerGroup)) {
      throw conflict("Para cambiar la clasificación a Oro / Plata primero borrá los cuadros.");
    }
    const db = c.env.DB;
    return {
      stmts: (guard) => [db.prepare(`UPDATE tournament_fixtures SET config = ? WHERE tournament_id = ? AND ${guard}`).bind(JSON.stringify(cfg), tid)],
      // Cambiar desempates o el conteo del W.O. puede cambiar a los clasificados.
      next: { matches: s.matches, config: cfg },
      audit: "actualizó la configuración del fixture",
    };
  }) });
});

/** Cabezas de serie por ranking: suma de los puntos de la temporada de ambos integrantes (reglamento del Master). */
fixtureRoutes.post("/:id/fixture/seed-by-ranking", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const body = await parseBody(c, z.object({ version, count: z.number().int().min(0).max(64) }));
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, body.version, async (s) => {
    if (s.groups.length || s.matches.length) throw conflict("Las cabezas de serie se definen antes de armar los grupos o el cuadro.");
    const { results } = await db.prepare(
      `SELECT ttp.team_id, COALESCE(SUM(m.points), 0) AS points
         FROM tournament_team_players ttp
         JOIN tournaments t ON t.id = ttp.tournament_id
         LEFT JOIN point_movements m ON m.player_id = ttp.player_id AND m.season_id = t.season_id AND m.category_id = t.category_id
        WHERE ttp.tournament_id = ? GROUP BY ttp.team_id`,
    ).bind(tid).all<{ team_id: number; points: number }>();
    const pts = new Map(results.map((r) => [r.team_id, r.points]));
    const active = s.teams.filter((t) => !t.withdrawn).sort((a, b) => (pts.get(b.id) ?? 0) - (pts.get(a.id) ?? 0) || a.id - b.id);
    const seeded = active.slice(0, body.count).filter((t) => (pts.get(t.id) ?? 0) > 0);
    return {
      stmts: (guard) => [
        db.prepare(`UPDATE tournament_teams SET seed = NULL WHERE tournament_id = ? AND ${guard}`).bind(tid),
        ...seeded.map((t, i) => db.prepare(`UPDATE tournament_teams SET seed = ? WHERE id = ? AND ${guard}`).bind(i + 1, t.id)),
      ],
      audit: `definió ${seeded.length} cabeza(s) de serie por ranking`,
    };
  }) });
});

/** Arma (o rearma) los grupos y genera los partidos todos contra todos. Sólo sin resultados cargados. */
fixtureRoutes.put("/:id/fixture/groups", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const body = await parseBody(c, z.object({ version, groups: z.array(z.array(z.number().int().positive()).min(2, "Cada grupo necesita al menos 2 parejas").max(32)).min(1).max(8) }), MAX_BODY);
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, body.version, (s) => {
    if (s.config.format !== "grupos_copas") throw conflict("El formato elegido es de eliminación directa: no lleva grupos.");
    if (anyGroupResult(s)) throw conflict("Ya hay resultados de grupos cargados: los grupos no se pueden rearmar.");
    if (hasBrackets(s)) throw conflict("Ya hay cuadros armados: borralos antes de rearmar los grupos.");
    if (body.groups.length !== s.config.groupCount) throw badRequest(`La configuración indica ${s.config.groupCount} grupo(s)`);
    const active = new Set(s.teams.filter((t) => !t.withdrawn).map((t) => t.id));
    const all = body.groups.flat();
    if (new Set(all).size !== all.length) throw badRequest("Hay parejas repetidas en los grupos");
    if (all.some((id) => !active.has(id))) throw badRequest("Una de las parejas no pertenece al torneo o está retirada");
    if (all.length !== active.size) throw badRequest("Todas las parejas activas tienen que estar en un grupo");
    return {
      stmts: (guard) => [
        db.prepare(`DELETE FROM fixture_matches WHERE tournament_id = ? AND phase = 'grupos' AND ${guard}`).bind(tid),
        db.prepare(`DELETE FROM fixture_groups WHERE tournament_id = ? AND ${guard}`).bind(tid),
        ...body.groups.flatMap((ids, gi) => {
          const name = groupName(gi);
          const gid = `(SELECT id FROM fixture_groups WHERE tournament_id = ${tid} AND name = '${name}')`;
          return [
            db.prepare(`INSERT INTO fixture_groups (tournament_id, name, sort_order) SELECT ?, ?, ? WHERE ${guard}`).bind(tid, name, gi),
            ...ids.map((teamId, i) => db.prepare(`INSERT INTO fixture_group_teams (group_id, tournament_id, team_id, sort_order) SELECT ${gid}, ?, ?, ? WHERE ${guard}`).bind(tid, teamId, i)),
            ...roundRobin(ids).map((m) => db.prepare(
              `INSERT INTO fixture_matches (tournament_id, phase, group_id, round, slot, team1_id, team2_id, updated_by) SELECT ?, 'grupos', ${gid}, ?, ?, ?, ?, ? WHERE ${guard}`,
            ).bind(tid, m.round, m.slot, m.team1Id, m.team2Id, c.get("user").id)),
          ];
        }),
      ],
      audit: `armó ${body.groups.length} grupo(s) con ${all.length} parejas y generó los partidos`,
    };
  }) });
});

fixtureRoutes.delete("/:id/fixture/groups", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const body = await parseBody(c, z.object({ version }));
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, body.version, (s) => {
    if (anyGroupResult(s)) throw conflict("Ya hay resultados de grupos cargados: no se pueden borrar los grupos.");
    if (hasBrackets(s)) throw conflict("Primero borrá los cuadros.");
    return {
      stmts: (guard) => [
        db.prepare(`DELETE FROM fixture_matches WHERE tournament_id = ? AND phase = 'grupos' AND ${guard}`).bind(tid),
        db.prepare(`DELETE FROM fixture_groups WHERE tournament_id = ? AND ${guard}`).bind(tid),
      ],
      audit: "borró los grupos",
    };
  }) });
});

/** Orden manual para un empate que el reglamento no resuelve (sorteo u otra decisión de la organización). */
fixtureRoutes.put("/:id/fixture/groups/:gid/order", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const gid = parseId(c.req.param("gid"), "El grupo");
  const body = await parseBody(c, z.object({ version, teamIds: z.array(z.number().int().positive()).max(32).nullable() }));
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, body.version, (s) => {
    const g = s.groups.find((x) => x.id === gid);
    if (!g) throw notFound("El grupo");
    if (body.teamIds && (body.teamIds.length !== g.teamIds.length || body.teamIds.some((id) => !g.teamIds.includes(id)))) throw badRequest("El orden debe incluir a todas las parejas del grupo");
    const groups = s.groups.map((x) => (x.id === gid ? { ...x, manualOrder: body.teamIds } : x));
    return {
      stmts: (guard) => [db.prepare(`UPDATE fixture_groups SET manual_order = ? WHERE id = ? AND tournament_id = ? AND ${guard}`).bind(body.teamIds ? JSON.stringify(body.teamIds) : null, gid, tid)],
      next: { matches: s.matches, groups },
      audit: `definió a mano el orden del grupo ${g.name}`,
    };
  }) });
});

/** Propuesta de cuadros: desde los grupos (Oro / Plata) o, en eliminación directa, con las cabezas de serie. */
fixtureRoutes.get("/:id/fixture/brackets/proposal", async (c) => {
  const s = await loadState(c.env.DB, parseId(c.req.param("id"), "El torneo"));
  return c.json(bracketProposal(s));
});

function bracketProposal(s: Loaded): { ready: boolean; reason: string | null; brackets: { phase: BracketPhase; pairs: [SlotSource, SlotSource][] }[] } {
  if (s.config.format === "eliminacion") {
    const entries = seedFromTeams(s.teams);
    if (entries.length < 2) return { ready: false, reason: "Se necesitan al menos 2 parejas.", brackets: [] };
    return { ready: true, reason: null, brackets: [{ phase: "cuadro", pairs: placeEntries(entries) }] };
  }
  if (!s.groups.length) return { ready: false, reason: "Primero armá los grupos.", brackets: [] };
  const pending = s.standings.filter((st) => !st.complete);
  if (pending.length) return { ready: false, reason: `Faltan resultados en ${pending.length === 1 ? "un grupo" : `${pending.length} grupos`}.`, brackets: [] };
  if (s.standings.some((st) => st.unresolved.length)) return { ready: false, reason: "Hay empates sin resolver en las tablas: definí el orden a mano.", brackets: [] };
  const { oro, plata } = cupEntries(s.config, s.groups);
  const brackets: { phase: BracketPhase; pairs: [SlotSource, SlotSource][] }[] = [];
  if (oro.length >= 2) brackets.push({ phase: "oro", pairs: placeEntries(oro) });
  if (plata.length >= 2) brackets.push({ phase: "plata", pairs: placeEntries(plata) });
  if (!brackets.length) return { ready: false, reason: "La configuración no clasifica parejas suficientes.", brackets: [] };
  return { ready: true, reason: null, brackets };
}

/** Confirma los cuadros (la propuesta, con los cambios de lugar que haya hecho el organizador). */
fixtureRoutes.post("/:id/fixture/brackets", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const body = await parseBody(c, z.object({
    version,
    brackets: z.array(z.object({ phase: z.enum(["oro", "plata", "cuadro"]), pairs: z.array(z.tuple([sourceSchema, sourceSchema])).min(1).max(32) })).min(1).max(2),
  }), MAX_BODY);
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, body.version, (s) => {
    if (hasBrackets(s)) throw conflict("Los cuadros ya están armados.");
    const proposal = bracketProposal(s);
    if (!proposal.ready) throw conflict(proposal.reason ?? "Todavía no se pueden armar los cuadros.");
    for (const b of body.brackets) {
      const expected = proposal.brackets.find((p) => p.phase === b.phase);
      if (!expected) throw badRequest("Ese cuadro no corresponde a la configuración");
      // Se admiten cambios de lugar, pero con exactamente las mismas parejas / posiciones y BYE.
      const keys = (pairs: [SlotSource, SlotSource][]) => pairs.flat().map(sourceKey).sort().join(",");
      if (b.pairs.length !== expected.pairs.length || keys(b.pairs) !== keys(expected.pairs)) throw badRequest(`El cuadro de ${b.phase} no coincide con los clasificados`);
      if (b.pairs.some(([a, z2]) => a.kind === "bye" && z2.kind === "bye")) throw badRequest("Un cruce no puede tener dos BYE");
      if (bracketSize(b.pairs.length * 2) !== b.pairs.length * 2) throw badRequest("Tamaño de cuadro inválido");
    }
    if (new Set(body.brackets.map((b) => b.phase)).size !== body.brackets.length) throw badRequest("Hay cuadros repetidos");
    if (body.brackets.length !== proposal.brackets.length) throw badRequest("Faltan cuadros por confirmar");
    // Los partidos nuevos todavía no tienen id: se completan (BYE, clasificados) con un segundo paso.
    return {
      stmts: (guard) => body.brackets.flatMap((b) => bracketSkeleton(b.phase, b.pairs).map((m) => db.prepare(
        `INSERT INTO fixture_matches (tournament_id, phase, round, slot, source1, source2, updated_by) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
      ).bind(tid, m.phase, m.round, m.slot, m.source1 ? JSON.stringify(m.source1) : null, m.source2 ? JSON.stringify(m.source2) : null, c.get("user").id))),
      audit: `armó ${body.brackets.map((b) => b.phase === "oro" ? "Copa de Oro" : b.phase === "plata" ? "Copa de Plata" : "el cuadro").join(" y ")}`,
    };
  }).then(() => resync(c, tid)) });
});

/** Completa avances de ronda / BYE pendientes (se usa después de crear cuadros). */
async function resync(c: C, tid: number): Promise<FixtureState> {
  const s = await loadState(c.env.DB, tid);
  const { updates } = syncBrackets(s.matches, s.raw.standings);
  if (!updates.length) return publicState(s);
  return mutate(c, tid, null, (st) => ({ stmts: () => [], next: { matches: st.matches }, audit: "completó cruces del cuadro" }));
}

fixtureRoutes.delete("/:id/fixture/brackets", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const body = await parseBody(c, z.object({ version }));
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, body.version, (s) => {
    if (s.matches.some((m) => m.phase !== "grupos" && isDecided(m.status) && m.status !== "bye")) throw conflict("Hay resultados cargados en los cuadros: no se pueden borrar.");
    return {
      stmts: (guard) => [db.prepare(`DELETE FROM fixture_matches WHERE tournament_id = ? AND phase <> 'grupos' AND ${guard}`).bind(tid)],
      audit: "borró los cuadros",
    };
  }) });
});

/** Fecha, hora y cancha de un partido. */
fixtureRoutes.put("/:id/fixture/matches/:mid/schedule", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const mid = parseId(c.req.param("mid"), "El partido");
  const body = await parseBody(c, z.object({
    version,
    date: isoDate.nullable(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)").nullable(),
    court: z.string().trim().max(40).nullable().transform((v) => (v ? v : null)),
  }));
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, null, (s) => {
    const m = s.matches.find((x) => x.id === mid);
    if (!m) throw notFound("El partido");
    if (m.version !== body.version) throw new HttpError(409, "conflicto", `${m.updatedByName ?? "Otro organizador"} modificó este partido. Recargá.`);
    return {
      stmts: (guard) => [
        db.prepare(`UPDATE fixture_matches SET scheduled_date = ?, scheduled_time = ?, court = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND tournament_id = ? AND ${guard}`)
          .bind(body.date, body.time, body.court, new Date().toISOString(), c.get("user").id, mid, tid),
      ],
      audit: `programó un partido (${body.date ?? "sin fecha"} ${body.time ?? ""} ${body.court ?? ""})`.trim(),
    };
  }) });
});

/** Programación por fechas: la fecha N (o ronda N) se juega N-1 intervalos después del inicio. */
fixtureRoutes.post("/:id/fixture/schedule", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const body = await parseBody(c, z.object({
    version,
    phase: z.enum(FIXTURE_PHASES),
    groupId: z.number().int().positive().nullable().default(null),
    startDate: isoDate,
    intervalDays: z.number().int().min(0).max(60),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)").nullable(),
    court: z.string().trim().max(40).nullable().transform((v) => (v ? v : null)),
    overwrite: z.boolean().default(false),
  }));
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, body.version, (s) => {
    const targets = s.matches.filter((m) => m.phase === body.phase && (body.groupId === null || m.groupId === body.groupId) && !isDecided(m.status) && (body.overwrite || !m.date));
    const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    const now = new Date().toISOString();
    return {
      stmts: (guard) => targets.map((m) => db.prepare(
        `UPDATE fixture_matches SET scheduled_date = ?, scheduled_time = COALESCE(?, scheduled_time), court = COALESCE(?, court), version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND tournament_id = ? AND ${guard}`,
      ).bind(addDays(body.startDate, (m.round - 1) * body.intervalDays), body.time, body.court, now, c.get("user").id, m.id, tid)),
      audit: `programó ${targets.length} partido(s)`,
    };
  }) });
});

/** Carga o corrige un resultado. Una corrección exige motivo y queda en el historial. */
fixtureRoutes.put("/:id/fixture/matches/:mid/result", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const mid = parseId(c.req.param("mid"), "El partido");
  const body = await parseBody(c, z.object({ version, status: z.enum(RESULT_STATUSES), sets: setsSchema.default([]), winner: z.union([z.literal(1), z.literal(2)]).nullable().default(null), notes: reason, reason }));
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, null, (s) => {
    const m = s.matches.find((x) => x.id === mid);
    if (!m) throw notFound("El partido");
    if (m.version !== body.version) throw new HttpError(409, "conflicto", `${m.updatedByName ?? "Otro organizador"} modificó este partido. Recargá para ver el resultado actual.`);
    if (m.status === "bye") throw conflict("Es un pase libre (BYE): no lleva resultado.");
    if (m.team1Id === null || m.team2Id === null) throw conflict("Todavía no se conocen las dos parejas de este partido.");
    const check = checkScore(s.config.match, body.status, body.sets, body.winner);
    if (!check.ok) throw badRequest(check.error, { sets: check.error });
    const correction = isDecided(m.status);
    if (correction && (!body.reason || body.reason.length < 5)) throw badRequest("Para corregir un resultado indicá el motivo", { reason: "Motivo obligatorio" });
    const after = { ...m, status: body.status, winner: check.winner, sets: check.sets };
    const now = new Date().toISOString();
    const user = c.get("user").id;
    return {
      stmts: (guard) => [
        db.prepare(`UPDATE fixture_matches SET status = ?, winner = ?, sets = ?, notes = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND tournament_id = ? AND ${guard}`)
          .bind(body.status, check.winner, JSON.stringify(check.sets), body.notes, now, user, mid, tid),
        db.prepare(`INSERT INTO fixture_match_history (tournament_id, match_id, action, before_json, after_json, reason, created_by) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`)
          .bind(tid, mid, correction ? "correccion" : "resultado", JSON.stringify(snapshot(m)), JSON.stringify(snapshot(after)), body.reason, user),
      ],
      next: { matches: s.matches.map((x) => (x.id === mid ? after : x)) },
      audit: `${correction ? "corrigió" : "cargó"} el resultado ${s.teams.find((t) => t.id === m.team1Id)?.name ?? ""} vs ${s.teams.find((t) => t.id === m.team2Id)?.name ?? ""}${body.reason ? ` (${body.reason})` : ""}`,
    };
  }) });
});

/** Anula un resultado (resolución administrativa de conflictos). El partido vuelve a pendiente. */
fixtureRoutes.post("/:id/fixture/matches/:mid/annul", async (c) => {
  adminOnly(c, "anular resultados");
  const tid = parseId(c.req.param("id"), "El torneo");
  const mid = parseId(c.req.param("mid"), "El partido");
  const body = await parseBody(c, z.object({ version, reason: z.string().trim().min(5, "Indicá el motivo").max(300) }));
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, null, (s) => {
    const m = s.matches.find((x) => x.id === mid);
    if (!m) throw notFound("El partido");
    if (m.version !== body.version) throw new HttpError(409, "conflicto", "El partido cambió. Recargá.");
    if (!isDecided(m.status) || m.status === "bye") throw conflict("El partido no tiene resultado para anular.");
    const after = { ...m, status: "pendiente" as const, winner: null, sets: [] };
    const user = c.get("user").id;
    return {
      stmts: (guard) => [
        db.prepare(`UPDATE fixture_matches SET status = 'pendiente', winner = NULL, sets = '[]', version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND tournament_id = ? AND ${guard}`)
          .bind(new Date().toISOString(), user, mid, tid),
        db.prepare(`INSERT INTO fixture_match_history (tournament_id, match_id, action, before_json, after_json, reason, created_by) SELECT ?, ?, 'anulacion', ?, ?, ?, ? WHERE ${guard}`)
          .bind(tid, mid, JSON.stringify(snapshot(m)), JSON.stringify(snapshot(after)), body.reason, user),
      ],
      next: { matches: s.matches.map((x) => (x.id === mid ? after : x)) },
      audit: `anuló un resultado (${body.reason})`,
    };
  }) });
});

/** Retiro de una pareja ya empezada la competencia. Opcional: W.O. en sus partidos pendientes. */
fixtureRoutes.post("/:id/fixture/teams/:teamId/withdraw", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const teamId = parseId(c.req.param("teamId"), "La pareja");
  const body = await parseBody(c, z.object({ version, reason: z.string().trim().min(3, "Indicá el motivo").max(300), walkover: z.boolean().default(true) }));
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, body.version, (s) => {
    const team = s.teams.find((t) => t.id === teamId);
    if (!team) throw notFound("La pareja");
    if (team.withdrawn) throw conflict("La pareja ya figura como retirada.");
    const user = c.get("user").id;
    const now = new Date().toISOString();
    const affected = body.walkover ? s.matches.filter((m) => m.status === "pendiente" && m.team1Id !== null && m.team2Id !== null && (m.team1Id === teamId || m.team2Id === teamId)) : [];
    const matches = s.matches.map((m) => (affected.includes(m) ? { ...m, status: "wo" as const, winner: (m.team1Id === teamId ? 2 : 1) as 1 | 2, sets: [] } : m));
    const teams = s.teams.map((t) => (t.id === teamId ? { ...t, withdrawn: true } : t));
    return {
      stmts: (guard) => [
        db.prepare(`UPDATE tournament_teams SET withdrawn_at = ?, withdrawn_reason = ? WHERE id = ? AND tournament_id = ? AND ${guard}`).bind(now, body.reason, teamId, tid),
        ...affected.flatMap((m) => {
          const after = matches.find((x) => x.id === m.id)!;
          return [
            db.prepare(`UPDATE fixture_matches SET status = 'wo', winner = ?, sets = '[]', version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND status = 'pendiente' AND ${guard}`).bind(after.winner, now, user, m.id),
            db.prepare(`INSERT INTO fixture_match_history (tournament_id, match_id, action, before_json, after_json, reason, created_by) SELECT ?, ?, 'retiro', ?, ?, ?, ? WHERE ${guard}`)
              .bind(tid, m.id, JSON.stringify(snapshot(m)), JSON.stringify(snapshot(after)), body.reason, user),
          ];
        }),
      ],
      next: { matches, teams },
      audit: `registró el retiro de ${team.name}${affected.length ? ` (${affected.length} W.O.)` : ""}: ${body.reason}`,
    };
  }) });
});

fixtureRoutes.post("/:id/fixture/teams/:teamId/reinstate", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const teamId = parseId(c.req.param("teamId"), "La pareja");
  const body = await parseBody(c, z.object({ version }));
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, body.version, (s) => {
    const team = s.teams.find((t) => t.id === teamId);
    if (!team) throw notFound("La pareja");
    if (!team.withdrawn) throw conflict("La pareja no está retirada.");
    return {
      stmts: (guard) => [db.prepare(`UPDATE tournament_teams SET withdrawn_at = NULL, withdrawn_reason = NULL WHERE id = ? AND tournament_id = ? AND ${guard}`).bind(teamId, tid)],
      next: { matches: s.matches, teams: s.teams.map((t) => (t.id === teamId ? { ...t, withdrawn: false } : t)) },
      audit: `deshizo el retiro de ${team.name} (los W.O. ya cargados se mantienen)`,
    };
  }) });
});

/** Publica el fixture tal como está (la web muestra sólo lo publicado). */
fixtureRoutes.post("/:id/fixture/publish", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const body = await parseBody(c, z.object({ version }));
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, body.version, (s) => {
    if (!s.matches.length) throw conflict("Todavía no hay partidos para publicar.");
    const data = JSON.stringify(buildPublicFixture(s.config, s.teams, s.groups, s.matches));
    return {
      stmts: (guard) => [
        db.prepare(
          `INSERT INTO fixture_publications (tournament_id, data, fixture_version, published_at, published_by) SELECT ?, ?, ?, ?, ? WHERE ${guard}
           ON CONFLICT (tournament_id) DO UPDATE SET data = excluded.data, fixture_version = excluded.fixture_version, published_at = excluded.published_at, published_by = excluded.published_by`,
        ).bind(tid, data, s.version + 1, new Date().toISOString(), c.get("user").id),
      ],
      audit: "publicó el fixture en la web",
    };
  }) });
});

fixtureRoutes.delete("/:id/fixture/publish", async (c) => {
  const tid = parseId(c.req.param("id"), "El torneo");
  const body = await parseBody(c, z.object({ version }));
  const db = c.env.DB;
  return c.json({ item: await mutate(c, tid, body.version, (s) => {
    if (!s.publication) throw conflict("El fixture no está publicado.");
    return {
      stmts: (guard) => [db.prepare(`DELETE FROM fixture_publications WHERE tournament_id = ? AND ${guard}`).bind(tid)],
      audit: "quitó el fixture de la web",
    };
  }) });
});
