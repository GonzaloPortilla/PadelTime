import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { decodeText, detectDelimiter, parseCsv, readSpreadsheet, readXlsx, SpreadsheetError, columnIndex } from "../src/rankingImport/parse";
import {
  defaultMapping, detectHeaderRow, inferColumns, suggestValueMaps as _svm, duplicateAssignments, extractRows, groupPlayers, indexDirectory, initialResolution, levelFromText,
  parsePoints, resolveRows, similarNamePairs, suggestCategory, suggestColumns, suggestSeason, suggestValueMaps, toFirstLast,
  type CategoryOption, type FinalRow, type Mapping,
} from "../src/rankingImport/mapping";
import { toXlsx } from "../shared/export";
import { rankingSheet } from "../shared/rankingExport";
import type { DirectoryPlayer } from "../shared/names";

const CATS: CategoryOption[] = [
  { id: 1, name: "5ta", gender: "M", level: 5, active: true },
  { id: 2, name: "6ta", gender: "M", level: 6, active: true },
  { id: 3, name: "7ma", gender: "M", level: 7, active: true },
  { id: 4, name: "6ta", gender: "F", level: 6, active: true },
];
const SEASONS = [{ id: 10, name: "Temporada 2025", year: 2025 }, { id: 11, name: "Temporada 2026", year: 2026 }];

const dir = (id: number, firstName: string, lastName: string, nickname: string | null = null): DirectoryPlayer =>
  ({ id, code: `J-${String(id).padStart(5, "0")}`, firstName, lastName, nickname, mainCategoryId: 2, mainCategoryName: "6ta", active: true });

describe("lectura de CSV", () => {
  it("detecta separador ; , y tabulación, con comillas y saltos de línea", () => {
    expect(detectDelimiter("Jugador;Puntos\nA;1\nB;2")).toBe(";");
    expect(detectDelimiter("Jugador,Puntos\nA,1\nB,2")).toBe(",");
    expect(detectDelimiter("Jugador\tPuntos\nA\t1")).toBe("\t");
    // Una coma decimal dentro de comillas no confunde la detección.
    expect(detectDelimiter('Jugador;Puntos\n"Pérez, Juan";1\n"Gómez, Ana";2')).toBe(";");
    expect(parseCsv('a;"b ""c"" d";"línea\nnueva"\r\n1;2;3')).toEqual([["a", 'b "c" d', "línea\nnueva"], ["1", "2", "3"]]);
  });

  it("decodifica UTF-8 con BOM y cae a Windows-1252 (CSV de Excel en Windows)", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8("Pérez")]))).toBe("Pérez");
    expect(decodeText(new Uint8Array([0x50, 0xe9, 0x72, 0x65, 0x7a]))).toBe("Pérez");
  });

  it("quita el apóstrofo de neutralización de fórmulas al reimportar", () => {
    expect(parseCsv("'-5;'=SUMA")[0]).toEqual(["-5", "=SUMA"]);
  });

  it("rechaza .xls binario con un mensaje claro", () => {
    expect(() => readSpreadsheet("viejo.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow(SpreadsheetError);
    expect(() => readSpreadsheet("viejo.xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow(/guardalo como \.xlsx o \.csv/);
  });
});

/** XLSX "como el de Excel": cadenas compartidas, texto enriquecido, celdas salteadas y una hoja oculta. */
function excelLike(): Uint8Array {
  const sst = ["Pos", "Jugador", "Puntos", "PÉREZ, Juan", "Gómez Martín", "Categoría", "C6"];
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>Ranking Caballeros 2026 &amp; más</t></is></c></row>
    <row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" t="s"><v>1</v></c><c r="C3" t="s"><v>5</v></c><c r="E3" t="s"><v>2</v></c></row>
    <row r="4"><c r="A4"><v>1</v></c><c r="B4" t="s"><v>3</v></c><c r="C4" t="s"><v>6</v></c><c r="E4"><v>1250</v></c></row>
    <row r="5"><c r="A5"><v>2</v></c><c r="B5" t="s"><v>4</v></c><c r="C5" t="s"><v>6</v></c><c r="E5" t="str"><v>980</v></c></row>
  </sheetData></worksheet>`;
  const sstXml = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sst.map((s, i) => (i === 3 ? `<si><r><rPr><b/></rPr><t>PÉREZ,</t></r><r><t xml:space="preserve"> Juan</t></r><rPh><t>x</t></rPh></si>` : `<si><t>${s}</t></si>`)).join("")}</sst>`;
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(`<workbook xmlns:r="r"><sheets><sheet name="Oculta" sheetId="2" state="hidden" r:id="rId2"/><sheet name="C6 &amp; C7" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`),
    "xl/sharedStrings.xml": strToU8(sstXml),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
    "xl/worksheets/sheet2.xml": strToU8(`<worksheet><sheetData><row r="1"><c r="A1"><v>9</v></c></row></sheetData></worksheet>`),
  });
}

