import { describe, expect, it } from "vitest";
import fixture from "./fixtures/cuadro-referencia.ocr.json";
import { draftFromRaw, interpret, mapStagesToTournament, roundKeyFromText, teamSimilarity, type BracketDraft } from "../src/ocr/bracket";
import { splitTeam } from "@shared/names";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const stageOf = (draft: BracketDraft, text: RegExp) => {
  const r = interpret(draft);
  return r.teams.find((t) => text.test(t.text))?.stage ?? "no-encontrado";
};

/** Resultado esperado según la imagen de referencia. */
const EXPECTED: Record<string, string> = {
  "NICOLAS SALAS - MILTON AHUMADA": "campeon",
  "LEO MOSQUERA - TIMO MOSQUERA": "finalista",
  "DIEGO HARRIEGUE - MAXI FERNANDEZ": "semifinal",
  "TOMAS IVENICEVICH - SANTIAGO WOLF": "semifinal",
  "LEONEL LARREA - LUCAS LARREA": "cuartos",
  "GUIDO GROSSO - GASTON ANDREASSI": "cuartos",
  "MILTON GONZALEZ - EZE FONTOURA": "cuartos",
  "JORGE PIPINO - MATIAS ROCHELLE": "cuartos",
  "ARIEL GONZALEZ - DIEGO CEJAS": "octavos",
  "GONZALO CALANDRA - GONZALO FABRO": "octavos",
  "ARIEL BUFFA - LEANDRO GOROSITO": "octavos",
  "FACU CASTILLO - DANTE STASSI": "octavos",
  "EZEQUIEL CESAR - MARCELO AMPUERO": "octavos",
  "NICOLAS EMULO - CHECHO": "octavos",
  "SERGIO ZANON - TIZIANO ZANON": "octavos",
  "NICOLAS STAMPONE - LEAN SODERO": "octavos",
};

describe("cuadro de referencia (salida real del OCR)", () => {
  const draft = draftFromRaw(fixture);
  const result = interpret(draft);

  it("reconoce 4 rondas y 15 partidos", () => {
    expect(draft.rounds.map((r) => r.key)).toEqual(["octavos", "cuartos", "semifinal", "finalista"]);
    expect(draft.rounds.map((r) => r.label)).toEqual(["OCTAVOS", "CUARTOS", "SEMIS", "FINAL"]);
    expect(draft.matches.map((m) => m.round)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3]);
  });

  it("une las apariciones de cada pareja en 16 parejas distintas", () => {
    expect(result.teams).toHaveLength(16);
  });

  it("deduce campeones, finalistas y la instancia de cada pareja", () => {
    const champion = result.teams.find((t) => t.key === result.champion)!;
    expect(champion.players).toEqual(["NICOLAS SALAS", "MILTON AHUMADA"]);
    for (const [text, stage] of Object.entries(EXPECTED)) {
      const team = result.teams.find((t) => teamSimilarity(t.players, splitTeam(text).players) >= 0.95);
      expect(team, text).toBeDefined();
      expect(team!.stage, text).toBe(stage);
    }
  });

  it("deduce partidos jugados y ganados sin exigir cargarlos", () => {
    const by = (re: RegExp) => result.teams.find((t) => re.test(t.text))!;
    expect(by(/SALAS/)).toMatchObject({ matchesPlayed: 4, matchesWon: 4 });
    expect(by(/MOSQUERA/)).toMatchObject({ matchesPlayed: 4, matchesWon: 3 });
    expect(by(/ZANON/)).toMatchObject({ matchesPlayed: 1, matchesWon: 0 });
  });

  it("aprende que la X marca al perdedor y no reporta errores", () => {
    expect(result.markMeaning).toBe("perdedor");
    expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(result.canImport).toBe(true);
    // Todos los ganadores tienen evidencia concordante (resultado + avance y/o marca).
    for (const m of result.matches) expect(m.sources.length, m.id).toBeGreaterThanOrEqual(1);
  });
});

