/**
 * Consultas de la web pública (Fase 7). Sólo devuelven datos publicables:
 *  - torneos marcados "Publicar en la web", de ramas activas y temporadas visibles;
 *  - nombres de jugadores (como ya muestran los rankings), nunca documento, teléfono, email ni notas;
 *  - contenidos publicados.
 */
import { eventStatus, type Gender, type TournamentStatus, type TournamentType } from "@shared/constants";
import { parseBlocks, type Block, type Series } from "@shared/site";
import type { PublicFixture } from "@shared/fixture";

export interface SitePage { slug: string; title: string; summary: string | null; blocks: Block[]; seoTitle: string | null; seoDescription: string | null; updatedAt: string }

/** Datos de un archivo de la biblioteca de medios, para dibujarlo. */
export interface MediaInfo { id: string; kind: "imagen" | "documento"; url: string; width: number | null; height: number | null; title: string; alt: string | null; bytes: number; filename: string }
export type MediaMap = Map<string, MediaInfo>;

export async function loadMedia(db: D1Database, ids: string[]): Promise<MediaMap> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { results } = await db
    .prepare("SELECT id, kind, width, height, title, alt, bytes, filename FROM media WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(unique))
    .all<{ id: string; kind: "imagen" | "documento"; width: number | null; height: number | null; title: string; alt: string | null; bytes: number; filename: string }>();
  return new Map(results.map((r) => [r.id, { ...r, url: `/media/${r.id}/${r.filename}` }]));
}

export interface PublicSponsor { name: string; url: string | null; mediaId: string }

export async function loadSponsors(db: D1Database): Promise<PublicSponsor[]> {
  const { results } = await db.prepare("SELECT name, url, media_id FROM site_sponsors WHERE active = 1 ORDER BY sort_order, id").all<{ name: string; url: string | null; media_id: string }>();
  return results.map((r) => ({ name: r.name, url: r.url, mediaId: r.media_id }));
}

export async function loadPage(db: D1Database, slug: string): Promise<SitePage | null> {
  const r = await db
    .prepare("SELECT slug, title, summary, blocks, seo_title, seo_description, updated_at FROM site_pages WHERE slug = ? AND status = 'publicada'")
    .bind(slug)
    .first<{ slug: string; title: string; summary: string | null; blocks: string; seo_title: string | null; seo_description: string | null; updated_at: string }>();
  return r ? { slug: r.slug, title: r.title, summary: r.summary, blocks: parseBlocks(r.blocks), seoTitle: r.seo_title, seoDescription: r.seo_description, updatedAt: r.updated_at } : null;
}

// ─────────────────────────── Torneos ───────────────────────────
export interface PublicTournament {
  id: number; name: string; type: TournamentType; series: Series | null; status: TournamentStatus;
  startDate: string; endDate: string; venue: string | null;
  seasonId: number; seasonName: string; seasonYear: number;
  categoryId: number; categoryName: string; gender: Gender; divisionId: number | null; divisionName: string | null;
  featured: boolean; description: string | null; prizeInfo: string | null; registrationOpen: boolean;
  teamCount: number; credited: boolean;
  eventId: number | null; eventName: string | null;
  categoryLevel: number;
  /** En un torneo con varias categorías: todas sus competencias publicadas (ver groupByEvent). */
  competitions?: PublicTournament[];
}

interface TRow {
  id: number; name: string; type: TournamentType; series: Series | null; status: TournamentStatus; start_date: string; end_date: string; venue: string | null;
  season_id: number; season_name: string; season_year: number; category_id: number; category_name: string; gender: Gender;
  division_id: number | null; division_name: string | null; featured: number; public_description: string | null; prize_info: string | null;
  registration_open: number; team_count: number; credited: number; event_id: number | null; event_name: string | null; category_level: number;
}

const T_SELECT = `
  SELECT t.id, t.name, t.type, t.series, t.status, t.start_date, t.end_date, t.venue,
         s.id AS season_id, s.name AS season_name, s.year AS season_year,
         c.id AS category_id, c.name AS category_name, c.gender, c.level AS category_level, d.id AS division_id, d.name AS division_name,
         t.featured, t.public_description, t.prize_info, t.registration_open,
         (SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id) AS team_count,
         EXISTS (SELECT 1 FROM tournament_credits cr WHERE cr.tournament_id = t.id AND cr.status = 'vigente') AS credited,
         t.event_id, (SELECT e.name FROM tournament_events e WHERE e.id = t.event_id) AS event_name
    FROM tournaments t
    JOIN seasons s ON s.id = t.season_id
    JOIN categories c ON c.id = t.category_id
    LEFT JOIN divisions d ON d.id = t.division_id
   WHERE t.public_visible = 1 AND s.public_visible = 1`;