describe("lectura de XLSX", () => {
  it("lee cadenas compartidas, texto enriquecido, entidades, celdas salteadas y omite hojas ocultas", () => {
    const wb = readXlsx(excelLike());
    expect(wb.sheets.map((s) => s.name)).toEqual(["C6 & C7"]);
    const rows = wb.sheets[0]!.rows;
    expect(rows[0]![0]).toBe("Ranking Caballeros 2026 & más");
    expect(rows[1]).toEqual([]);
    expect(rows[2]).toEqual(["Pos", "Jugador", "Categoría", null, "Puntos"]);
    expect(rows[3]).toEqual([1, "PÉREZ, Juan", "C6", null, 1250]);
    expect(rows[4]![4]).toBe("980");
    expect(columnIndex("AB12")).toBe(27);
  });

  it("vuelve a leer un ranking exportado por Padel Time (ida y vuelta)", () => {
    const bytes = toXlsx([rankingSheet({
      seasonName: "Temporada 2026", category: { name: "6ta", gender: "M" }, tiebreakers: [], generatedAt: "2026-11-19T10:00:00Z",
      rows: [{ position: 1, tied: false, playerId: 1, code: "J-00001", firstName: "Juan", lastName: "Pérez", nickname: null, active: true, points: 300, tournaments: 2, titles: 1, finals: 1, semifinals: 1, bestTournament: 200, matchesWon: 5, adjustments: 0, initialBalance: 100 }],
    })]);
    const wb = readSpreadsheet("ranking.xlsx", bytes);
    const m = defaultMapping(wb);
    expect(m.headerRow).toBe(4); // tres filas de título + una vacía
    expect(m.columns.name).toBe(1);
    expect(m.columns.points).toBe(5);
    expect(m.columns.position).toBe(0);
    m.categoryFixed = 2; m.seasonFixed = 11;
    const { rows } = extractRows(wb, m);
    expect(rows).toEqual([expect.objectContaining({ name: "Pérez, Juan", matchName: "Juan Pérez", points: 300, positionText: "1" })]);
  });
});

describe("detección de encabezados y mapeo", () => {
  it("encuentra la fila de títulos aunque haya un título arriba", () => {
    expect(detectHeaderRow([["Ranking 2026"], [], ["#", "Jugador", "Total"], ["1", "A", "3"]])).toBe(2);
  });
  it("sugiere columnas por su título, prefiriendo el total cuando hay puntos por torneo", () => {
    expect(suggestColumns(["Pos.", "Apellido y nombre", "Categoría", "Div.", "Temporada", "Puntos"])).toEqual({ position: 0, name: 1, category: 2, division: 3, season: 4, points: 5 });
    expect(suggestColumns(["Jugador", "Puntos", "Apertura", "Clausura", "Total puntos"])).toMatchObject({ name: 0, points: 4 });
    expect(suggestColumns(["Nombre", "Apellido", "Pts"])).toEqual({ firstName: 0, lastName: 1, points: 2 });
  });
});

