import { describe, expect, it } from "vitest";
import {
  computePreview, diffCredit, parseTiebreakers, rankPlayers, stagePoints, teamPoints,
  type RankingStats, type ScoringConfig, type ScoringPlayer, type ScoringTeam,
} from "@shared/scoring";

const stages = [
  { id: 1, label: "Campeón", rank: 1, points: 100, maxTeams: 1 },
  { id: 2, label: "Finalista", rank: 2, points: 70, maxTeams: 1 },
  { id: 3, label: "Semifinal", rank: 3, points: 50, maxTeams: 2 },
  { id: 4, label: "Cuartos de final", rank: 4, points: 30, maxTeams: 4 },
  { id: 5, label: "Fase de grupos", rank: 5, points: 5, maxTeams: null },
];
const config = (extra: Partial<ScoringConfig> = {}): ScoringConfig => ({
  cumulative: false, participationBonus: 0, matchPlayedBonus: 0, matchWonBonus: 0, stages, ...extra,
});
let nextId = 1;
const player = (extra: Partial<ScoringPlayer> = {}): ScoringPlayer => {
  const id = nextId++;
  return { id, code: `J-${id}`, firstName: `N${id}`, lastName: `A${id}`, gender: "M", mainCategoryId: 10, mainCategoryName: "4ta", active: true, ...extra };
};
const team = (id: number, stageId: number | null, extra: Partial<ScoringTeam> = {}): ScoringTeam => ({
  id, seed: null, stageId, matchesPlayed: 0, matchesWon: 0, players: [player(), player()], ...extra,
});
const tournament = { categoryId: 10, divisionId: 99, gender: "M" as const };

describe("puntos por instancia", () => {
  it("el campeón recibe los puntos de campeón, no la suma de fases anteriores", () => {
    expect(stagePoints(config(), stages[0]!)).toBe(100);
    expect(stagePoints(config(), stages[3]!)).toBe(30);
  });

  it("con reglamento acumulativo suma la instancia y todas las anteriores", () => {
    expect(stagePoints(config({ cumulative: true }), stages[0]!)).toBe(100 + 70 + 50 + 30 + 5);
    expect(stagePoints(config({ cumulative: true }), stages[2]!)).toBe(50 + 30 + 5);
    expect(stagePoints(config({ cumulative: true }), stages[4]!)).toBe(5);
  });

  it("aplica bonificaciones por participación, partidos jugados y ganados", () => {
    const c = config({ participationBonus: 3, matchPlayedBonus: 2, matchWonBonus: 1 });
    expect(teamPoints(c, { stageId: 2, matchesPlayed: 5, matchesWon: 4 })).toMatchObject({
      stagePoints: 70, bonusPoints: 3 + 10 + 4, points: 87,
    });
  });

  it("sin instancia no otorga puntos ni bonificación", () => {
    const c = config({ participationBonus: 3 });
    expect(teamPoints(c, { stageId: null, matchesPlayed: 2, matchesWon: 1 }).points).toBe(0);
  });
});

describe("previsualización", () => {
  it("cada integrante de la pareja recibe la misma puntuación", () => {
    const p = computePreview(config({ matchWonBonus: 2 }), [team(1, 1, { matchesPlayed: 4, matchesWon: 4 }), team(2, 2)], tournament);
    const t1 = p.rows.filter((r) => r.teamId === 1);
    expect(t1).toHaveLength(2);
    expect(t1[0]!.points).toBe(108);
    expect(t1[1]!.points).toBe(108);
    expect(p.totals).toEqual({ teams: 2, players: 4, points: 108 * 2 + 70 * 2 });
    expect(p.canConfirm).toBe(true);
    expect(t1[0]!.partnerName).toBe(t1[1]!.name);
    expect(t1[1]!.partnerName).toBe(t1[0]!.name);
  });

  it("acredita en la categoría principal de cada jugador y marca la división sólo si coincide", () => {
    const visitor = player({ mainCategoryId: 20, mainCategoryName: "5ta" });
    const p = computePreview(config(), [team(1, 1, { players: [player(), visitor] })], tournament);
    const own = p.rows.find((r) => r.playerId !== visitor.id)!;
    const other = p.rows.find((r) => r.playerId === visitor.id)!;
    expect(own).toMatchObject({ categoryId: 10, divisionId: 99, otherCategory: false });
    expect(other).toMatchObject({ categoryId: 20, categoryName: "5ta", divisionId: null, otherCategory: true, points: 100 });
  });

  it("detecta errores que impiden confirmar", () => {
    const p = computePreview(config(), [
      team(1, 1), team(2, 1), // dos campeones
      team(3, null), // sin instancia
      team(4, 3, { players: [player()] }), // incompleta
      team(5, 3, { matchesPlayed: 1, matchesWon: 2 }),
    ], tournament);
    const codes = p.issues.filter((i) => i.level === "error").map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["cupo_excedido", "sin_instancia", "pareja_incompleta", "partidos_invalidos"]));
    expect(p.canConfirm).toBe(false);
  });

  it("detecta jugadores repetidos y de otra rama", () => {
    const dup = player();
    const woman = player({ gender: "F" });
    const p = computePreview(config(), [team(1, 1, { players: [dup, woman] }), team(2, 2, { players: [dup, player()] })], tournament);
    const codes = p.issues.map((i) => i.code);
    expect(codes).toContain("jugador_repetido");
    expect(codes).toContain("rama_distinta");
  });

  it("advierte (sin bloquear) si no hay campeón o hay jugadores inactivos", () => {
    const p = computePreview(config(), [team(1, 2, { players: [player({ active: false }), player()] })], tournament);
    expect(p.issues.map((i) => [i.level, i.code])).toEqual(expect.arrayContaining([["warning", "sin_campeon"], ["warning", "jugador_inactivo"]]));
    expect(p.canConfirm).toBe(true);
  });

  it("exige configuración y parejas", () => {
    expect(computePreview(null, [], tournament).issues.map((i) => i.code)).toEqual(["sin_puntuacion", "sin_parejas"]);
  });
});