const mapT = (r: TRow): PublicTournament => ({
  id: r.id, name: r.name, type: r.type, series: r.series, status: r.status, startDate: r.start_date, endDate: r.end_date, venue: r.venue,
  seasonId: r.season_id, seasonName: r.season_name, seasonYear: r.season_year,
  categoryId: r.category_id, categoryName: r.category_name, gender: r.gender, divisionId: r.division_id, divisionName: r.division_name,
  featured: r.featured === 1, description: r.public_description, prizeInfo: r.prize_info, registrationOpen: r.registration_open === 1,
  teamCount: r.team_count, credited: r.credited === 1, eventId: r.event_id, eventName: r.event_name, categoryLevel: r.category_level,
});

/**
 * Un torneo con varias categorías aparece UNA vez en los listados: se agrupan sus competencias y se usa
 * la de mayor nivel como enlace (dentro de la página se elige la categoría). Estado, fechas y destacados
 * se derivan de todas sus categorías.
 */
export function groupByEvent(list: PublicTournament[]): PublicTournament[] {
  const groups = new Map<string, PublicTournament[]>();
  for (const t of list) {
    const key = t.eventId ? `e${t.eventId}` : `t${t.id}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()].map((comps) => {
    const sorted = [...comps].sort((a, b) => a.categoryLevel - b.categoryLevel || a.categoryName.localeCompare(b.categoryName, "es") || a.id - b.id);
    const first = sorted[0]!;
    if (sorted.length === 1) return first;
    return {
      ...first,
      name: first.eventName ?? first.name,
      status: eventStatus(sorted.map((c) => c.status)),
      startDate: sorted.reduce((m, c) => (c.startDate < m ? c.startDate : m), first.startDate),
      endDate: sorted.reduce((m, c) => (c.endDate > m ? c.endDate : m), first.endDate),
      featured: sorted.some((c) => c.featured),
      registrationOpen: sorted.some((c) => c.registrationOpen),
      teamCount: sorted.reduce((n, c) => n + c.teamCount, 0),
      credited: sorted.every((c) => c.credited),
      competitions: sorted,
    };
  });
}

/** Todos los torneos públicos de las ramas activas (volúmenes chicos: se filtra en memoria). */
export async function publicTournaments(db: D1Database, genders: Gender[]): Promise<PublicTournament[]> {
  const { results } = await db.prepare(`${T_SELECT} ORDER BY t.start_date DESC, t.id DESC LIMIT 1000`).all<TRow>();
  return results.map(mapT).filter((t) => genders.includes(t.gender));
}

export async function publicTournament(db: D1Database, id: number, genders: Gender[]): Promise<PublicTournament | null> {
  const r = await db.prepare(`${T_SELECT} AND t.id = ?`).bind(id).first<TRow>();
  const t = r ? mapT(r) : null;
  return t && genders.includes(t.gender) ? t : null;
}

/** Categorías públicas de un mismo evento (Fase 9). */
export async function eventTournaments(db: D1Database, eventId: number, genders: Gender[]): Promise<PublicTournament[]> {
  const { results } = await db.prepare(`${T_SELECT} AND t.event_id = ? ORDER BY c.level, c.name, t.id`).bind(eventId).all<TRow>();
  return results.map(mapT).filter((t) => genders.includes(t.gender));
}

/** Próximos: programados que todavía no terminaron, del más cercano al más lejano. */
export const upcoming = (all: PublicTournament[], today: string) =>
  all.filter((t) => t.status === "programado" && t.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id);
export const inProgress = (all: PublicTournament[]) =>
  all.filter((t) => t.status === "en_curso").sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id);
export const finished = (all: PublicTournament[]) =>
  all.filter((t) => t.status === "finalizado").sort((a, b) => b.endDate.localeCompare(a.endDate) || b.id - a.id);

export interface PublicTeam { players: string[] }
export interface PublicResult { stageLabel: string; stageRank: number | null; points: number; players: string[] }

/** Parejas inscriptas (sólo nombres) y, si el torneo está acreditado, el resultado final vigente. */
export async function tournamentTeamsAndResults(db: D1Database, id: number): Promise<{ teams: PublicTeam[]; results: PublicResult[] }> {
  const [teamsRes, resultsRes] = await db.batch([
    db.prepare(
      `SELECT tt.id AS team_id, p.first_name || ' ' || p.last_name AS name
         FROM tournament_teams tt JOIN tournament_team_players ttp ON ttp.team_id = tt.id JOIN players p ON p.id = ttp.player_id
        WHERE tt.tournament_id = ? ORDER BY tt.seed IS NULL, tt.seed, tt.id, ttp.rowid`,
    ).bind(id),
    db.prepare(
      `SELECT m.team_id, m.stage_label, m.stage_rank, m.points, p.first_name || ' ' || p.last_name AS name
         FROM point_movements m
         JOIN tournament_credits cr ON cr.id = m.credit_id AND cr.status = 'vigente'
         JOIN players p ON p.id = m.player_id
        WHERE m.tournament_id = ? AND m.kind = 'acreditacion'
        ORDER BY m.stage_rank IS NULL, m.stage_rank, m.team_id, m.id`,
    ).bind(id),
  ]);
  const teams = new Map<number, string[]>();
  for (const r of teamsRes!.results as { team_id: number; name: string }[]) teams.set(r.team_id, [...(teams.get(r.team_id) ?? []), r.name]);
  const results = new Map<number, PublicResult>();
  for (const r of resultsRes!.results as { team_id: number; stage_label: string | null; stage_rank: number | null; points: number; name: string }[]) {
    const cur = results.get(r.team_id) ?? { stageLabel: r.stage_label ?? "—", stageRank: r.stage_rank, points: r.points, players: [] };
    cur.players.push(r.name);
    results.set(r.team_id, cur);
  }
  return { teams: [...teams.values()].map((players) => ({ players })), results: [...results.values()] };
}

// ─────────────────────────── Novedades y eventos ───────────────────────────
export interface PublicPost { slug: string; title: string; excerpt: string | null; blocks: Block[]; publishedAt: string; tournamentId: number | null; coverMediaId: string | null }

export async function latestPosts(db: D1Database, limit: number, nowIso: string): Promise<PublicPost[]> {
  const { results } = await db
    .prepare(
      `SELECT slug, title, excerpt, blocks, published_at, tournament_id, cover_media_id FROM site_posts
        WHERE status = 'publicada' AND published_at IS NOT NULL AND published_at <= ?
        ORDER BY pinned DESC, published_at DESC LIMIT ?`,
    )
    .bind(nowIso, limit)
    .all<{ slug: string; title: string; excerpt: string | null; blocks: string; published_at: string; tournament_id: number | null; cover_media_id: string | null }>();
  return results.map((r) => ({ slug: r.slug, title: r.title, excerpt: r.excerpt, blocks: parseBlocks(r.blocks), publishedAt: r.published_at, tournamentId: r.tournament_id, coverMediaId: r.cover_media_id }));
}

export async function loadPost(db: D1Database, slug: string, nowIso: string): Promise<PublicPost | null> {
  const r = await db
    .prepare("SELECT slug, title, excerpt, blocks, published_at, tournament_id, cover_media_id FROM site_posts WHERE slug = ? AND status = 'publicada' AND published_at <= ?")
    .bind(slug, nowIso)
    .first<{ slug: string; title: string; excerpt: string | null; blocks: string; published_at: string; tournament_id: number | null; cover_media_id: string | null }>();
  return r ? { slug: r.slug, title: r.title, excerpt: r.excerpt, blocks: parseBlocks(r.blocks), publishedAt: r.published_at, tournamentId: r.tournament_id, coverMediaId: r.cover_media_id } : null;
}

export type EventKind = "cancha_abierta" | "evento" | "inscripcion" | "otro";
export interface PublicEvent { id: number; title: string; kind: EventKind; startsOn: string; endsOn: string | null; startTime: string | null; location: string | null; description: string | null; tournamentId: number | null }

export async function eventsBetween(db: D1Database, from: string, to: string, kind?: EventKind): Promise<PublicEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT id, title, kind, starts_on, ends_on, start_time, location, description, tournament_id FROM site_events
        WHERE public = 1 AND starts_on <= ?2 AND COALESCE(ends_on, starts_on) >= ?1 ${kind ? "AND kind = ?3" : ""}
        ORDER BY starts_on, start_time, id LIMIT 300`,
    )
    .bind(...(kind ? [from, to, kind] : [from, to]))
    .all<{ id: number; title: string; kind: EventKind; starts_on: string; ends_on: string | null; start_time: string | null; location: string | null; description: string | null; tournament_id: number | null }>();
  return results.map((r) => ({ id: r.id, title: r.title, kind: r.kind, startsOn: r.starts_on, endsOn: r.ends_on, startTime: r.start_time, location: r.location, description: r.description, tournamentId: r.tournament_id }));
}

export async function postSlugs(db: D1Database, nowIso: string): Promise<{ slug: string; publishedAt: string }[]> {
  const { results } = await db
    .prepare("SELECT slug, published_at FROM site_posts WHERE status = 'publicada' AND published_at <= ? ORDER BY published_at DESC LIMIT 500")
    .bind(nowIso)
    .all<{ slug: string; published_at: string }>();
  return results.map((r) => ({ slug: r.slug, publishedAt: r.published_at }));
}

// ─────────────────────────── Fixtures (Fase 9) ───────────────────────────
/** Copia publicada del fixture de un torneo largo (null si no se publicó). */
export async function loadPublicFixture(db: D1Database, tournamentId: number): Promise<{ data: PublicFixture; publishedAt: string } | null> {
  const r = await db.prepare("SELECT data, published_at FROM fixture_publications WHERE tournament_id = ?").bind(tournamentId).first<{ data: string; published_at: string }>();
  if (!r) return null;
  try {
    return { data: JSON.parse(r.data) as PublicFixture, publishedAt: r.published_at };
  } catch {
    return null;
  }
}
