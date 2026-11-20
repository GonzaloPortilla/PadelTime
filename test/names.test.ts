import { describe, expect, it } from "vitest";
import { matchPlayer, normalizeName, scorePlayer, splitTeam, suggestNewPlayer, type DirectoryPlayer } from "@shared/names";

let id = 0;
const p = (firstName: string, lastName: string, nickname: string | null = null, active = true): DirectoryPlayer => ({
  id: ++id, code: `J-${id}`, firstName, lastName, nickname, mainCategoryId: 1, mainCategoryName: "4ta", active,
});

const directory = [
  p("Maximiliano", "Fernández"),
  p("Facundo", "Castillo"),
  p("Ezequiel", "Fontoura"),
  p("Leonardo", "Mosquera"),
  p("Timoteo", "Mosquera", "Timo"),
  p("Nicolás", "Salas"),
  p("Milton", "Ahumada"),
  p("Milton", "González"),
  p("Sergio", "Ramírez", "Checho"),
  p("Juan", "Pérez"),
  p("Juan", "Pérez", "Juancho"),
];
const find = (first: string, last: string) => directory.find((d) => d.firstName === first && d.lastName === last)!;

describe("normalización y separación", () => {
  it("normaliza acentos, mayúsculas y signos", () => {
    expect(normalizeName("  NICOLÁS  Núñez-O'Brien ")).toBe("nicolas nunez o brien");
  });

  it("separa parejas con distintos guiones y restos de bordes", () => {
    expect(splitTeam("DIEGO HARRIEGUE - MAXI FERNANDEZ")).toEqual({ players: ["DIEGO HARRIEGUE", "MAXI FERNANDEZ"], ok: true });
    expect(splitTeam("GUIDO GROSSO-GASTON ANDREASSI-").players).toEqual(["GUIDO GROSSO", "GASTON ANDREASSI"]);
    expect(splitTeam("[LEO MOSQUERA – TIMO MOSQUERA ]").players).toEqual(["LEO MOSQUERA", "TIMO MOSQUERA"]);
    expect(splitTeam("JUAN PEREZ PEDRO GOMEZ")).toEqual({ players: ["JUAN PEREZ", "PEDRO GOMEZ"], ok: false });
  });
});

describe("coincidencia con jugadores registrados", () => {
  it("vincula diminutivos y abreviaturas habituales", () => {
    for (const [ocr, first, last] of [
      ["MAXI FERNANDEZ", "Maximiliano", "Fernández"],
      ["FACU CASTILLO", "Facundo", "Castillo"],
      ["EZE FONTOURA", "Ezequiel", "Fontoura"],
      ["NICOLAS SALAS", "Nicolás", "Salas"],
    ] as const) {
      const m = matchPlayer(ocr, directory);
      expect(m.candidates[0]!.player, ocr).toBe(find(first, last));
      expect(["exacto", "probable"], ocr).toContain(m.status);
    }
  });

  it("tolera errores de OCR y espacios faltantes", () => {
    expect(matchPlayer("MILTONAHUMADA", directory).candidates[0]!.player).toBe(find("Milton", "Ahumada"));
    expect(matchPlayer("NICOLAS SA1AS", directory).candidates[0]!.player).toBe(find("Nicolás", "Salas"));
  });

  it("no confunde hermanos con el mismo apellido", () => {
    const leo = matchPlayer("LEO MOSQUERA", directory);
    const timo = matchPlayer("TIMO MOSQUERA", directory);
    expect(leo.candidates[0]!.player).toBe(find("Leonardo", "Mosquera"));
    expect(timo.candidates[0]!.player).toBe(find("Timoteo", "Mosquera"));
    expect(scorePlayer("LEO MOSQUERA", find("Timoteo", "Mosquera"))).toBeLessThan(0.84);
  });

  it("no confunde dos jugadores con el mismo nombre de pila", () => {
    expect(matchPlayer("MILTON GONZALEZ", directory).candidates[0]!.player).toBe(find("Milton", "González"));
  });

  it("marca como ambiguos a los homónimos", () => {
    const m = matchPlayer("JUAN PEREZ", directory);
    expect(m.status).toBe("ambiguo");
    expect(m.candidates.slice(0, 2).every((c) => c.player.lastName === "Pérez")).toBe(true);
  });

  it("reconoce apodos sueltos", () => {
    expect(matchPlayer("CHECHO", directory).candidates[0]!.player).toBe(find("Sergio", "Ramírez"));
  });

  it("informa desconocidos y propone nombre y apellido", () => {
    expect(matchPlayer("GONZALO CALANDRA", directory).status).toBe("desconocido");
    expect(suggestNewPlayer("GONZALO CALANDRA")).toEqual({ firstName: "Gonzalo", lastName: "Calandra", incomplete: false });
    expect(suggestNewPlayer("TOMAS DE LA FUENTE")).toEqual({ firstName: "Tomas", lastName: "De La Fuente", incomplete: false });
    expect(suggestNewPlayer("CHECHO")).toEqual({ firstName: "Checho", lastName: "", incomplete: true });
  });
});
