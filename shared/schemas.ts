import { z } from "zod";
import {
  CATEGORY_CHANGE_TYPES,
  MOVEMENT_KINDS,
  TIEBREAKERS,
  GENDERS,
  MIN_PASSWORD_LENGTH,
  ROLES,
  SEASON_STATUSES,
  TOURNAMENT_STATUSES,
  TOURNAMENT_TYPES,
} from "./constants";
import { isValidIsoDate } from "./text";

const trimmed = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres`);
const required = (label: string, max: number) => trimmed(max).min(1, `${label} es obligatorio`);
/** Texto opcional: cadena vacía o ausente → null. */
const optionalText = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (typeof v === "string" ? v.trim() : ""))
    .pipe(z.string().max(max, `Máximo ${max} caracteres`))
    .transform((v) => (v === "" ? null : v));

const isoDate = (label: string) =>
  z.string().refine(isValidIsoDate, { message: `${label}: fecha inválida (AAAA-MM-DD)` });
const optionalIsoDate = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isValidIsoDate(v), { message: "Fecha inválida (AAAA-MM-DD)" });

const id = z.coerce.number({ message: "Elegí una opción" }).int("Elegí una opción").positive("Elegí una opción");
const optionalId = z
  .union([z.number().int().positive(), z.string().regex(/^\d*$/, "Valor inválido")])
  .nullish()
  .transform((v) => (v === null || v === undefined || v === "" || Number(v) === 0 ? null : Number(v)));

// ─── Autenticación y usuarios ───
export const loginSchema = z.object({
  username: required("El usuario", 50),
  password: z.string().min(1, "La contraseña es obligatoria").max(200),
});

const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`)
  .max(200, "Contraseña demasiado larga");

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Ingresá tu contraseña actual"),
  newPassword: password,
});

export const userCreateSchema = z.object({
  username: required("El usuario", 50).regex(/^[a-zA-Z0-9._-]{3,50}$/, "Usuario: 3 a 50 caracteres (letras, números, . _ -)"),
  displayName: required("El nombre", 80),
  role: z.enum(ROLES),
  password,
});

export const userUpdateSchema = z.object({
  displayName: required("El nombre", 80),
  role: z.enum(ROLES),
  active: z.boolean(),
  password: z.union([password, z.literal("")]).optional().transform((v) => (v ? v : undefined)),
});

// ─── Categorías y divisiones ───
export const categorySchema = z.object({
  name: required("El nombre", 60),
  gender: z.enum(GENDERS, { message: "Elegí la rama" }),
  level: z.coerce.number().int("Nivel inválido").min(1, "El nivel mínimo es 1").max(99, "El nivel máximo es 99"),
  description: optionalText(300),
  active: z.boolean().default(true),
});

export const divisionSchema = z.object({
  name: required("El nombre", 60),
  sortOrder: z.coerce.number().int().min(1).max(99).default(1),
  active: z.boolean().default(true),
});

// ─── Jugadores ───
export const playerSchema = z.object({
  firstName: required("El nombre", 60),
  lastName: required("El apellido", 60),
  nickname: optionalText(40),
  gender: z.enum(GENDERS, { message: "Elegí la rama" }),
  mainCategoryId: id.describe("Categoría principal"),
  documentNumber: optionalText(20).refine((v) => v === null || /^[0-9A-Za-z.\-]{5,20}$/.test(v), {
    message: "Documento inválido",
  }).transform((v) => (v ? v.replace(/[.\-]/g, "") : null)),
  phone: optionalText(30),
  email: optionalText(120).refine((v) => v === null || z.email().safeParse(v).success, { message: "Email inválido" }),
  birthDate: optionalIsoDate,
  city: optionalText(60),
  notes: optionalText(1000),
  categoryChangeType: z.enum(CATEGORY_CHANGE_TYPES).optional(),
  categoryChangeReason: optionalText(300),
});

export const playerListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  gender: z.enum(GENDERS).optional(),
  categoryId: id.optional(),
  status: z.enum(["activos", "inactivos", "todos"]).default("activos"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const activeToggleSchema = z.object({ active: z.boolean() });

// ─── Temporadas ───
export const seasonSchema = z
  .object({
    name: required("El nombre", 60),
    year: z.coerce.number().int().min(2000, "Año inválido").max(2100, "Año inválido"),
    startDate: isoDate("Inicio"),
    endDate: isoDate("Fin"),
    notes: optionalText(500),
  })
  .refine((s) => s.endDate >= s.startDate, { message: "La fecha de fin debe ser posterior al inicio", path: ["endDate"] });

export const seasonStatusSchema = z.object({ status: z.enum(SEASON_STATUSES) });

// ─── Torneos ───
export const tournamentSchema = z
  .object({
    seasonId: id,
    name: required("El nombre", 100),
    type: z.enum(TOURNAMENT_TYPES, { message: "Elegí el tipo de torneo" }),
    categoryId: id,
    divisionId: optionalId,
    startDate: isoDate("Fecha"),
    endDate: optionalIsoDate,
    venue: optionalText(100),
    notes: optionalText(1000),
  })
  .transform((t) => ({ ...t, endDate: t.type === "americano" || !t.endDate ? t.startDate : t.endDate }))
  .refine((t) => t.endDate >= t.startDate, { message: "La fecha de fin debe ser posterior al inicio", path: ["endDate"] });

export const tournamentStatusSchema = z.object({ status: z.enum(TOURNAMENT_STATUSES) });

export const tournamentListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  seasonId: id.optional(),
  categoryId: id.optional(),
  gender: z.enum(GENDERS).optional(),
  type: z.enum(TOURNAMENT_TYPES).optional(),
  status: z.enum(TOURNAMENT_STATUSES).optional(),
});