describe("tolerancia a errores de lectura", () => {
  it("une una pareja aunque una aparición esté mal leída", () => {
    const d = draftFromRaw(clone(fixture));
    d.matches[14]!.sides[1]!.text = "NICOLAS SALAS -MILTONAHUMADA"; // final
    d.matches[13]!.sides[1]!.text = "NIC0LAS SALAS - MILT0N AHUMADA"; // semis
    expect(interpret(d).teams).toHaveLength(16);
    expect(stageOf(d, /SALAS/)).toBe("campeon");
  });

  it("si el resultado de la final es ilegible y no hay marcas, NO inventa campeón", () => {
    const d = draftFromRaw(clone(fixture));
    d.matches[14]!.sides[0]!.score = null;
    d.matches[14]!.sides[1]!.score = null;
    const r = interpret(d);
    expect(r.champion).toBeNull();
    expect(r.teams.find((t) => /SALAS/.test(t.text))!.stage).toBeNull();
    expect(r.teams.find((t) => /MOSQUERA/.test(t.text))!.stage).toBeNull();
    expect(r.issues.some((i) => i.level === "error" && /campeón/.test(i.message))).toBe(true);
    expect(r.canImport).toBe(false);
    // El organizador elige el ganador a mano.
    d.matches[14]!.winnerOverride = 1;
    expect(interpret(d).champion).not.toBeNull();
    expect(stageOf(d, /SALAS/)).toBe("campeon");
  });

  it("deduce ganadores por avance aunque falten resultados intermedios", () => {
    const d = draftFromRaw(clone(fixture));
    for (const m of d.matches) if (m.round < 3) m.sides.forEach((s) => { s.score = null; s.marked = null; });
    const r = interpret(d);
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(stageOf(d, /HARRIEGUE/)).toBe("semifinal");
    expect(stageOf(d, /ZANON/)).toBe("octavos");
  });

  it("informa contradicciones entre resultado y avance (y prioriza el avance)", () => {
    const d = draftFromRaw(clone(fixture));
    d.matches[0]!.sides[0]!.score = 7; // Gonzalez/Cejas "ganaría" pero quien avanza es Harriegue/Fernandez
    const r = interpret(d);
    expect(r.issues.some((i) => /contradictorios/.test(i.message))).toBe(true);
    expect(stageOf(d, /CEJAS/)).toBe("octavos");
  });

  it("detecta parejas duplicadas en la misma ronda y nombres incompletos", () => {
    const d = draftFromRaw(clone(fixture));
    d.matches[1]!.sides[1]!.text = "ARIEL GONZALEZ - DIEGO CEJAS";
    d.matches[2]!.sides[0]!.text = "";
    const r = interpret(d);
    expect(r.issues.some((i) => /figura 2 veces en Octavos/.test(i.message))).toBe(true);
    expect(r.issues.some((i) => /falta el nombre/.test(i.message))).toBe(true);
    expect(r.canImport).toBe(false);
  });

  it("detecta una pareja que ganó pero no aparece en la ronda siguiente", () => {
    const d = draftFromRaw(clone(fixture));
    d.matches[8]!.sides[0]!.text = "OTRA PAREJA - DISTINTA"; // cuartos: Harriegue mal leído
    const r = interpret(d);
    expect(r.issues.some((i) => /pero no figura en|pero no en/.test(i.message))).toBe(true);
  });

  it("advierte las lecturas de baja confianza", () => {
    const d = draftFromRaw(clone(fixture));
    d.matches[3]!.sides[0]!.conf = 40;
    expect(interpret(d).issues.some((i) => /confianza 40%/.test(i.message))).toBe(true);
  });
});

describe("rondas e instancias del torneo", () => {
  it("reconoce encabezados", () => {
    expect(["OCTAVOS", "Cuartos", "SEMIS", "Semifinal", "FINAL", "16avos"].map(roundKeyFromText))
      .toEqual(["octavos", "cuartos", "semifinal", "semifinal", "finalista", "16avos"]);
  });

  it("asocia instancias por nombre y, si no, por orden", () => {
    const stages = [
      { id: 1, label: "Campeón", rank: 1, points: 100, maxTeams: 1 },
      { id: 2, label: "Subcampeón", rank: 2, points: 70, maxTeams: 1 },
      { id: 3, label: "Semifinal", rank: 3, points: 50, maxTeams: 2 },
      { id: 4, label: "Cuartos de final", rank: 4, points: 30, maxTeams: 4 },
    ];
    const map = mapStagesToTournament(["campeon", "finalista", "semifinal", "cuartos", "octavos"], stages);
    expect(map.get("campeon")!.id).toBe(1);
    expect(map.get("finalista")!.id).toBe(2);
    expect(map.get("cuartos")!.id).toBe(4);
    expect(map.get("octavos")).toBeNull(); // no existe: el organizador debe elegir
  });
});

