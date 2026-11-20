import { Hono } from "hono";
import { APP_TIMEZONE, type Gender } from "@shared/constants";
import { todayIn } from "@shared/text";
import type { ActivityItem, DashboardData, Season } from "@shared/types";
import type { AppEnv } from "../types";
import { mapSeason, SEASON_SELECT } from "./seasons";
import { mapTournament, TOURNAMENT_SELECT } from "./tournaments";

export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const today = todayIn(APP_TIMEZONE);
  const [players, categories, season, upcoming, inProgress, byCategory, activity, pending] = await db.batch([
    db.prepare("SELECT gender, active, COUNT(*) AS n FROM players GROUP BY gender, active"),
    db.prepare("SELECT gender, COUNT(*) AS n FROM categories WHERE active = 1 GROUP BY gender"),
    db.prepare(`${SEASON_SELECT} WHERE s.status = 'activa'`),
    db.prepare(`${TOURNAMENT_SELECT} WHERE t.status = 'programado' AND t.end_date >= ? ORDER BY t.start_date, t.id LIMIT 6`).bind(today),
    db.prepare(`${TOURNAMENT_SELECT} WHERE t.status = 'en_curso' ORDER BY t.start_date, t.id LIMIT 10`),
    db.prepare(
      `SELECT c.id AS category_id, c.name, c.gender, COUNT(p.id) AS n
         FROM categories c LEFT JOIN players p ON p.main_category_id = c.id AND p.active = 1
        WHERE c.active = 1 GROUP BY c.id ORDER BY c.gender DESC, c.level, c.name`,
    ),
    db.prepare(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.summary, a.created_at, u.display_name AS user_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 8`,
    ),
    db.prepare(
      `${TOURNAMENT_SELECT}
        WHERE t.status = 'finalizado' AND s.status <> 'cerrada'
          AND NOT EXISTS (SELECT 1 FROM tournament_credits cr WHERE cr.tournament_id = t.id AND cr.status = 'vigente')
        ORDER BY t.end_date DESC LIMIT 10`,
    ),
  ]);

  const playerStats = { active: 0, inactive: 0, byGender: { M: 0, F: 0 } as Record<Gender, number> };
  for (const r of players!.results as { gender: Gender; active: number; n: number }[]) {
    if (r.active === 1) {
      playerStats.active += r.n;
      playerStats.byGender[r.gender] += r.n;
    } else playerStats.inactive += r.n;
  }
  const categoryStats = { active: 0, byGender: { M: 0, F: 0 } as Record<Gender, number> };
  for (const r of categories!.results as { gender: Gender; n: number }[]) {
    categoryStats.active += r.n;
    categoryStats.byGender[r.gender] = r.n;
  }

  let activeSeason: DashboardData["activeSeason"] = null;
  const seasonRow = season!.results[0];
  let tournamentCounts = { scheduled: 0, inProgress: 0, finished: 0 };
  if (seasonRow) {
    const s: Season = mapSeason(seasonRow as Parameters<typeof mapSeason>[0]);
    const start = Date.parse(s.startDate);
    const end = Date.parse(s.endDate) + 86_400_000;
    const now = Date.parse(today);
    const progress = Math.min(1, Math.max(0, (now - start) / (end - start)));
    activeSeason = { ...s, progress };
    const counts = await db
      .prepare(
        `SELECT SUM(status = 'programado') AS scheduled, SUM(status = 'en_curso') AS in_progress, SUM(status = 'finalizado') AS finished
           FROM tournaments WHERE season_id = ?`,
      )
      .bind(s.id)
      .first<{ scheduled: number | null; in_progress: number | null; finished: number | null }>();
    tournamentCounts = {
      scheduled: counts?.scheduled ?? 0,
      inProgress: counts?.in_progress ?? 0,
      finished: counts?.finished ?? 0,
    };
  }

  const recentActivity: ActivityItem[] = (
    activity!.results as { id: number; action: string; entity: string; entity_id: number | null; summary: string; created_at: string; user_name: string | null }[]
  ).map((a) => ({
    id: a.id,
    action: a.action,
    entity: a.entity,
    entityId: a.entity_id,
    summary: a.summary,
    userName: a.user_name,
    createdAt: a.created_at,
  }));

  const body: DashboardData = {
    today,
    players: playerStats,
    categories: categoryStats,
    activeSeason,
    tournaments: tournamentCounts,
    upcoming: (upcoming!.results as Parameters<typeof mapTournament>[0][]).map(mapTournament),
    inProgress: (inProgress!.results as Parameters<typeof mapTournament>[0][]).map(mapTournament),
    playersByCategory: (byCategory!.results as { category_id: number; name: string; gender: Gender; n: number }[]).map((r) => ({
      categoryId: r.category_id,
      name: r.name,
      gender: r.gender,
      count: r.n,
    })),
    recentActivity,
    pendingCredits: (pending!.results as Parameters<typeof mapTournament>[0][]).map(mapTournament),
  };
  return c.json(body);
});
