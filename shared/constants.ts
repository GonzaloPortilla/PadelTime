export const GENDERS = ["M", "F"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABEL: Record<Gender, string> = { M: "Caballeros", F: "Damas" };

export const ROLES = ["admin", "organizador"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", organizador: "Organizador" };

export const SEASON_STATUSES = ["planificada", "activa", "cerrada"] as const;
export type SeasonStatus = (typeof SEASON_STATUSES)[number];
export const SEASON_STATUS_LABEL: Record<SeasonStatus, string> = {
  planificada: "Planificada",
  activa: "Activa",
  cerrada: "Cerrada",
};

export const TOURNAMENT_TYPES = ["largo", "americano"] as const;
export type TournamentType = (typeof TOURNAMENT_TYPES)[number];
export const TOURNAMENT_TYPE_LABEL: Record<TournamentType, string> = {
  largo: "Torneo largo",
  americano: "Americano",
};

export const TOURNAMENT_STATUSES = ["programado", "en_curso", "finalizado", "cancelado"] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];
export const TOURNAMENT_STATUS_LABEL: Record<TournamentStatus, string> = {
  programado: "Programado",
  en_curso: "En curso",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
};

/** Transiciones de estado permitidas para un torneo. */
export const TOURNAMENT_TRANSITIONS: Record<TournamentStatus, readonly TournamentStatus[]> = {
  programado: ["en_curso", "cancelado"],
  en_curso: ["finalizado", "programado", "cancelado"],
  finalizado: ["en_curso"], // reabrir para corregir
  cancelado: ["programado"], // reprogramar
};

export const CATEGORY_CHANGE_TYPES = ["alta", "manual", "ascenso", "descenso"] as const;
export type CategoryChangeType = (typeof CATEGORY_CHANGE_TYPES)[number];
export const CATEGORY_CHANGE_LABEL: Record<CategoryChangeType, string> = {
  alta: "Alta",
  manual: "Cambio manual",
  ascenso: "Ascenso",
  descenso: "Descenso",
};

export const APP_TIMEZONE = "America/Argentina/Buenos_Aires";
export const MIN_PASSWORD_LENGTH = 10;

// ─── Fase 2: puntuación y rankings ───
export const MOVEMENT_KINDS = ["acreditacion", "reversion", "ajuste", "anulacion_ajuste"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
export const MOVEMENT_KIND_LABEL: Record<MovementKind, string> = {
  acreditacion: "Acreditación",
  reversion: "Reversión",
  ajuste: "Ajuste manual",
  anulacion_ajuste: "Anulación de ajuste",
};

export const CREDIT_STATUSES = ["vigente", "reemplazada", "revertida"] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];
export const CREDIT_STATUS_LABEL: Record<CreditStatus, string> = {
  vigente: "Vigente",
  reemplazada: "Reemplazada por corrección",
  revertida: "Revertida",
};

/** Criterios de desempate disponibles (los puntos siempre se comparan primero). */
export const TIEBREAKERS = [
  "titulos",
  "finales",
  "semifinales",
  "mejor_torneo",
  "partidos_ganados",
  "mas_torneos",
  "menos_torneos",
] as const;
export type Tiebreaker = (typeof TIEBREAKERS)[number];
export const TIEBREAKER_LABEL: Record<Tiebreaker, string> = {
  titulos: "Más campeonatos",
  finales: "Más finales jugadas (campeón o finalista)",
  semifinales: "Más semifinales alcanzadas",
  mejor_torneo: "Mayor puntaje en un solo torneo",
  partidos_ganados: "Más partidos ganados",
  mas_torneos: "Más torneos jugados",
  menos_torneos: "Menos torneos jugados",
};
export const DEFAULT_TIEBREAKERS: Tiebreaker[] = ["titulos", "finales", "mejor_torneo", "menos_torneos"];
