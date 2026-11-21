import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIXTURE_CONFIG, bracketSkeleton, bracketSize, buildPublicFixture, checkScore, cupPositions, distributeGroups, drawOrder,
  fixtureIssues, groupStanding, parseFixtureConfig, placeEntries, roundLabel, roundRobin, seedFromGroups, seedFromTeams, seedPositions, syncBrackets,
  type FixtureConfig, type FxGroup, type FxMatch, type FxTeam, type GroupStanding, type SetScore, type SlotSource,
} from "@shared/fixture";

const cfg = (extra: Partial<FixtureConfig> = {}): FixtureConfig => ({ ...DEFAULT_FIXTURE_CONFIG, ...extra });
const team = (id: number, seed: number | null = null, withdrawn = false): FxTeam => ({ id, name: `P${id}`, seed, withdrawn });
let mid = 1;
const gmatch = (groupId: number, t1: number, t2: number, sets: SetScore[] = [], extra: Partial<FxMatch> = {}): FxMatch => {
  const decided = sets.length > 0;
  const won1 = sets.filter(([a, b]) => a > b).length;
  const won2 = sets.length - won1;
  return {
    id: mid++, phase: "grupos", groupId, round: 1, slot: 0, team1Id: t1, team2Id: t2, source1: null, source2: null,
    status: decided ? "jugado" : "pendiente", winner: decided ? (won1 > won2 ? 1 : 2) : null, sets, date: null, time: null, court: null, ...extra,
  };
};
const W: SetScore[] = [[6, 2], [6, 3]]; // gana la pareja 1 en dos sets
const L: SetScore[] = [[2, 6], [3, 6]]; // gana la pareja 2

describe("validación de marcadores (3 sets, tie break en 6-6)", () => {
  const f = DEFAULT_FIXTURE_CONFIG.match;
  it("acepta resultados válidos y detecta al ganador", () => {
    expect(checkScore(f, "jugado", [[6, 4], [7, 6]], null)).toEqual({ ok: true, winner: 1, sets: [[6, 4], [7, 6]] });
    expect(checkScore(f, "jugado", [[6, 4], [3, 6], [5, 7]], null)).toMatchObject({ ok: true, winner: 2 });
    expect(checkScore(f, "jugado", [[7, 5], [0, 6], [6, 0]], null)).toMatchObject({ ok: true, winner: 1 });
  });
  it("rechaza sets imposibles, partidos sin terminar y sets de más", () => {
    expect(checkScore(f, "jugado", [[6, 5], [6, 0]], null)).toMatchObject({ ok: false });
    expect(checkScore(f, "jugado", [[8, 6], [6, 0]], null)).toMatchObject({ ok: false });
    expect(checkScore(f, "jugado", [[6, 6], [6, 0]], null)).toMatchObject({ ok: false });
    expect(checkScore(f, "jugado", [[6, 4]], null)).toMatchObject({ ok: false, error: expect.stringContaining("no está terminado") });
    expect(checkScore(f, "jugado", [[6, 4], [6, 4], [6, 4]], null)).toMatchObject({ ok: false, error: expect.stringContaining("de más") });
    expect(checkScore(f, "jugado", [], null)).toMatchObject({ ok: false });
  });
  it("rechaza un ganador que contradice el marcador", () => {
    expect(checkScore(f, "jugado", W, 2)).toMatchObject({ ok: false });
  });
  it("sin tie break exige dos games de diferencia", () => {
    const adv = { ...f, tiebreak: false };
    expect(checkScore(adv, "jugado", [[8, 6], [6, 0]], null)).toMatchObject({ ok: true, winner: 1 });
    expect(checkScore(adv, "jugado", [[7, 6], [6, 0]], null)).toMatchObject({ ok: false });
  });
  it("súper tie break en el tercer set", () => {
    const stb = { ...f, finalSet: "super_tiebreak" as const };
    expect(checkScore(stb, "jugado", [[6, 4], [4, 6], [10, 8]], null)).toMatchObject({ ok: true, winner: 1 });
    expect(checkScore(stb, "jugado", [[6, 4], [4, 6], [12, 10]], null)).toMatchObject({ ok: true });
    expect(checkScore(stb, "jugado", [[6, 4], [4, 6], [10, 9]], null)).toMatchObject({ ok: false });
    expect(checkScore(stb, "jugado", [[6, 4], [4, 6], [13, 10]], null)).toMatchObject({ ok: false });
  });
  it("W.O., retiro y resultado administrativo exigen indicar ganador", () => {
    expect(checkScore(f, "wo", [], null)).toMatchObject({ ok: false });
    expect(checkScore(f, "wo", [], 2)).toEqual({ ok: true, winner: 2, sets: [] });
    expect(checkScore(f, "wo", W, 1)).toMatchObject({ ok: false });
    expect(checkScore(f, "retiro", [[6, 3], [2, 1]], 1)).toMatchObject({ ok: true, winner: 1 });
    expect(checkScore(f, "retiro", [[6, 3]], null)).toMatchObject({ ok: false });
    expect(checkScore(f, "administrativo", [], 1)).toMatchObject({ ok: true });
    expect(checkScore(f, "bye", [], 1)).toMatchObject({ ok: false });
  });
});

