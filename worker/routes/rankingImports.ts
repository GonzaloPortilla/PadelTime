import { Hono } from "hono";
import { rankingImportSchema, revertImportSchema } from "@shared/schemas";
import { APP_TIMEZONE, type Gender, type SeasonStatus } from "@shared/constants";
import { normalizeName } from "@shared/names";
import { normalizeText, todayIn } from "@shared/text";
import type {
  RankingImportIssue, RankingImportPreview, RankingImportRecord, RankingImportRowDetail, RankingImportSummaryItem,
} from "@shared/types";
import type { AppEnv } from "../types";
import { conflict, notFound } from "../lib/errors";
import { IMPORT_MAX_BODY_BYTES, parseBody, parseId } from "../lib/validate";
import { auditStmt } from "../lib/audit";
import type { z } from "zod";

type ImportInput = z.output<typeof rankingImportSchema>;

/** Motivo con el que figura cada saldo en el libro de movimientos. */
export const INITIAL_BALANCE_REASON = "Saldo inicial importado";

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Huella del contenido: no depende del formato ni del orden del archivo, así una misma planilla
 * exportada como CSV y como Excel se reconoce como la misma importación.
 */
export async function contentHash(input: ImportInput): Promise<string> {
  const names = new Map(input.newPlayers.map((p) => [p.key, normalizeName(`${p.firstName} ${p.lastName}`)]));
  const lines = input.rows
    .map((r) => `${r.playerId !== null ? `p${r.playerId}` : `n${names.get(r.newKey!) ?? r.newKey}`}|${r.seasonId}|${r.categoryId}|${r.divisionId ?? 0}|${r.points}`)
    .sort();
  return sha256Hex(lines.join("\n"));
}

const rankingKey = (r: { seasonId: number; categoryId: number; divisionId: number | null }) => `${r.seasonId}:${r.categoryId}:${r.divisionId ?? 0}`;

interface Ctx {
  preview: RankingImportPreview;
  input: ImportInput;
}