export type LoginInput = z.input<typeof loginSchema>;
export type PlayerInput = z.input<typeof playerSchema>;
export type CategoryInput = z.input<typeof categorySchema>;
export type DivisionInput = z.input<typeof divisionSchema>;
export type SeasonInput = z.input<typeof seasonSchema>;
export type TournamentInput = z.input<typeof tournamentSchema>;
export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserUpdateInput = z.input<typeof userUpdateSchema>;

// ─── Fase 2: puntuación, parejas, acreditaciones y rankings ───
const points = z.coerce.number({ message: "Puntos inválidos" }).int("Sólo números enteros").min(0, "No puede ser negativo").max(100000, "Valor demasiado alto");
const bonus = z.coerce.number({ message: "Valor inválido" }).int("Sólo números enteros").min(0, "No puede ser negativo").max(1000, "Valor demasiado alto");

export const stageSchema = z.object({
  id: z.number().int().positive().optional(),
  label: required("El nombre de la instancia", 40),
  points,
  maxTeams: z
    .union([z.number(), z.string()])
    .nullish()
    .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 512), { message: "Cupo inválido" }),
});

/** Las instancias se ordenan de mejor a peor: la primera es el campeón. */
const stagesList = z
  .array(stageSchema)
  .min(1, "Agregá al menos una instancia")
  .max(20, "Máximo 20 instancias")
  .refine((list) => new Set(list.map((s) => s.label.toLowerCase())).size === list.length, { message: "Hay instancias con el mismo nombre" });

const scoringRules = {
  cumulative: z.boolean().default(false),
  participationBonus: bonus.default(0),
  matchPlayedBonus: bonus.default(0),
  matchWonBonus: bonus.default(0),
};

export const scoringTemplateSchema = z.object({
  name: required("El nombre", 60),
  description: optionalText(300),
  defaultForType: z.enum(TOURNAMENT_TYPES).nullish().transform((v) => v ?? null),
  active: z.boolean().default(true),
  ...scoringRules,
  stages: stagesList,
});

export const tournamentScoringSchema = z.object({
  ...scoringRules,
  rulesNotes: optionalText(500),
  stages: stagesList,
});

export const applyTemplateSchema = z.object({ templateId: id });

export const teamSchema = z
  .object({
    player1Id: id,
    player2Id: id,
    seed: z
      .union([z.number(), z.string()])
      .nullish()
      .transform((v) => (v === null || v === undefined || v === "" ? null : Number(v)))
      .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 999), { message: "Cabeza de serie inválida" }),
  })
  .refine((t) => t.player1Id !== t.player2Id, { message: "Elegí dos jugadores distintos", path: ["player2Id"] });

export const resultsSchema = z.object({
  results: z
    .array(
      z
        .object({
          teamId: id,
          stageId: z.number().int().positive().nullable(),
          matchesPlayed: z.coerce.number().int().min(0).max(100).default(0),
          matchesWon: z.coerce.number().int().min(0).max(100).default(0),
        })
        .refine((r) => r.matchesWon <= r.matchesPlayed, { message: "Los ganados no pueden superar a los jugados", path: ["matchesWon"] }),
    )
    .max(256),
});

export const confirmCreditSchema = z.object({
  previewHash: z.string().regex(/^[0-9a-f]{64}$/, "Huella inválida"),
  reason: optionalText(300),
});

export const revertCreditSchema = z.object({
  reason: required("El motivo", 300),
  cancelTournament: z.boolean().default(false),
});

export const adjustmentSchema = z.object({
  playerId: id,
  seasonId: id,
  points: z.coerce.number({ message: "Puntos inválidos" }).int("Sólo números enteros").min(-100000).max(100000).refine((v) => v !== 0, { message: "El ajuste no puede ser 0" }),
  reason: required("El motivo", 300),
});

export const annulSchema = z.object({ reason: required("El motivo", 300) });