describe("columnas sin títulos reconocibles", () => {
  it("deduce jugador, posición y puntos por el contenido", () => {
    const rows = [
      [1, "PEREZ, JUAN", 100, 70, 170],
      [2, "Gomez Martin", 70, 50, 120],
      [3, "Facu Diaz", 30, null, 30],
      [4, "Diego Sosa", 20, 5, 25],
    ];
    expect(inferColumns(rows)).toEqual({ position: 0, name: 1, points: 4 });
  });
  it("una planilla sin fila de títulos igual queda mapeada", () => {
    const wb = { kind: "xlsx" as const, sheets: [{ name: "Ranking_Padel_Time_Caballeros_C6_2026", rows: [["RANKING C6 2026"], [1, "Juan Pérez", 300], [2, "Martín Gómez", 200], [3, "Ana Ruiz", 100]] }] };
    const m = defaultMapping(wb);
    expect(m.headerRow).toBe(0); // la fila 1 es un título suelto; los jugadores empiezan en la 2
    expect(m.columns).toMatchObject({ name: 1, points: 2 });
    m.categoryFixed = 2; m.seasonFixed = 11;
    expect(extractRows(wb, m).rows.map((r) => r.name)).toEqual(["Juan Pérez", "Martín Gómez", "Ana Ruiz"]);
    // Sin ninguna fila de título: el primer jugador también se importa.
    const bare = { kind: "csv" as const, sheets: [{ name: "x", rows: wb.sheets[0]!.rows.slice(1) }] };
    const m2 = { ...defaultMapping(bare), categoryFixed: 2, seasonFixed: 11 };
    expect(m2.headerRow).toBe(-1);
    expect(extractRows(bare, m2).rows).toHaveLength(3);
  });
  it("una sola elección por valor se aplica a todas las filas (temporada desde el nombre de la hoja)", () => {
    const wb = { kind: "xlsx" as const, sheets: [{ name: "Ranking_Padel_Time_Caballeros_C6_2026", rows: [["Jugador", "Puntos"], ["Juan Pérez", 300], ["Martín Gómez", 200], ["Ana Ruiz", 100]] }] };
    const m: Mapping = { ...defaultMapping(wb), categoryFixed: 2, seasonSource: "hoja" };
    const { rows } = extractRows(wb, m);
    // Una sugerencia previa vacía no impide la automática.
    const maps = _svm(rows, m, CATS, [], SEASONS, { category: {}, division: {}, season: { Ranking_Padel_Time_Caballeros_C6_2026: null } });
    expect(maps.season).toEqual({ Ranking_Padel_Time_Caballeros_C6_2026: 11 });
    expect(resolveRows(rows, m, maps, CATS).resolved).toHaveLength(3);
  });
});

describe("normalización de valores", () => {
  it("interpreta puntos en formato argentino y rechaza decimales sin redondear", () => {
    expect(parsePoints("1.250")).toEqual({ value: 1250, error: null });
    expect(parsePoints("1,250")).toEqual({ value: 1250, error: null });
    expect(parsePoints("320 pts")).toEqual({ value: 320, error: null });
    expect(parsePoints("+30")).toEqual({ value: 30, error: null });
    expect(parsePoints("-15")).toEqual({ value: -15, error: null });
    expect(parsePoints("80,00")).toEqual({ value: 80, error: null });
    expect(parsePoints(45)).toEqual({ value: 45, error: null });
    expect(parsePoints("12,5").error).toMatch(/decimales/);
    expect(parsePoints(12.5).error).toMatch(/entero/);
    expect(parsePoints("abc").error).toMatch(/no es un número/);
    expect(parsePoints("")).toEqual({ value: null, error: null });
    expect(parsePoints("-")).toEqual({ value: null, error: null });
  });

  it("reconoce categorías escritas de distintas formas", () => {
    for (const t of ["C6", "c6", "6ta", "6°", "Sexta", "Categoría 6", "6TA CABALLEROS", "Caballeros C6 2026"]) {
      expect(suggestCategory(t, CATS, "M"), t).toBe(2);
    }
    expect(suggestCategory("Damas 6ta", CATS, "M")).toBe(4);
    expect(suggestCategory("6ta", CATS, "F")).toBe(4);
    expect(suggestCategory("C9", CATS, "M")).toBeNull();
    expect(levelFromText("2026")).toBeNull();
  });

  it("asocia temporadas por nombre o año", () => {
    expect(suggestSeason("2025", SEASONS)).toBe(10);
    expect(suggestSeason("Temporada 2026", SEASONS)).toBe(11);
    expect(suggestSeason("rankings-2026", SEASONS)).toBe(11);
    expect(suggestSeason("2030", SEASONS)).toBeNull();
  });

  it("normaliza el orden de los nombres", () => {
    expect(toFirstLast("PÉREZ, Juan", "auto")).toEqual({ text: "Juan PÉREZ", uncertain: false });
    expect(toFirstLast("GOMEZ MARTIN", "apellido_nombre")).toEqual({ text: "MARTIN GOMEZ", uncertain: false });
    expect(toFirstLast("Martín  Gómez", "auto")).toEqual({ text: "Martín Gómez", uncertain: true });
  });
});