describe("diferencias de una corrección", () => {
  it("clasifica jugadores modificados, nuevos, quitados e iguales", () => {
    const prev = [
      { playerId: 1, name: "Uno", code: "J-1", categoryName: "4ta", points: 100, stageLabel: "Campeón" },
      { playerId: 2, name: "Dos", code: "J-2", categoryName: "4ta", points: 70, stageLabel: "Finalista" },
      { playerId: 3, name: "Tres", code: "J-3", categoryName: "4ta", points: 50, stageLabel: "Semifinal" },
    ];
    const next = computePreview(config(), [], tournament).rows; // vacío
    const rows = [
      ...next,
      { playerId: 1, name: "Uno", code: "J-1", categoryName: "4ta", points: 70, stageLabel: "Finalista" },
      { playerId: 3, name: "Tres", code: "J-3", categoryName: "4ta", points: 50, stageLabel: "Semifinal" },
      { playerId: 4, name: "Cuatro", code: "J-4", categoryName: "4ta", points: 30, stageLabel: "Cuartos" },
    ] as Parameters<typeof diffCredit>[1];
    const diff = diffCredit(prev, rows);
    const by = Object.fromEntries(diff.map((d) => [d.playerId, d]));
    expect(by[1]).toMatchObject({ before: 100, after: 70, delta: -30, change: "modificado" });
    expect(by[2]).toMatchObject({ before: 70, after: null, delta: -70, change: "quitado" });
    expect(by[3]).toMatchObject({ delta: 0, change: "igual" });
    expect(by[4]).toMatchObject({ before: null, after: 30, change: "nuevo" });
  });
});

describe("rankings y desempates", () => {
  const e = (playerId: number, lastName: string, extra: Partial<RankingStats>): RankingStats => ({
    playerId, lastName, firstName: "X", points: 0, tournaments: 1, titles: 0, finals: 0, semifinals: 0, bestTournament: 0, matchesWon: 0, ...extra,
  });

  it("ordena por puntos y desempata según los criterios en orden", () => {
    const list = [
      e(1, "Alfa", { points: 100, titles: 0, finals: 2 }),
      e(2, "Beta", { points: 100, titles: 1, finals: 1 }),
      e(3, "Gama", { points: 150 }),
    ];
    expect(rankPlayers(list, ["titulos"]).map((r) => [r.entry.playerId, r.position])).toEqual([[3, 1], [2, 2], [1, 3]]);
    expect(rankPlayers(list, ["finales"]).map((r) => [r.entry.playerId, r.position])).toEqual([[3, 1], [1, 2], [2, 3]]);
  });

  it("comparten posición si siguen empatados (1, 2, 2, 4)", () => {
    const list = [e(1, "Zeta", { points: 50 }), e(2, "Alfa", { points: 50 }), e(3, "Beta", { points: 90 }), e(4, "Rho", { points: 10 })];
    const ranked = rankPlayers(list, ["titulos"]);
    expect(ranked.map((r) => [r.entry.lastName, r.position, r.tied])).toEqual([
      ["Beta", 1, false], ["Alfa", 2, true], ["Zeta", 2, true], ["Rho", 4, false],
    ]);
  });

  it("menos torneos jugados premia la eficiencia", () => {
    const list = [e(1, "A", { points: 60, tournaments: 3 }), e(2, "B", { points: 60, tournaments: 2 })];
    expect(rankPlayers(list, ["menos_torneos"])[0]!.entry.playerId).toBe(2);
    expect(rankPlayers(list, ["mas_torneos"])[0]!.entry.playerId).toBe(1);
  });

  it("interpreta la configuración guardada con tolerancia", () => {
    expect(parseTiebreakers(null)).toEqual(["titulos", "finales", "mejor_torneo", "menos_torneos"]);
    expect(parseTiebreakers('["finales","inventado"]')).toEqual(["finales"]);
    expect(parseTiebreakers("no-json")).toHaveLength(4);
  });
});