describe("cuadro manual", () => {
  it("arma un cuadro vacío y completa las rondas con los ganadores", async () => {
    const { emptyDraft, fillNextRounds } = await import("../src/ocr/bracket");
    let d = emptyDraft(4);
    expect(d.rounds.map((r) => r.key)).toEqual(["semifinal", "finalista"]);
    expect(d.matches).toHaveLength(3);
    const set = (i: number, a: string, sa: number, b: string, sb: number) => {
      d.matches[i]!.sides[0]!.text = a; d.matches[i]!.sides[0]!.score = sa;
      d.matches[i]!.sides[1]!.text = b; d.matches[i]!.sides[1]!.score = sb;
    };
    set(0, "ANA PAZ - LUZ SOL", 6, "EVA RIOS - MIA LUNA", 3);
    set(1, "ROSA DIAZ - FLOR GIL", 2, "SARA MAS - LIA VERA", 6);
    d = fillNextRounds(d);
    expect(d.matches[2]!.sides.map((s) => s.text)).toEqual(["ANA PAZ - LUZ SOL", "SARA MAS - LIA VERA"]);
    // Sin resultado en la final, no hay campeón.
    expect(interpret(d).champion).toBeNull();
    d.matches[2]!.sides[1]!.score = 6;
    d.matches[2]!.sides[0]!.score = 4;
    const r = interpret(d);
    expect(r.teams.find((t) => t.key === r.champion)!.text).toBe("SARA MAS - LIA VERA");
    expect(r.teams.find((t) => /EVA RIOS/.test(t.text))!.stage).toBe("semifinal");
  });

  it("no completa una ronda si falta el ganador", async () => {
    const { emptyDraft, fillNextRounds } = await import("../src/ocr/bracket");
    const d = emptyDraft(4);
    d.matches[0]!.sides[0]!.text = "A UNO - B DOS";
    d.matches[0]!.sides[1]!.text = "C TRES - D CUATRO";
    expect(fillNextRounds(d).matches[2]!.sides[0]!.text).toBe("");
  });
});

describe("rondas faltantes", () => {
  it("identifica las rondas por cantidad de partidos y detecta que falta la final", async () => {
    const { addFinalRound, fillNextRounds } = await import("../src/ocr/bracket");
    const raw = clone(fixture);
    raw.blocks = raw.blocks.filter((b) => b.column !== 3); // la final quedó fuera del recorte
    raw.blocks.forEach((b) => { if (b.column === 2) b.headerText = "SERAN"; }); // encabezado ilegible
    const d = draftFromRaw(raw);
    expect(d.rounds.map((r) => r.key)).toEqual(["octavos", "cuartos", "semifinal"]);
    const r = interpret(d);
    expect(r.champion).toBeNull();
    expect(r.issues.some((i) => i.level === "error" && /No se encontró la final/.test(i.message))).toBe(true);
    // Nunca se propone un campeón equivocado: los semifinalistas perdedores sí quedan definidos.
    expect(r.teams.find((t) => /HARRIEGUE/.test(t.text))!.stage).toBe("semifinal");
    expect(r.teams.find((t) => /SALAS/.test(t.text))!.stage).toBeNull();
    // El organizador agrega la final, se completa con los ganadores y elige el resultado.
    const withFinal = fillNextRounds(addFinalRound(d));
    expect(withFinal.matches.at(-1)!.sides.map((s) => s.text)).toEqual(["LEO MOSQUERA - TIMO MOSQUERA", "NICOLAS SALAS - MILTON AHUMADA"]);
    withFinal.matches.at(-1)!.winnerOverride = 1;
    expect(stageOf(withFinal, /SALAS/)).toBe("campeon");
  });

  it("usa los encabezados cuando el cuadro no es estándar", async () => {
    const { roundKeys } = await import("../src/ocr/bracket");
    expect(roundKeys([3, 2, 1], ["cuartos", "semifinal", "finalista"])).toEqual(["cuartos", "semifinal", "finalista"]);
    expect(roundKeys([3, 2, 1], [null, null, null])).toEqual(["cuartos", "semifinal", "finalista"]);
    expect(roundKeys([8, 4, 2], [null, null, null])).toEqual(["octavos", "cuartos", "semifinal"]);
  });
});