/** Valida todo lo que se va a importar contra la base. Lo usan la vista previa y la confirmación. */
async function analyze(db: D1Database, input: ImportInput): Promise<Ctx> {
  const issues: RankingImportIssue[] = [];
  const error = (message: string, rowNumbers?: number[]) => issues.push({ level: "error", message, ...(rowNumbers?.length ? { rowNumbers: rowNumbers.slice(0, 50) } : {}) });
  const warning = (message: string, rowNumbers?: number[]) => issues.push({ level: "warning", message, ...(rowNumbers?.length ? { rowNumbers: rowNumbers.slice(0, 50) } : {}) });

  const playerIds = [...new Set(input.rows.map((r) => r.playerId).filter((v): v is number => v !== null))];
  const hash = await contentHash(input);

  const [seasonsRes, categoriesRes, divisionsRes, playersRes, balancesRes, dupFileRes, existingRes, homonymRes] = await db.batch([
    db.prepare("SELECT id, name, status FROM seasons"),
    db.prepare("SELECT id, name, gender, active FROM categories"),
    db.prepare("SELECT id, name, category_id FROM divisions"),
    db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.gender, p.main_category_id, p.active, c.name AS category_name
         FROM players p JOIN categories c ON c.id = p.main_category_id
        WHERE p.id IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(playerIds)),
    db.prepare(
      `SELECT b.player_id, b.season_id, b.category_id, b.division_key, b.points, ri.id AS import_id, ri.file_name
         FROM initial_balances b JOIN ranking_imports ri ON ri.id = b.import_id
        WHERE b.active = 1 AND b.player_id IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(playerIds)),
    db.prepare("SELECT id, file_name, created_at, file_hash = ? AS same_file FROM ranking_imports WHERE status = 'vigente' AND (file_hash = ? OR content_hash = ?)")
      .bind(input.fileHash, input.fileHash, hash),
    db.prepare(
      `SELECT m.season_id, m.category_id, m.division_id, SUM(m.points) AS points FROM point_movements m
        WHERE m.season_id IN (SELECT value FROM json_each(?)) GROUP BY m.season_id, m.category_id, m.division_id`,
    ).bind(JSON.stringify([...new Set(input.rows.map((r) => r.seasonId))])),
    db.prepare(
      `SELECT p.id, p.search_text, p.code FROM players p
        WHERE EXISTS (SELECT 1 FROM json_each(?) j WHERE p.search_text = j.value OR p.search_text LIKE j.value || ' %')`,
    ).bind(JSON.stringify(input.newPlayers.map((p) => normalizeText(`${p.firstName} ${p.lastName}`)))),
  ]);

  const seasons = new Map((seasonsRes!.results as { id: number; name: string; status: SeasonStatus }[]).map((s) => [s.id, s]));
  const categories = new Map((categoriesRes!.results as { id: number; name: string; gender: Gender; active: number }[]).map((c) => [c.id, c]));
  const divisions = new Map((divisionsRes!.results as { id: number; name: string; category_id: number }[]).map((d) => [d.id, d]));
  const players = new Map(
    (playersRes!.results as { id: number; first_name: string; last_name: string; gender: Gender; main_category_id: number; active: number; category_name: string }[]).map((p) => [p.id, p]),
  );
  const newPlayers = new Map(input.newPlayers.map((p) => [p.key, p]));

  // ── Archivo o contenido ya importado ──
  for (const d of dupFileRes!.results as { id: number; file_name: string; created_at: string; same_file: number }[]) {
    error(
      d.same_file
        ? `Este archivo ya fue importado (importación #${d.id}, “${d.file_name}”). Para volver a importarlo, revertí primero esa importación.`
        : `Este contenido ya fue importado en la importación #${d.id} (“${d.file_name}”), aunque el archivo sea otro.`,
    );
  }

  // ── Referencias: temporadas, categorías, divisiones, jugadores ──
  const badRefs: number[] = [];
  const genderMismatch: number[] = [];
  const missingPlayers: number[] = [];
  const missingNew: number[] = [];
  const inactive = new Map<number, number[]>();
  const otherCategory = new Map<number, number[]>();
  const closedSeasons = new Set<string>();
  for (const r of input.rows) {
    const season = seasons.get(r.seasonId);
    const cat = categories.get(r.categoryId);
    const div = r.divisionId !== null ? divisions.get(r.divisionId) : null;
    if (!season || !cat || (r.divisionId !== null && (!div || div.category_id !== r.categoryId))) { badRefs.push(r.rowNumber); continue; }
    if (season.status === "cerrada") closedSeasons.add(season.name);
    if (r.playerId !== null) {
      const p = players.get(r.playerId);
      if (!p) { missingPlayers.push(r.rowNumber); continue; }
      if (p.gender !== cat.gender) genderMismatch.push(r.rowNumber);
      if (p.active !== 1) inactive.set(p.id, [...(inactive.get(p.id) ?? []), r.rowNumber]);
      if (p.main_category_id !== r.categoryId) otherCategory.set(p.id, [...(otherCategory.get(p.id) ?? []), r.rowNumber]);
    } else {
      const np = newPlayers.get(r.newKey!);
      if (!np) { missingNew.push(r.rowNumber); continue; }
      if (np.gender !== cat.gender) genderMismatch.push(r.rowNumber);
    }
  }
  if (badRefs.length) error("Hay filas con temporada, categoría o división inexistente (o una división que no pertenece a la categoría).", badRefs);
  if (missingPlayers.length) error("Hay filas vinculadas a jugadores que ya no existen. Volvé a revisar los jugadores.", missingPlayers);
  if (missingNew.length) error("Hay filas vinculadas a un jugador nuevo que no está en la lista.", missingNew);
  if (genderMismatch.length) error("Hay jugadores de una rama distinta a la de la categoría del ranking.", genderMismatch);
  for (const [pid, rows] of inactive) {
    const p = players.get(pid)!;
    warning(`${p.first_name} ${p.last_name} está inactivo. Su saldo se importa igual.`, rows);
  }
  if (otherCategory.size) {
    const names = [...otherCategory.keys()].slice(0, 8).map((pid) => { const p = players.get(pid)!; return `${p.first_name} ${p.last_name} (${p.category_name})`; });
    warning(
      `${otherCategory.size} jugador${otherCategory.size === 1 ? "" : "es"} figura${otherCategory.size === 1 ? "" : "n"} en un ranking distinto de su categoría principal actual: ${names.join(", ")}${otherCategory.size > 8 ? "…" : ""}. El saldo se registra en el ranking del archivo; la categoría del jugador no cambia.`,
      [...otherCategory.values()].flat(),
    );
  }
  for (const name of closedSeasons) warning(`${name} está cerrada. El saldo se registra igual porque es la migración de su ranking histórico.`);

  // ── Jugadores nuevos ──
  const usedKeys = new Set(input.rows.map((r) => r.newKey).filter(Boolean));
  for (const np of input.newPlayers) {
    const cat = categories.get(np.mainCategoryId);
    if (!cat) error(`La categoría de ${np.firstName} ${np.lastName} no existe.`);
    else if (cat.gender !== np.gender) error(`La categoría de ${np.firstName} ${np.lastName} no corresponde a su rama.`);
    else if (cat.active !== 1) error(`La categoría de ${np.firstName} ${np.lastName} está inactiva.`);
    if (!usedKeys.has(np.key)) error(`${np.firstName} ${np.lastName} figura como jugador nuevo pero no tiene filas.`);
  }
  const homonyms = homonymRes!.results as { id: number; search_text: string; code: string }[];
  for (const np of input.newPlayers) {
    const st = normalizeText(`${np.firstName} ${np.lastName}`);
    const same = homonyms.filter((h) => h.search_text === st || h.search_text.startsWith(`${st} `));
    if (same.length) warning(`Ya existe un jugador llamado ${np.firstName} ${np.lastName} (${same.map((h) => h.code).join(", ")}). Se va a crear otro (homónimo). Si es la misma persona, vinculalo en lugar de crearlo.`);
  }

  // ── Duplicados dentro del archivo ──
  const seen = new Map<string, number[]>();
  for (const r of input.rows) {
    const k = `${r.playerId !== null ? `p${r.playerId}` : `n${r.newKey}`}@${rankingKey(r)}`;
    seen.set(k, [...(seen.get(k) ?? []), r.rowNumber]);
  }
  for (const [k, rows] of seen) {
    if (rows.length < 2) continue;
    const pid = k.startsWith("p") ? Number(k.slice(1, k.indexOf("@"))) : null;
    const np = pid === null ? newPlayers.get(k.slice(1, k.indexOf("@"))) : null;
    const name = pid !== null ? `${players.get(pid)?.first_name ?? ""} ${players.get(pid)?.last_name ?? ""}`.trim() : `${np?.firstName ?? ""} ${np?.lastName ?? ""}`.trim();
    error(`${name || "Un jugador"} aparece ${rows.length} veces en el mismo ranking (filas ${rows.join(", ")}). Dejá una sola fila o vinculá cada una al jugador correcto.`, rows);
  }

  // ── Saldos iniciales ya vigentes para el mismo jugador y ranking ──
  const balances = balancesRes!.results as { player_id: number; season_id: number; category_id: number; division_key: number; points: number; import_id: number; file_name: string }[];
  const balanceMap = new Map(balances.map((b) => [`${b.player_id}@${b.season_id}:${b.category_id}:${b.division_key}`, b]));
  const byImport = new Map<number, { file: string; rows: number[]; names: string[] }>();
  for (const r of input.rows) {
    if (r.playerId === null) continue;
    const b = balanceMap.get(`${r.playerId}@${rankingKey(r)}`);
    if (!b) continue;
    const entry = byImport.get(b.import_id) ?? { file: b.file_name, rows: [], names: [] };
    entry.rows.push(r.rowNumber);
    const p = players.get(r.playerId);
    if (p) entry.names.push(`${p.first_name} ${p.last_name}`);
    byImport.set(b.import_id, entry);
  }
  for (const [importId, e] of byImport) {
    error(
      `${e.rows.length} jugador${e.rows.length === 1 ? " ya tiene" : "es ya tienen"} saldo inicial en el mismo ranking por la importación #${importId} (“${e.file}”): ${e.names.slice(0, 6).join(", ")}${e.names.length > 6 ? "…" : ""}. No se puede acreditar dos veces: revertí esa importación o quitá esas filas.`,
      e.rows,
    );
  }

  // ── Resumen por ranking ──
  const existing = existingRes!.results as { season_id: number; category_id: number; division_id: number | null; points: number }[];
  const summary = new Map<string, RankingImportSummaryItem>();
  for (const r of input.rows) {
    const season = seasons.get(r.seasonId);
    const cat = categories.get(r.categoryId);
    if (!season || !cat) continue;
    const k = rankingKey(r);
    let item = summary.get(k);
    if (!item) {
      const existingPoints = existing
        .filter((e) => e.season_id === r.seasonId && e.category_id === r.categoryId && (r.divisionId === null || e.division_id === r.divisionId))
        .reduce((a, e) => a + e.points, 0);
      item = {
        seasonId: season.id, seasonName: season.name, categoryId: cat.id, categoryName: cat.name, gender: cat.gender,
        divisionId: r.divisionId, divisionName: r.divisionId !== null ? divisions.get(r.divisionId)?.name ?? null : null,
        players: 0, points: 0, existingPoints,
      };
      summary.set(k, item);
    }
    item.players += 1;
    item.points += r.points;
  }
  for (const s of summary.values()) {
    if (s.existingPoints !== 0) {
      warning(`El ranking ${s.categoryName}${s.divisionName ? ` ${s.divisionName}` : ""} (${s.seasonName}) ya tiene ${s.existingPoints} puntos cargados en el sistema. El saldo inicial se suma a ellos: verificá que el archivo no incluya torneos ya acreditados.`);
    }
  }

  const negative = input.rows.filter((r) => r.points < 0).map((r) => r.rowNumber);
  if (negative.length) warning(`Hay ${negative.length} fila${negative.length === 1 ? "" : "s"} con puntos negativos.`, negative);

  const distinctPlayers = new Set(input.rows.map((r) => (r.playerId !== null ? `p${r.playerId}` : `n${r.newKey}`)));
  const preview: RankingImportPreview = {
    ok: !issues.some((i) => i.level === "error"),
    issues,
    rankings: [...summary.values()].sort((a, b) => a.seasonName.localeCompare(b.seasonName) || a.gender.localeCompare(b.gender) || a.categoryName.localeCompare(b.categoryName, "es", { numeric: true })),
    rowCount: input.rows.length,
    playerCount: distinctPlayers.size,
    newPlayerCount: input.newPlayers.length,
    totalPoints: input.rows.reduce((a, r) => a + r.points, 0),
    contentHash: hash,
  };
  return { preview, input };
}

export const rankingImportRoutes = new Hono<AppEnv>();

/** Vista previa: valida sin escribir nada. */
rankingImportRoutes.post("/preview", async (c) => {
  const input = await parseBody(c, rankingImportSchema, IMPORT_MAX_BODY_BYTES);
  const { preview } = await analyze(c.env.DB, input);
  return c.json(preview);
});

/** Confirma la importación: todo en una sola transacción (batch). */
rankingImportRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const parsed = await parseBody(c, rankingImportSchema, IMPORT_MAX_BODY_BYTES);
  const { preview, input } = await analyze(db, parsed);
  if (!preview.ok) {
    const first = preview.issues.find((i) => i.level === "error")!;
    throw conflict(first.message);
  }
  const userId = c.get("user").id;
  const token = crypto.randomUUID();
  const ref = `rimp:${token}:`;
  const today = todayIn(APP_TIMEZONE);
  const activeSeason = await db.prepare("SELECT id FROM seasons WHERE status = 'activa'").first<{ id: number }>();
  const importIdSql = "(SELECT id FROM ranking_imports WHERE token = ?)";
  const newPlayersJson = JSON.stringify(
    input.newPlayers.map((p) => ({ ...p, ref: ref + p.key, searchText: normalizeText(`${p.firstName} ${p.lastName}`) })),
  );
  const rowsJson = JSON.stringify(input.rows.map((r) => ({ ...r, ref: r.newKey !== null ? ref + r.newKey : null })));
  const warnings = preview.issues.filter((i) => i.level === "warning").map((i) => i.message).concat(input.warnings).slice(0, 300);

  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO ranking_imports (token, file_name, file_hash, content_hash, sheet_names, row_count, player_count, total_points,
                                    created_players, skipped_rows, rankings, mapping, warnings, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      token, input.fileName, input.fileHash, preview.contentHash, input.sheetNames.join(", ") || null, preview.rowCount, preview.playerCount,
      preview.totalPoints, input.newPlayers.length, input.skippedRows, JSON.stringify(preview.rankings), JSON.stringify(input.mapping),
      JSON.stringify(warnings), input.notes, userId,
    ),
  ];
  if (input.newPlayers.length) {
    stmts.push(
      db.prepare(
        `INSERT INTO players (first_name, last_name, gender, main_category_id, search_text, import_ref, created_by)
         SELECT json_extract(value, '$.firstName'), json_extract(value, '$.lastName'), json_extract(value, '$.gender'),
                json_extract(value, '$.mainCategoryId'), json_extract(value, '$.searchText'), json_extract(value, '$.ref'), ?
           FROM json_each(?)`,
      ).bind(userId, newPlayersJson),
      db.prepare(
        `INSERT INTO player_category_changes (player_id, from_category_id, to_category_id, season_id, change_type, reason, effective_date, created_by)
         SELECT id, NULL, main_category_id, ?, 'alta', 'Alta por importación de ranking', ?, ? FROM players WHERE import_ref IN (SELECT json_extract(value, '$.ref') FROM json_each(?))`,
      ).bind(activeSeason?.id ?? null, today, userId, newPlayersJson),
    );
  }
  stmts.push(
    db.prepare(
      `INSERT INTO initial_balances (import_id, row_number, source_name, source_position, player_id, season_id, category_id, division_id, division_key, points)
       SELECT ${importIdSql}, json_extract(j.value, '$.rowNumber'), json_extract(j.value, '$.sourceName'), json_extract(j.value, '$.sourcePosition'),
              COALESCE(json_extract(j.value, '$.playerId'), (SELECT p.id FROM players p WHERE p.import_ref = json_extract(j.value, '$.ref'))),
              json_extract(j.value, '$.seasonId'), json_extract(j.value, '$.categoryId'), json_extract(j.value, '$.divisionId'),
              COALESCE(json_extract(j.value, '$.divisionId'), 0), json_extract(j.value, '$.points')
         FROM json_each(?) j`,
    ).bind(token, rowsJson),
    db.prepare(
      `INSERT INTO point_movements (season_id, player_id, category_id, division_id, kind, points, reason, balance_import_id, created_by)
       SELECT b.season_id, b.player_id, b.category_id, b.division_id, 'ajuste', b.points, ?, b.import_id, ?
         FROM initial_balances b WHERE b.import_id = ${importIdSql} ORDER BY b.id`,
    ).bind(INITIAL_BALANCE_REASON, userId, token),
  );
  if (input.newPlayers.length) {
    stmts.push(db.prepare("UPDATE players SET import_ref = NULL WHERE import_ref IN (SELECT json_extract(value, '$.ref') FROM json_each(?))").bind(newPlayersJson));
  }
  stmts.push(
    db.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, summary) VALUES (?, 'importar', 'ranking', ${importIdSql}, ?)`,
    ).bind(
      userId, token,
      `Importó saldos iniciales de “${input.fileName}”: ${preview.rowCount} filas, ${preview.totalPoints} pts${input.newPlayers.length ? `, ${input.newPlayers.length} jugadores nuevos` : ""}`.slice(0, 300),
    ),
  );
  await db.batch(stmts);
  const created = await db.prepare("SELECT id FROM ranking_imports WHERE token = ?").bind(token).first<{ id: number }>();
  return c.json({ id: created!.id, preview }, 201);
});

interface ImportRow {
  id: number; file_name: string; sheet_names: string | null; status: "vigente" | "revertida"; row_count: number; player_count: number;
  total_points: number; created_players: number; skipped_rows: number; rankings: string; warnings: string; notes: string | null;
  created_at: string; created_by_name: string | null; reverted_at: string | null; reverted_by_name: string | null; revert_reason: string | null;
}

function parseJsonArray<T>(v: string): T[] {
  try {
    const x: unknown = JSON.parse(v);
    return Array.isArray(x) ? (x as T[]) : [];
  } catch {
    return [];
  }
}

const mapImport = (r: ImportRow): RankingImportRecord => ({
  id: r.id, fileName: r.file_name, sheetNames: r.sheet_names, status: r.status, rowCount: r.row_count, playerCount: r.player_count,
  totalPoints: r.total_points, createdPlayers: r.created_players, skippedRows: r.skipped_rows,
  rankings: parseJsonArray<RankingImportSummaryItem>(r.rankings), warnings: parseJsonArray<string>(r.warnings), notes: r.notes,
  createdAt: r.created_at, createdByName: r.created_by_name, revertedAt: r.reverted_at, revertedByName: r.reverted_by_name, revertReason: r.revert_reason,
});

const IMPORT_SELECT = `
  SELECT ri.id, ri.file_name, ri.sheet_names, ri.status, ri.row_count, ri.player_count, ri.total_points, ri.created_players, ri.skipped_rows,
         ri.rankings, ri.warnings, ri.notes, ri.created_at, u.display_name AS created_by_name, ri.reverted_at,
         ur.display_name AS reverted_by_name, ri.revert_reason
    FROM ranking_imports ri LEFT JOIN users u ON u.id = ri.created_by LEFT JOIN users ur ON ur.id = ri.reverted_by`;

rankingImportRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`${IMPORT_SELECT} ORDER BY ri.id DESC LIMIT 100`).all<ImportRow>();
  return c.json({ items: results.map(mapImport) });
});

rankingImportRoutes.get("/:id", async (c) => {
  const id = parseId(c.req.param("id"), "La importación");
  const db = c.env.DB;
  const [imp, rows] = await db.batch([
    db.prepare(`${IMPORT_SELECT} WHERE ri.id = ?`).bind(id),
    db.prepare(
      `SELECT b.row_number, b.source_name, b.source_position, b.player_id, p.code, p.first_name || ' ' || p.last_name AS player_name,
              s.name AS season_name, c.name AS category_name, d.name AS division_name, b.points, b.active
         FROM initial_balances b JOIN players p ON p.id = b.player_id JOIN seasons s ON s.id = b.season_id
         JOIN categories c ON c.id = b.category_id LEFT JOIN divisions d ON d.id = b.division_id
        WHERE b.import_id = ? ORDER BY b.row_number`,
    ).bind(id),
  ]);
  const row = imp!.results[0] as ImportRow | undefined;
  if (!row) throw notFound("La importación");
  const items: RankingImportRowDetail[] = (rows!.results as {
    row_number: number; source_name: string; source_position: string | null; player_id: number; code: string; player_name: string;
    season_name: string; category_name: string; division_name: string | null; points: number; active: number;
  }[]).map((r) => ({
    rowNumber: r.row_number, sourceName: r.source_name, sourcePosition: r.source_position, playerId: r.player_id, playerCode: r.code,
    playerName: r.player_name, seasonName: r.season_name, categoryName: r.category_name, divisionName: r.division_name, points: r.points, active: r.active === 1,
  }));
  return c.json({ item: mapImport(row), rows: items });
});

/** Revierte una importación completa con contraasientos. Los jugadores creados se conservan. */
rankingImportRoutes.post("/:id/revert", async (c) => {
  const id = parseId(c.req.param("id"), "La importación");
  const { reason } = await parseBody(c, revertImportSchema);
  const db = c.env.DB;
  const imp = await db.prepare("SELECT id, file_name, status FROM ranking_imports WHERE id = ?").bind(id)
    .first<{ id: number; file_name: string; status: string }>();
  if (!imp) throw notFound("La importación");
  if (imp.status !== "vigente") throw conflict("Esa importación ya fue revertida.");
  const userId = c.get("user").id;
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO point_movements (season_id, player_id, category_id, division_id, kind, points, reverses_movement_id, reason, balance_import_id, created_by)
       SELECT m.season_id, m.player_id, m.category_id, m.division_id, 'anulacion_ajuste', -m.points, m.id, ?, m.balance_import_id, ?
         FROM point_movements m
        WHERE m.balance_import_id = ? AND m.kind = 'ajuste'
          AND NOT EXISTS (SELECT 1 FROM point_movements r WHERE r.reverses_movement_id = m.id)`,
    ).bind(`Reversión de importación: ${reason}`.slice(0, 300), userId, id),
    db.prepare("UPDATE initial_balances SET active = 0 WHERE import_id = ?").bind(id),
    // La condición sobre status evita una doble reversión concurrente: si otra la revirtió antes, no cambia nada.
    db.prepare("UPDATE ranking_imports SET status = 'revertida', reverted_at = ?, reverted_by = ?, revert_reason = ? WHERE id = ? AND status = 'vigente'")
      .bind(now, userId, reason, id),
    auditStmt(db, userId, "revertir", "ranking", id, `Revirtió la importación #${id} (“${imp.file_name}”). Motivo: ${reason}`),
  ]);
  // meta.changes del INSERT incluye las filas que tocan los triggers: se informa la cantidad de saldos desactivados.
  return c.json({ ok: true, reversed: results[1]!.meta.changes });
});