export const tiebreakersSchema = z.object({
  tiebreakers: z
    .array(z.enum(TIEBREAKERS))
    .max(TIEBREAKERS.length)
    .refine((l) => new Set(l).size === l.length, { message: "Hay criterios repetidos" })
    .refine((l) => !(l.includes("mas_torneos") && l.includes("menos_torneos")), {
      message: "No se puede usar \"más torneos\" y \"menos torneos\" a la vez",
    }),
});

export const rankingQuerySchema = z.object({
  seasonId: id,
  categoryId: id,
  divisionId: id.optional(),
});

export const movementsQuerySchema = z.object({
  seasonId: id.optional(),
  playerId: id.optional(),
  tournamentId: id.optional(),
  kind: z.enum(MOVEMENT_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type ScoringTemplateInput = z.input<typeof scoringTemplateSchema>;
export type TournamentScoringInput = z.input<typeof tournamentScoringSchema>;

// ─── Fase 3: importación de cuadros ───
export const importSchema = z.object({
  mode: z.enum(["reemplazar", "agregar"]),
  teams: z
    .array(
      z
        .object({
          player1Id: id,
          player2Id: id,
          stageId: z.number().int().positive().nullable(),
          matchesPlayed: z.number().int().min(0).max(20).default(0),
          matchesWon: z.number().int().min(0).max(20).default(0),
        })
        .refine((t) => t.player1Id !== t.player2Id, { message: "Una pareja tiene dos veces al mismo jugador" })
        .refine((t) => t.matchesWon <= t.matchesPlayed, { message: "Ganados mayor que jugados" }),
    )
    .min(1, "No hay parejas para importar")
    .max(128),
  source: z.object({
    fileName: z.string().max(200).nullish().transform((v) => v ?? null),
    recognitionMode: z.enum(["estructura", "texto", "manual"]),
    elapsedMs: z.number().int().min(0).max(3_600_000).nullish().transform((v) => v ?? null),
    createdPlayers: z.number().int().min(0).max(512).default(0),
    correctedFields: z.number().int().min(0).max(10_000).default(0),
    warnings: z.array(z.string().max(400)).max(200).default([]),
    summary: z
      .array(
        z.object({
          ocrText: z.string().max(200),
          players: z.array(z.number().int().positive()).max(2),
          stage: z.string().max(40).nullable(),
          corrected: z.boolean(),
        }),
      )
      .max(128)
      .default([]),
  }),
});
export type ImportInput = z.input<typeof importSchema>;

// ─── Fase 4: importación de rankings existentes y publicación ───
const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "Huella inválida");
const newKey = z.string().min(1).max(60);

export const rankingImportSchema = z
  .object({
    fileName: required("El nombre del archivo", 200),
    fileHash: hex64,
    sheetNames: z.array(z.string().max(100)).max(50).default([]),
    mapping: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).default({}),
    newPlayers: z
      .array(
        z.object({
          key: newKey,
          firstName: required("El nombre", 80),
          lastName: required("El apellido", 80),
          gender: z.enum(GENDERS),
          mainCategoryId: id,
        }),
      )
      .max(3000)
      .default([]),
    rows: z
      .array(
        z
          .object({
            rowNumber: z.number().int().min(1).max(1_000_000),
            sourceName: required("El nombre de origen", 160),
            sourcePosition: z.string().max(20).nullish().transform((v) => v ?? null),
            playerId: z.number().int().positive().nullish().transform((v) => v ?? null),
            newKey: newKey.nullish().transform((v) => v ?? null),
            seasonId: id,
            categoryId: id,
            divisionId: z.number().int().positive().nullish().transform((v) => v ?? null),
            points: z.number().int("Los puntos deben ser enteros").min(-100000).max(100000).refine((v) => v !== 0, { message: "Una fila con 0 puntos no genera saldo" }),
          })
          .refine((r) => (r.playerId === null) !== (r.newKey === null), { message: "Cada fila debe vincular un jugador existente o uno nuevo" }),
      )
      .min(1, "No hay filas para importar")
      .max(3000, "Máximo 3000 filas por importación"),
    skippedRows: z.number().int().min(0).max(1_000_000).default(0),
    warnings: z.array(z.string().max(400)).max(300).default([]),
    notes: optionalText(500),
  })
  .refine((v) => new Set(v.newPlayers.map((p) => p.key)).size === v.newPlayers.length, { message: "Jugadores nuevos repetidos" });
export type RankingImportInput = z.input<typeof rankingImportSchema>;

export const revertImportSchema = z.object({ reason: required("El motivo", 300) });

export const publicationSettingsSchema = z.object({
  enabled: z.boolean(),
  showHistory: z.boolean(),
  title: required("El título", 80),
  hiddenSeasonIds: z.array(id).max(200).default([]),
});
export type PublicationSettingsInput = z.input<typeof publicationSettingsSchema>;
export type RankingImportPayload = z.output<typeof rankingImportSchema>;
