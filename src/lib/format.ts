const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires",
});

const asUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);

export const formatDate = (iso: string | null | undefined) => (iso ? dateFmt.format(asUtc(iso)) : "—");
export const formatShortDate = (iso: string) => shortFmt.format(asUtc(iso)).replace(/\./g, "");
export const formatLongDate = (iso: string) => capitalize(longFmt.format(asUtc(iso)));
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const weekdayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });
/** Partes de una fecha para "cajitas" de calendario: { weekday: "sáb", day: "19", month: "dic" }. */
export function dateParts(iso: string) {
  const d = asUtc(iso);
  return {
    weekday: weekdayFmt.format(d).replace(/[.,]/g, ""),
    day: String(d.getUTCDate()),
    month: monthFmt.format(d).replace(/[.,]/g, ""),
  };
}
export const formatDayMonth = (iso: string) => `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}`;
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

export function formatRange(start: string, end: string): string {
  return start === end ? formatDate(start) : `${formatDate(start)} al ${formatDate(end)}`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.round((now - Date.parse(iso)) / 1000);
  if (diff < 60) return "hace instantes";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return days === 1 ? "ayer" : `hace ${days} días`;
  return formatDateTime(iso);
}

export const fullName = (p: { firstName: string; lastName: string }) => `${p.lastName}, ${p.firstName}`;

export const plural = (n: number, singular: string, pluralForm = `${singular}s`) => `${n} ${n === 1 ? singular : pluralForm}`;
