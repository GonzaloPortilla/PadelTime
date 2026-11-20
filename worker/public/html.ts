/**
 * Plantillas HTML mínimas con escape automático: todo valor interpolado se escapa salvo que
 * venga de otra plantilla `h` (clase Raw). Así ningún dato de la base puede inyectar HTML.
 */
export class Raw {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

type Value = Raw | string | number | boolean | null | undefined | Value[];

function render(v: Value): string {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  return escapeHtml(String(v));
}

export function h(strings: TemplateStringsArray, ...values: Value[]): Raw {
  let out = strings[0]!;
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1]!;
  });
  return new Raw(out);
}

export const raw = (s: string) => new Raw(s);
