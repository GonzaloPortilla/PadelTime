import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { colName, safeSheetName, slug, toCsv, toXlsx } from "../shared/export";

describe("exportación CSV", () => {
  it("usa ; y BOM, escapa comillas y neutraliza fórmulas", () => {
    const csv = toCsv(["Jugador", "Puntos"], [["Pérez, Juan", 100], ['Dice "hola"; chau', -5], ["=1+1", null], ["-abc", 0]]);
    expect(csv.startsWith("﻿Jugador;Puntos\r\n")).toBe(true);
    expect(csv).toContain("Pérez, Juan;100\r\n");
    expect(csv).toContain('"Dice ""hola""; chau";-5\r\n');
    expect(csv).toContain("'=1+1;\r\n");
    expect(csv).toContain("'-abc;0\r\n");
  });
});

describe("exportación XLSX", () => {
  it("genera un paquete OOXML con hojas, encabezados y valores tipados", () => {
    const bytes = toXlsx([
      { name: "4ta Cab", title: ["Ranking 4ta", "Generado hoy"], header: ["Pos", "Jugador", "Puntos"], rows: [["1=", "Núñez & <Cía>", 120], [2, "=MAL()", 80]] },
      { name: "4ta Cab", header: ["A"], rows: [] },
    ]);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      "[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
    ]));
    const wb = strFromU8(files["xl/workbook.xml"]!);
    expect(wb).toContain('name="4ta Cab"');
    expect(wb).toContain('name="4ta Cab 2"'); // nombres de hoja únicos
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain('<c r="A4" s="1" t="inlineStr"><is><t xml:space="preserve">Pos</t></is></c>');
    expect(sheet).toContain('<c r="C5"><v>120</v></c>'); // número, no texto
    expect(sheet).toContain("Núñez &amp; &lt;Cía&gt;");
    expect(sheet).toContain("<t xml:space=\"preserve\">=MAL()</t>"); // texto, nunca fórmula
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('<pane ySplit="4" topLeftCell="A5"');
  });

  it("sanea nombres de hoja, columnas y archivos", () => {
    const used = new Set<string>();
    expect(safeSheetName("a/b:c*d?[e]", used)).toBe("a b c d  e");
    expect(safeSheetName("x".repeat(40), used)).toHaveLength(31);
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(slug("Ranking", "4ta", "Caballeros", "Temporada 2026")).toBe("ranking-4ta-caballeros-temporada-2026");
  });
});