describe("generación de grupos y distribución de parejas", () => {
  it("todos contra todos: cada par una vez y nadie juega dos veces por fecha", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const ms = roundRobin(ids);
      expect(ms.length).toBe((n * (n - 1)) / 2);
      const pairs = new Set(ms.map((m) => [m.team1Id, m.team2Id].sort().join("-")));
      expect(pairs.size).toBe(ms.length);
      const rounds = new Set(ms.map((m) => m.round));
      expect(rounds.size).toBe(n % 2 ? n : n - 1);
      for (const r of rounds) {
        const playing = ms.filter((m) => m.round === r).flatMap((m) => [m.team1Id, m.team2Id]);
        expect(new Set(playing).size).toBe(playing.length);
      }
    }
    expect(roundRobin([1])).toEqual([]);
  });

  it("serpentina: cabezas de serie en grupos distintos y tamaños parejos", () => {
    const groups = distributeGroups(Array.from({ length: 10 }, (_, i) => i + 1), 3);
    expect(groups.map((g) => g[0])).toEqual([1, 2, 3]);
    expect(groups.map((g) => g.length).sort()).toEqual([3, 3, 4]);
    expect(groups[2]).toContain(4); // 4 vuelve hacia el último grupo
    expect(groups.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it("orden de armado: cabezas de serie primero; sin retiradas; sorteo reproducible", () => {
    const teams = [team(1), team(2, 2), team(3), team(4, 1), team(5, null, true), team(6)];
    expect(drawOrder(teams, null).map((t) => t.id)).toEqual([4, 2, 1, 3, 6]);
    const a = drawOrder(teams, 1234).map((t) => t.id);
    expect(a.slice(0, 2)).toEqual([4, 2]);
    expect(drawOrder(teams, 1234).map((t) => t.id)).toEqual(a);
    expect(a).not.toContain(5);
  });
});

describe("tablas de posiciones y desempates", () => {
  const g: FxGroup = { id: 1, name: "A", teamIds: [1, 2, 3, 4], manualOrder: null };
  const teams = [1, 2, 3, 4].map((id) => team(id));

  it("cuenta partidos, sets y games", () => {
    const ms = [gmatch(1, 1, 2, [[6, 4], [3, 6], [7, 6]]), gmatch(1, 3, 4, L)];
    const st = groupStanding(cfg(), g, ms, teams);
    const r1 = st.rows.find((r) => r.teamId === 1)!;
    expect(r1).toMatchObject({ played: 1, won: 1, lost: 0, setsWon: 2, setsLost: 1, gamesWon: 16, gamesLost: 16 });
    expect(st.complete).toBe(false);
    expect(st.total).toBe(6); // 4 parejas: 6 cruces
  });

  it("ordena por ganados y desempata por enfrentamiento directo", () => {
    // 1 y 2 ganan 2 partidos; 2 le ganó a 1.
    // 3 y 4 ganan uno cada una; 4 le ganó a 3.
    const ms = [gmatch(1, 1, 2, L), gmatch(1, 1, 3, W), gmatch(1, 1, 4, W), gmatch(1, 2, 3, L), gmatch(1, 2, 4, W), gmatch(1, 3, 4, L)];
    const st = groupStanding(cfg(), g, ms, teams);
    expect(st.rows.map((r) => r.teamId)).toEqual([2, 1, 4, 3]);
    expect(st.complete).toBe(true);
    expect(st.unresolved).toEqual([]);
  });

  it("triple empate: el resultado entre ellas no alcanza y define la diferencia de sets", () => {
    // 1 > 2, 2 > 3, 3 > 1 (círculo). Todos le ganan a 4. Sets distintos.
    const ms = [
      gmatch(1, 1, 2, [[6, 0], [6, 0]]), gmatch(1, 2, 3, [[6, 0], [4, 6], [6, 0]]), gmatch(1, 3, 1, [[6, 0], [4, 6], [6, 0]]),
      gmatch(1, 1, 4, W), gmatch(1, 2, 4, W), gmatch(1, 3, 4, W),
    ];
    const st = groupStanding(cfg(), g, ms, teams);
    // dif sets: 1 → +2 +(-1) +2 = 3; 2 → -2 +1 +2 = 1; 3 → -1 +1 +2 = 2
    expect(st.rows.map((r) => r.teamId)).toEqual([1, 3, 2, 4]);
  });

  it("el orden de criterios es configurable", () => {
    const ms = [gmatch(1, 1, 2, [[6, 0], [6, 0]]), gmatch(1, 2, 1, [[7, 6], [7, 6]]), gmatch(1, 3, 4, W)];
    // Con "games ganados" primero, 1 queda arriba de 2 (12+12=24 vs 14+...); con "directo" quedan empatados (1 a 1).
    const byGames = groupStanding(cfg({ tiebreakers: ["ganados", "games_ganados"] }), g, ms, teams);
    expect(byGames.rows[0]!.teamId).toBe(1);
    const onlyDirect = groupStanding(cfg({ tiebreakers: ["ganados", "directo"] }), g, ms, teams);
    expect(onlyDirect.unresolved.some((t) => t.includes(1) && t.includes(2))).toBe(true);
  });

  it("empate que ningún criterio resuelve: se marca y se define a mano", () => {
    const g2: FxGroup = { id: 2, name: "B", teamIds: [1, 2], manualOrder: null };
    const ms = [gmatch(2, 1, 2, W, { status: "wo", sets: [], winner: null })];
    ms[0]!.status = "pendiente";
    const st = groupStanding(cfg(), g2, ms, teams);
    expect(st.unresolved).toEqual([[1, 2]]);
    expect(st.rows.every((r) => r.position === 1 && r.tied)).toBe(true);
    const fixed = groupStanding(cfg(), { ...g2, manualOrder: [2, 1] }, ms, teams);
    expect(fixed.rows.map((r) => r.teamId)).toEqual([2, 1]);
    expect(fixed.unresolved).toEqual([]);
  });

  it("W.O.: según la configuración suma o no sets y games; las retiradas van al final", () => {
    const g3: FxGroup = { id: 3, name: "C", teamIds: [1, 2, 3], manualOrder: null };
    const ms = [gmatch(3, 1, 2, [], { status: "wo", winner: 1 })];
    const plain = groupStanding(cfg(), g3, ms, [team(1), team(2), team(3, null, true)]);
    expect(plain.rows.find((r) => r.teamId === 1)).toMatchObject({ won: 1, setsWon: 0, gamesWon: 0 });
    expect(plain.rows.at(-1)!.teamId).toBe(3);
    const asScore = groupStanding(cfg({ walkover: "como_resultado" }), g3, ms, [team(1), team(2), team(3)]);
    expect(asScore.rows.find((r) => r.teamId === 1)).toMatchObject({ won: 1, setsWon: 2, gamesWon: 12 });
  });
});

describe("clasificación a Copa de Oro / Plata", () => {
  it("posiciones por copa según la configuración", () => {
    expect(cupPositions(cfg({ goldPerGroup: 2, silver: "resto" }), 5)).toEqual({ oro: [1, 2], plata: [3, 4, 5] });
    expect(cupPositions(cfg({ goldPerGroup: 2, silver: "cantidad", silverPerGroup: 2 }), 5)).toEqual({ oro: [1, 2], plata: [3, 4] });
    expect(cupPositions(cfg({ goldPerGroup: 4, silver: "ninguna" }), 4)).toEqual({ oro: [1, 2, 3, 4], plata: [] });
  });

  it("dos grupos de 4 → cruce del reglamento del Master: 1°A–4°B, 2°B–3°A, 1°B–4°A, 2°A–3°B", () => {
    const entries = seedFromGroups([{ groupId: 1, positions: [1, 2, 3, 4] }, { groupId: 2, positions: [1, 2, 3, 4] }]);
    const pairs = placeEntries(entries).map(([a, b]) => [a, b].map((s) => (s.kind === "grupo" ? `${s.groupId === 1 ? "A" : "B"}${s.position}` : "BYE")).join("-"));
    expect(pairs).toEqual(["A1-B4", "B2-A3", "B1-A4", "A2-B3"]);
  });

  it("dos clasificados por grupo con dos grupos: semifinales 1°A–2°B y 1°B–2°A", () => {
    const pairs = placeEntries(seedFromGroups([{ groupId: 1, positions: [1, 2] }, { groupId: 2, positions: [1, 2] }]));
    expect(pairs.map(([a, b]) => [a, b].map((s) => (s as { groupId: number; position: number }).groupId * 10 + (s as { position: number }).position))).toEqual([[11, 22], [21, 12]]);
  });

  it("tres grupos: evita que dos del mismo grupo se crucen en primera ronda y da BYE a los mejores", () => {
    const entries = seedFromGroups([1, 2, 3].map((id) => ({ groupId: id, positions: [1, 2] })));
    const pairs = placeEntries(entries);
    expect(pairs).toHaveLength(4);
    for (const [a, b] of pairs) {
      if (a.kind === "grupo" && b.kind === "grupo") expect(a.groupId).not.toBe(b.groupId);
    }
    const byes = pairs.filter(([a, b]) => a.kind === "bye" || b.kind === "bye");
    expect(byes).toHaveLength(2);
    for (const [a, b] of byes) expect((a.kind === "grupo" ? a : b) as SlotSource).toMatchObject({ position: 1 });
  });

  it("orden estándar de cabezas de serie y tamaños de cuadro", () => {
    expect(seedPositions(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect([2, 3, 5, 8, 9].map(bracketSize)).toEqual([2, 4, 8, 8, 16]);
    expect(roundLabel(16, 1)).toBe("Octavos de final");
    expect(roundLabel(16, 4)).toBe("Final");
  });

  it("eliminación directa con cabezas de serie: el 1 y el 2 en mitades opuestas y BYE para los primeros", () => {
    const teams = [team(10), team(11, 2), team(12), team(13, 1), team(14), team(15)];
    const pairs = placeEntries(seedFromTeams(teams));
    expect(pairs).toHaveLength(4);
    expect(pairs[0]).toEqual([{ kind: "pareja", teamId: 13 }, { kind: "bye" }]);
    expect(pairs[2]).toEqual([{ kind: "pareja", teamId: 11 }, { kind: "bye" }]);
  });
});

describe("cuadros: BYE, avance de ronda y conflictos", () => {
  const make = (pairs: [SlotSource, SlotSource][]) => bracketSkeleton("oro", pairs).map((m, i) => ({ ...m, id: 100 + i }));
  const P = (id: number): SlotSource => ({ kind: "pareja", teamId: id });
  const BYE: SlotSource = { kind: "bye" };
  const apply = (ms: FxMatch[], ups: ReturnType<typeof syncBrackets>["updates"]) => {
    for (const u of ups) Object.assign(ms.find((m) => m.id === u.matchId)!, { team1Id: u.team1Id, team2Id: u.team2Id, status: u.status, winner: u.winner });
  };
  const empty = new Map<number, GroupStanding>();

  it("el BYE avanza solo y el ganador pasa a la ronda siguiente", () => {
    const ms = make([[P(1), BYE], [P(2), P(3)]]);
    const first = syncBrackets(ms, empty);
    apply(ms, first.updates);
    expect(ms[0]).toMatchObject({ team1Id: 1, team2Id: null, status: "bye", winner: 1 });
    expect(ms[2]).toMatchObject({ round: 2, team1Id: 1, team2Id: null });
    Object.assign(ms[1]!, { status: "jugado", winner: 2, sets: L });
    apply(ms, syncBrackets(ms, empty).updates);
    expect(ms[2]).toMatchObject({ team1Id: 1, team2Id: 3, status: "pendiente" });
    expect(syncBrackets(ms, empty)).toEqual({ updates: [], conflicts: [] });
  });

  it("corregir un resultado actualiza la ronda siguiente si todavía no se jugó", () => {
    const ms = make([[P(1), P(4)], [P(2), P(3)]]);
    Object.assign(ms[0]!, { team1Id: 1, team2Id: 4, status: "jugado", winner: 1, sets: W });
    Object.assign(ms[1]!, { team1Id: 2, team2Id: 3, status: "jugado", winner: 1, sets: W });
    apply(ms, syncBrackets(ms, empty).updates);
    expect(ms[2]).toMatchObject({ team1Id: 1, team2Id: 2 });
    Object.assign(ms[1]!, { winner: 2, sets: L }); // corrección
    const r = syncBrackets(ms, empty);
    expect(r.conflicts).toEqual([]);
    apply(ms, r.updates);
    expect(ms[2]).toMatchObject({ team1Id: 1, team2Id: 3 });
  });

  it("si el partido siguiente ya se jugó, NO se sobrescribe: se informa el conflicto", () => {
    const ms = make([[P(1), P(4)], [P(2), P(3)]]);
    Object.assign(ms[0]!, { team1Id: 1, team2Id: 4, status: "jugado", winner: 1, sets: W });
    Object.assign(ms[1]!, { team1Id: 2, team2Id: 3, status: "jugado", winner: 1, sets: W });
    Object.assign(ms[2]!, { team1Id: 1, team2Id: 2, status: "jugado", winner: 2, sets: L });
    expect(syncBrackets(ms, empty).conflicts).toEqual([]);
    Object.assign(ms[1]!, { winner: 2, sets: L }); // ahora ganó 3, pero la final se jugó con 2
    const r = syncBrackets(ms, empty, (id) => `P${id}`);
    expect(r.updates).toEqual([]);
    expect(r.conflicts).toEqual([expect.objectContaining({ matchId: ms[2]!.id, side: 2, current: 2, expected: 3 })]);
    expect(r.conflicts[0]!.message).toContain("se jugó con P2");
    expect(ms[2]).toMatchObject({ team2Id: 2, winner: 2 });
  });

  it("los lugares de grupo se completan sólo cuando el grupo terminó y sin empates", () => {
    const g: FxGroup = { id: 1, name: "A", teamIds: [1, 2], manualOrder: null };
    const gm = [gmatch(1, 1, 2)];
    const ms = make([[{ kind: "grupo", groupId: 1, position: 1 }, { kind: "grupo", groupId: 1, position: 2 }]]);
    const standings = (all: FxMatch[]) => new Map([[1, groupStanding(cfg(), g, all, [team(1), team(2)])]]);
    expect(syncBrackets(ms, standings(gm)).updates).toEqual([]);
    Object.assign(gm[0]!, { status: "jugado", winner: 2, sets: L });
    const r = syncBrackets(ms, standings(gm));
    expect(r.updates).toEqual([expect.objectContaining({ team1Id: 2, team2Id: 1 })]);
  });

  it("detecta inconsistencias: conflictos, empates, retiradas y superposición de horarios", () => {
    const teams = [team(1), team(2), team(3, null, true), team(4)];
    const g: FxGroup = { id: 1, name: "A", teamIds: [1, 2, 3, 4], manualOrder: null };
    const ms = [
      gmatch(1, 1, 3, [], { date: "2026-06-02", time: "21:00", court: "Cancha 1" }),
      gmatch(1, 2, 4, [], { date: "2026-06-02", time: "21:00", court: "cancha 1" }),
      gmatch(1, 1, 2, [], { date: "2026-06-02", time: "21:00", court: "Cancha 2" }),
    ];
    const st = new Map([[1, groupStanding(cfg(), g, ms, teams)]]);
    const issues = fixtureIssues(cfg(), teams, [g], ms, st, [{ matchId: 9, side: 1, current: 1, expected: 2, message: "x" }]);
    expect([...new Set(issues.map((i) => i.code))].sort()).toEqual(["cancha", "conflicto", "pareja", "retirada"]);
    expect(issues.filter((i) => i.code === "pareja")).toHaveLength(2); // la 1 y la 2 tienen dos partidos a la misma hora
  });
});

describe("configuración y vista pública", () => {
  it("completa configuraciones viejas o inválidas con los valores por defecto", () => {
    expect(parseFixtureConfig(null)).toEqual(DEFAULT_FIXTURE_CONFIG);
    expect(parseFixtureConfig({ groupCount: 3 })).toMatchObject({ groupCount: 3, goldPerGroup: 2 });
    expect(parseFixtureConfig({ groupCount: 99 })).toEqual(DEFAULT_FIXTURE_CONFIG);
  });

  it("arma la vista pública con tablas, partidos y cuadros sin datos internos", () => {
    const teams = [team(1), team(2)];
    const g: FxGroup = { id: 1, name: "A", teamIds: [1, 2], manualOrder: null };
    const ms: FxMatch[] = [gmatch(1, 1, 2, W, { date: "2026-06-02", time: "21:00", court: "Cancha 1" }), ...bracketSkeleton("oro", [[{ kind: "grupo", groupId: 1, position: 1 }, { kind: "bye" }]]).map((m, i) => ({ ...m, id: 900 + i }))];
    const pub = buildPublicFixture(cfg(), teams, [g], ms);
    expect(pub.groups[0]!.rows.map((r) => r.team)).toEqual(["P1", "P2"]);
    expect(pub.matches[0]).toMatchObject({ roundLabel: "Fecha 1", score: "6-2 6-3", court: "Cancha 1", group: "A" });
    expect(pub.brackets).toEqual([{ phase: "oro", size: 2, rounds: ["Final"] }]);
    expect(JSON.stringify(pub)).not.toContain("teamId");
  });
});

describe("posiciones finales → puntuación (Fase 10)", () => {
  const P = (id: number): SlotSource => ({ kind: "pareja", teamId: id });
  it("determina campeón, finalista y eliminados por ronda; W.O. y BYE no cuentan como jugados", async () => {
    const { finalPlacements, fixtureComplete } = await import("@shared/fixture");
    const ms = bracketSkeleton("oro", [[P(1), { kind: "bye" }], [P(2), P(3)]]).map((m, i) => ({ ...m, id: 500 + i }));
    Object.assign(ms[0]!, { team1Id: 1, status: "bye", winner: 1 });
    Object.assign(ms[1]!, { team1Id: 2, team2Id: 3, status: "wo", winner: 1 });
    expect(fixtureComplete(ms).complete).toBe(false);
    Object.assign(ms[2]!, { team1Id: 1, team2Id: 2, status: "jugado", winner: 2, sets: L });
    const groupMatch = gmatch(1, 1, 3, W);
    const all = [groupMatch, ...ms];
    expect(fixtureComplete(all).complete).toBe(true);
    const fp = finalPlacements([team(1), team(2), team(3), team(4)], all);
    expect(fp.map((p) => [p.teamId, p.key, p.label])).toEqual([
      [2, "oro:1", "Campeón · Copa de Oro"], [1, "oro:2", "Finalista · Copa de Oro"], [3, "oro:4", "Semifinal · Copa de Oro"], [4, "grupos", "Fase de grupos"],
    ]);
    expect(fp.find((p) => p.teamId === 1)).toMatchObject({ matchesPlayed: 2, matchesWon: 1 }); // grupo + final (el BYE no cuenta)
    expect(fp.find((p) => p.teamId === 2)).toMatchObject({ matchesPlayed: 1, matchesWon: 1 }); // el W.O. no cuenta
  });

  it("propone la equivalencia por nombre de instancia y marca la Copa de Plata para revisar", async () => {
    const { defaultStageMap } = await import("@shared/fixture");
    const stages = [
      { id: 1, label: "Campeón", rank: 1, points: 100, maxTeams: 1 }, { id: 2, label: "Finalista", rank: 2, points: 70, maxTeams: 1 },
      { id: 3, label: "Semifinal", rank: 3, points: 50, maxTeams: 2 }, { id: 4, label: "Cuartos de final", rank: 4, points: 30, maxTeams: 4 },
      { id: 7, label: "Fase de grupos", rank: 7, points: 5, maxTeams: null },
    ];
    const { map, review } = defaultStageMap(["oro:1", "oro:2", "oro:4", "oro:8", "plata:1", "grupos", "cuadro:16"], stages);
    expect(map).toEqual({ "oro:1": 1, "oro:2": 2, "oro:4": 3, "oro:8": 4, "plata:1": 7, grupos: 7, "cuadro:16": null });
    expect(review).toEqual(["plata:1"]);
  });
});
