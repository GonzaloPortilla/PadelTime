import { APP_TIMEZONE, GENDER_LABEL, TIEBREAKER_LABEL, type Gender, type Tiebreaker } from "./constants";
import type { RankingRow } from "./types";
import type { Cell, Sheet } from "./export";

const dateTimeFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: APP_TIMEZONE });
const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

export const RANKING_HEADER = [
  "Posición", "Jugador", "Apellido", "Nombre", "Código", "Puntos", "Torneos", "Campeonatos", "Finales", "Semifinales", "Mejor torneo", "Partidos ganados", "Ajustes", "Saldo inicial",
];
const WIDTHS = [9, 28, 18, 16, 10, 9, 9, 12, 9, 12, 13, 15, 9, 12];

export function rankingRows(rows: RankingRow[]): Cell[][] {
  return rows.map((r) => [
    r.tied ? `${r.position}=` : r.position,
    `${r.lastName}, ${r.firstName}`,
    r.lastName,
    r.firstName,
    r.code,
    r.points,
    r.tournaments,
    r.titles,
    r.finals,
    r.semifinals,
    r.bestTournament,
    r.matchesWon,
    r.adjustments,
    r.initialBalance,
  ]);
}

export function rankingSheet(opts: {
  seasonName: string;
  category: { name: string; gender: Gender };
  divisionName?: string | null;
  tiebreakers: Tiebreaker[];
  rows: RankingRow[];
  generatedAt: string;
}): Sheet {
  const catLabel = `${opts.category.name} ${GENDER_LABEL[opts.category.gender]}${opts.divisionName ? ` · División ${opts.divisionName}` : ""}`;
  return {
    name: `${opts.category.name} ${opts.category.gender === "M" ? "Cab" : "Dam"}${opts.divisionName ? ` ${opts.divisionName}` : ""}`,
    title: [
      `Ranking ${catLabel} — ${opts.seasonName}`,
      `Padel Time · generado el ${formatDateTime(opts.generatedAt)}`,
      `Desempate: puntos${opts.tiebreakers.map((t) => `, ${TIEBREAKER_LABEL[t].toLowerCase()}`).join("")}. "=" indica posición compartida.`,
    ],
    header: RANKING_HEADER,
    rows: rankingRows(opts.rows),
    widths: WIDTHS,
  };
}