function csvWorkbook(text: string) {
  return readSpreadsheet("ranking.csv", strToU8(text));
}

describe("extracción de filas", () => {
  it("omite vacías, totales, encabezados repetidos, sin puntos, con 0 y con decimales, informando el motivo", () => {
    const wb = csvWorkbook([
      "Pos;Jugador;Puntos",
      "1;Pérez, Juan;300",
      ";;",
      "2;Gómez Martín;",
      "3;Díaz Facundo;0",
      "4;Ruiz Ana;12,5",
      "Pos;Jugador;Puntos",
      "Total;;300",
      "5;;100",
      "6;Sosa Diego;1.100",
    ].join("\n"));
    const m: Mapping = { ...defaultMapping(wb), categoryFixed: 2, seasonFixed: 11 };
    const { rows, skipped } = extractRows(wb, m);
    expect(rows.map((r) => [r.rowNumber, r.name, r.points])).toEqual([[2, "Pérez, Juan", 300], [10, "Sosa Diego", 1100]]);
    expect(skipped.map((s) => [s.rowNumber, s.reason])).toEqual([
      [4, "Sin puntos"],
      [5, "0 puntos (no genera saldo)"],
      [6, "“12,5” tiene decimales: los puntos deben ser enteros"],
      [7, "Encabezado repetido"],
      [8, "Fila de totales"],
      [9, "Sin nombre de jugador"],
    ]);
  });

  it("toma categoría y temporada de columnas o del nombre de cada hoja", () => {
    const wb = {
      kind: "xlsx" as const,
      sheets: [
        { name: "C6", rows: [["Jugador", "Puntos", "Año"], ["Juan Pérez", 100, 2025]] },
        { name: "7ma", rows: [["Jugador", "Puntos", "Año"], ["Ana Ruiz", 50, 2026]] },
      ],
    };
    const m: Mapping = { ...defaultMapping(wb), sheets: ["C6", "7ma"], categorySource: "hoja", seasonSource: "columna", columns: { name: 0, points: 1, season: 2 } };
    const { rows } = extractRows(wb, m);
    const maps = suggestValueMaps(rows, m, CATS, [], SEASONS);
    expect(Object.values(maps.category)).toEqual([2, 3]);
    expect(maps.season).toEqual({ "2025": 10, "2026": 11 });
    const { resolved, pending } = resolveRows(rows, m, maps, CATS);
    expect(pending).toHaveLength(0);
    expect(resolved.map((r) => [r.name, r.categoryId, r.seasonId, r.gender])).toEqual([["Juan Pérez", 2, 10, "M"], ["Ana Ruiz", 3, 11, "M"]]);
  });
});

