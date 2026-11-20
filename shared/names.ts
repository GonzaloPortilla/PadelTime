/**
 * Normalización de nombres y coincidencia aproximada entre textos leídos por OCR y jugadores registrados.
 * Funciones puras (se usan en el navegador y en los tests).
 */

/** minúsculas, sin acentos, sólo letras y espacios simples ("ñ" → "n"). */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Distancia de Levenshtein (inserciones, borrados y sustituciones). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Similitud 0..1 basada en Levenshtein (1 = idénticos). */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/** Similitud de dos nombres ya normalizados, tolerando espacios faltantes ("miltonahumada"). */
export function nameSimilarity(a: string, b: string): number {
  return Math.max(similarity(a, b), similarity(a.replace(/ /g, ""), b.replace(/ /g, "")));
}

/**
 * Separa el texto de una pareja ("DIEGO HARRIEGUE - MAXI FERNANDEZ") en sus dos integrantes.
 * Tolera guiones sin espacios, guiones largos y restos de bordes al final.
 */
export function splitTeam(text: string): { players: string[]; ok: boolean } {
  const clean = text.replace(/[|_*"”“[\]{}]+/g, " ").replace(/\s+/g, " ").trim().replace(/^[-–—\s]+|[-–—\s]+$/g, "");
  if (!clean) return { players: [], ok: false };
  const parts = clean.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2) return { players: parts, ok: true };
  if (parts.length > 2) {
    // Varios guiones: se usa el más centrado como separador.
    let best = 1, bestDiff = Infinity;
    for (let i = 1; i < parts.length; i++) {
      const left = parts.slice(0, i).join(" ").length;
      const right = parts.slice(i).join(" ").length;
      if (Math.abs(left - right) < bestDiff) { bestDiff = Math.abs(left - right); best = i; }
    }
    return { players: [parts.slice(0, best).join(" "), parts.slice(best).join(" ")], ok: false };
  }
  // Sin guion: si hay 4 palabras se asume "Nombre Apellido Nombre Apellido".
  const tokens = clean.split(" ");
  if (tokens.length === 4) return { players: [tokens.slice(0, 2).join(" "), tokens.slice(2).join(" ")], ok: false };
  return { players: [clean], ok: false };
}

/** Apodos y diminutivos habituales que no son simples prefijos del nombre. */
const DIMINUTIVES: Record<string, string[]> = {
  nacho: ["ignacio"], pancho: ["francisco"], paco: ["francisco"], pepe: ["jose"], lucho: ["luis"], tomi: ["tomas"],
  joaco: ["joaquin"], checho: ["sergio"], quique: ["enrique"], beto: ["alberto", "roberto"], tito: ["alberto"],
  fito: ["adolfo", "rodolfo"], toto: ["antonio"], juanchi: ["juan"], juancho: ["juan"], chino: [], negro: [],
  guille: ["guillermo"], rodri: ["rodrigo"], fran: ["francisco", "franco"], santi: ["santiago"], seba: ["sebastian"],
  mati: ["matias"], agus: ["agustin", "agustina"], cami: ["camila"], vicky: ["victoria"], flor: ["florencia"],
  caro: ["carolina"], sofi: ["sofia"], meli: ["melina"], lula: ["lucia"], pato: ["patricio", "patricia"],
  lean: ["leandro"], eze: ["ezequiel"], maxi: ["maximiliano"], facu: ["facundo"], nico: ["nicolas"], leo: ["leonardo", "leonel", "leandro"],
};

/** Similitud entre un nombre de pila leído y el registrado, considerando prefijos y diminutivos. */
export function firstNameSimilarity(ocr: string, registered: string): number {
  if (!ocr || !registered) return 0;
  if (ocr === registered) return 1;
  if (DIMINUTIVES[ocr]?.includes(registered) || DIMINUTIVES[registered]?.includes(ocr)) return 0.93;
  if (ocr.length >= 3 && registered.startsWith(ocr)) return 0.92;
  if (registered.length >= 3 && ocr.startsWith(registered)) return 0.9;
  return similarity(ocr, registered);
}

export interface DirectoryPlayer {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  mainCategoryId: number;
  mainCategoryName: string;
  active: boolean;
}

/** Puntaje 0..1 de qué tan probable es que `ocrName` corresponda a `p`. */
export function scorePlayer(ocrName: string, p: DirectoryPlayer): number {
  const o = normalizeName(ocrName);
  if (!o) return 0;
  const first = normalizeName(p.firstName);
  const last = normalizeName(p.lastName);
  const nick = p.nickname ? normalizeName(p.nickname) : "";
  const tokens = o.split(" ");
  const firstTokens = first.split(" ");
  let best = Math.max(nameSimilarity(o, `${first} ${last}`), nameSimilarity(o, `${firstTokens[0]} ${last}`));
  if (nick) best = Math.max(best, nameSimilarity(o, `${nick} ${last}`));

  if (tokens.length >= 2) {
    // Se prueban todas las divisiones "nombre(s) | apellido(s)" del texto leído.
    for (let cut = 1; cut < tokens.length; cut++) {
      const oFirst = tokens.slice(0, cut).join(" ");
      const oLast = tokens.slice(cut).join(" ");
      const lastSim = nameSimilarity(oLast, last);
      const firstSim = Math.max(
        firstNameSimilarity(oFirst, first),
        firstNameSimilarity(oFirst, firstTokens[0]!),
        nick ? firstNameSimilarity(oFirst, nick) : 0,
      );
      // El apellido pesa más: el nombre suele abreviarse ("MAXI", "FACU", "EZE").
      best = Math.max(best, 0.6 * lastSim + 0.4 * firstSim);
    }
  } else {
    // Una sola palabra (p. ej. sólo el apodo "CHECHO"): coincide por apodo; por apellido es dudoso.
    if (nick && nick === o) best = Math.max(best, 0.95);
    else if (last === o) best = Math.max(best, 0.8);
    else if (nick) best = Math.max(best, similarity(o, nick) * 0.95);
  }
  return Math.max(0, best - (p.active ? 0 : 0.02));
}

export type MatchStatus = "exacto" | "probable" | "ambiguo" | "desconocido";

export interface PlayerMatch {
  status: MatchStatus;
  candidates: { player: DirectoryPlayer; score: number }[];
}

export const MATCH_THRESHOLDS = { exact: 0.96, probable: 0.84, ambiguityMargin: 0.06 };

/**
 * Busca el jugador registrado que mejor corresponde a un nombre leído.
 * - exacto: coincidencia prácticamente segura y sin competencia cercana;
 * - probable: parecido alto (se propone, el organizador verifica);
 * - ambiguo: dos o más candidatos muy parecidos (homónimos): hay que elegir;
 * - desconocido: no hay candidatos: se propone crear un jugador (con confirmación).
 */
export function matchPlayer(ocrName: string, directory: DirectoryPlayer[]): PlayerMatch {
  const ranked = directory
    .map((player) => ({ player, score: Math.round(scorePlayer(ocrName, player) * 1000) / 1000 }))
    .filter((c) => c.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const [top, second] = ranked;
  if (!top || top.score < MATCH_THRESHOLDS.probable) return { status: "desconocido", candidates: ranked };
  if (second && second.score >= MATCH_THRESHOLDS.probable && top.score - second.score < MATCH_THRESHOLDS.ambiguityMargin) {
    return { status: "ambiguo", candidates: ranked };
  }
  return { status: top.score >= MATCH_THRESHOLDS.exact ? "exacto" : "probable", candidates: ranked };
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

/** Propuesta de nombre y apellido para crear un jugador a partir del texto leído. */
export function suggestNewPlayer(ocrName: string): { firstName: string; lastName: string; incomplete: boolean } {
  const tokens = ocrName.replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (tokens.length === 0) return { firstName: "", lastName: "", incomplete: true };
  if (tokens.length === 1) return { firstName: titleCase(tokens[0]!), lastName: "", incomplete: true };
  return { firstName: titleCase(tokens[0]!), lastName: titleCase(tokens.slice(1).join(" ")), incomplete: false };
}