describe("jugadores: coincidencias y duplicados", () => {
  const directory = [dir(1, "Juan", "Pérez"), dir(2, "Juan", "Pérez", "Juancho"), dir(3, "Martín", "Gómez"), dir(4, "Maximiliano", "Fernández"), dir(5, "Facundo", "Díaz")];
  const index = { M: indexDirectory(directory), F: indexDirectory([]) };

  function build(lines: string[]) {
    const wb = csvWorkbook(["Jugador;Puntos", ...lines].join("\n"));
    const m: Mapping = { ...defaultMapping(wb), categoryFixed: 2, seasonFixed: 11 };
    const { rows } = extractRows(wb, m);
    const { resolved } = resolveRows(rows, m, { category: {}, division: {}, season: {} }, CATS);
    return { m, resolved, groups: groupPlayers(resolved, index, m.nameOrder) };
  }

  it("vincula con o sin acentos, en ambos órdenes y con diminutivos; detecta homónimos y desconocidos", () => {
    const { groups, resolved } = build(["GOMEZ, MARTIN;100", "Gomez Martin;90", "Maxi Fernandez;80", "Juan Pérez;70", "Pedro Inexistente;10"]);
    const byName = Object.fromEntries(groups.map((g) => [g.name, g]));
    // "GOMEZ, MARTIN" y "Gomez Martin" son la misma persona: se agrupan.
    expect(byName["GOMEZ, MARTIN"]!.rowIds).toHaveLength(2);
    expect(byName["GOMEZ, MARTIN"]!.match.candidates[0]!.player.id).toBe(3);
    expect(byName["Maxi Fernandez"]!.match.status).toMatch(/exacto|probable/);
    expect(byName["Maxi Fernandez"]!.match.candidates[0]!.player.id).toBe(4);
    expect(byName["Juan Pérez"]!.match.status).toBe("ambiguo");
    expect(initialResolution(byName["Juan Pérez"]!, resolved)).toEqual({ kind: "pending" });
    expect(byName["Pedro Inexistente"]!.match.status).toBe("desconocido");
    expect(initialResolution(byName["Pedro Inexistente"]!, resolved)).toEqual({ kind: "new", firstName: "Pedro", lastName: "Inexistente", categoryId: 2 });
  });

  it("propone nombre y apellido correctos para nuevos en formato 'Apellido, Nombre'", () => {
    const { groups, resolved } = build(["DE LA CRUZ, Juan Ignacio;40"]);
    expect(initialResolution(groups[0]!, resolved)).toMatchObject({ kind: "new", firstName: "Juan Ignacio", lastName: "De La Cruz" });
  });

  it("detecta nombres casi iguales dentro del archivo y el mismo jugador dos veces en un ranking", () => {
    const { groups, resolved } = build(["Facundo Diaz;40", "Facundo Diaz;30", "Facunda Diaz;20"]);
    expect(similarNamePairs(groups)).toHaveLength(1);
    const finals: FinalRow[] = resolved.map((row) => {
      const group = groups.find((g) => g.rowIds.includes(row.id))!;
      return { row, group, resolution: { kind: "existing", playerId: 5 } };
    });
    const dups = duplicateAssignments(finals);
    expect(dups).toHaveLength(1);
    expect(dups[0]!.map((f) => f.row.rowNumber)).toEqual([2, 3, 4]);
  });

  it("el índice por prefijos encuentra al jugador en un padrón grande", () => {
    const big = Array.from({ length: 3000 }, (_, i) => dir(100 + i, `Nombre${i}`, `Apellido${i}`));
    big.push(dir(9, "Ezequiel", "Cardozo"));
    const idx = { M: indexDirectory(big), F: indexDirectory([]) };
    const wb = csvWorkbook("Jugador;Puntos\nEze Cardozo;10");
    const m: Mapping = { ...defaultMapping(wb), categoryFixed: 2, seasonFixed: 11 };
    const { resolved } = resolveRows(extractRows(wb, m).rows, m, { category: {}, division: {}, season: {} }, CATS);
    const t0 = Date.now();
    const [g] = groupPlayers(resolved, idx, "auto");
    expect(g!.match.candidates[0]!.player.id).toBe(9);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
