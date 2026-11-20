import type { Issue, PreviewRow, ScoringConfig, StageConfig, DiffRow } from "./scoring";
import type {
  CreditStatus,
  MovementKind,
  Tiebreaker,
  CategoryChangeType,
  Gender,
  Role,
  SeasonStatus,
  TournamentStatus,
  TournamentType,
} from "./constants";

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

export interface User extends SessionUser {
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Division {
  id: number;
  categoryId: number;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface Category {
  id: number;
  name: string;
  gender: Gender;
  level: number;
  description: string | null;
  active: boolean;
  playerCount: number;
  tournamentCount: number;
  divisions: Division[];
}

export interface Player {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  gender: Gender;
  mainCategoryId: number;
  mainCategoryName: string;
  documentNumber: string | null;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  city: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryChange {
  id: number;
  fromCategoryName: string | null;
  toCategoryName: string;
  changeType: CategoryChangeType;
  reason: string | null;
  effectiveDate: string;
  createdByName: string | null;
}

export interface PlayerDetail extends Player {
  categoryHistory: CategoryChange[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DuplicateCandidate {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  mainCategoryName: string;
  active: boolean;
}

export interface Season {
  id: number;
  name: string;
  year: number;
  startDate: string;
  endDate: string;
  status: SeasonStatus;
  notes: string | null;
  tournamentCount: number;
  finishedCount: number;
}

export interface Tournament {
  id: number;
  seasonId: number;
  seasonName: string;
  seasonStatus: SeasonStatus;
  name: string;
  type: TournamentType;
  categoryId: number;
  categoryName: string;
  gender: Gender;
  divisionId: number | null;
  divisionName: string | null;
  startDate: string;
  endDate: string;
  status: TournamentStatus;
  venue: string | null;
  notes: string | null;
  teamCount: number;
  /** Versión de la acreditación vigente (null = sin acreditar). */
  creditedVersion: number | null;
}

export interface ActivityItem {
  id: number;
  action: string;
  entity: string;
  entityId: number | null;
  summary: string;
  userName: string | null;
  createdAt: string;
}

export interface DashboardData {
  today: string;
  players: { active: number; inactive: number; byGender: Record<Gender, number> };
  categories: { active: number; byGender: Record<Gender, number> };
  activeSeason: (Season & { progress: number }) | null;
  tournaments: { scheduled: number; inProgress: number; finished: number };
  upcoming: Tournament[];
  inProgress: Tournament[];
  playersByCategory: { categoryId: number; name: string; gender: Gender; count: number }[];
  recentActivity: ActivityItem[];
  /** Torneos finalizados que todavía no tienen sus puntos acreditados. */
  pendingCredits: Tournament[];
}

// ─── Fase 2 ───

export interface ScoringTemplate {
  id: number;
  name: string;
  description: string | null;
  defaultForType: TournamentType | null;
  active: boolean;
  cumulative: boolean;
  participationBonus: number;
  matchPlayedBonus: number;
  matchWonBonus: number;
  stages: StageConfig[];
  usageCount: number;
}

export interface TournamentScoring extends ScoringConfig {
  templateId: number | null;
  templateName: string | null;
  rulesNotes: string | null;
  updatedAt: string;
}

export interface TeamPlayer {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  mainCategoryId: number;
  mainCategoryName: string;
  active: boolean;
}

export interface Team {
  id: number;
  seed: number | null;
  stageId: number | null;
  matchesPlayed: number;
  matchesWon: number;
  players: TeamPlayer[];
}

export interface CreditSummary {
  id: number;
  version: number;
  status: CreditStatus;
  totalPoints: number;
  playerCount: number;
  teamCount: number;
  reason: string | null;
  createdAt: string;
  createdByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
  closeReason: string | null;
}

export interface TournamentPreviewResponse {
  rows: PreviewRow[];
  issues: Issue[];
  totals: { teams: number; players: number; points: number };
  canConfirm: boolean;
  previewHash: string;
  /** Acreditación vigente, si existe. */
  activeCredit: CreditSummary | null;
  /** true si los resultados actuales coinciden exactamente con lo acreditado. */
  upToDate: boolean;
  /** Diferencias contra la acreditación vigente (sólo si hay una). */
  diff: DiffRow[] | null;
  locked: boolean;
}

export interface PointMovement {
  id: number;
  kind: MovementKind;
  points: number;
  stagePoints: number;
  bonusPoints: number;
  seasonId: number;
  seasonName: string;
  categoryId: number;
  categoryName: string;
  divisionName: string | null;
  playerId: number;
  playerName: string;
  playerCode: string;
  tournamentId: number | null;
  tournamentName: string | null;
  tournamentDate: string | null;
  creditVersion: number | null;
  creditStatus: CreditStatus | null;
  partnerName: string | null;
  stageLabel: string | null;
  reason: string | null;
  reversesMovementId: number | null;
  reversedById: number | null;
  /** Importación de ranking que originó el movimiento (saldo inicial). */
  balanceImportId: number | null;
  createdAt: string;
  createdByName: string | null;
}

export interface PlayerPointsSummary {
  seasonId: number;
  seasonName: string;
  seasonStatus: SeasonStatus;
  categoryId: number;
  categoryName: string;
  points: number;
}

export interface PlayerPointsResponse {
  summary: PlayerPointsSummary[];
  movements: PointMovement[];
}

export interface RankingRow {
  position: number;
  tied: boolean;
  playerId: number;
  code: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  active: boolean;
  points: number;
  tournaments: number;
  titles: number;
  finals: number;
  semifinals: number;
  bestTournament: number;
  matchesWon: number;
  /** Ajustes manuales (sin contar saldos iniciales). */
  adjustments: number;
  /** Saldo inicial importado de rankings anteriores (Fase 4). */
  initialBalance: number;
}

export interface RankingResponse {
  season: { id: number; name: string; status: SeasonStatus };
  category: { id: number; name: string; gender: Gender };
  division: { id: number; name: string } | null;
  tiebreakers: Tiebreaker[];
  rows: RankingRow[];
  generatedAt: string;
}

// ─── Fase 3 ───
export interface DirectoryEntry {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
  gender: Gender;
  mainCategoryId: number;
  mainCategoryName: string;
  active: boolean;
}

export interface BracketImportRecord {
  id: number;
  fileName: string | null;
  recognitionMode: "estructura" | "texto" | "manual";
  importMode: "reemplazar" | "agregar";
  teamCount: number;
  createdPlayers: number;
  correctedFields: number;
  elapsedMs: number | null;
  warnings: string[];
  createdAt: string;
  createdByName: string | null;
}

// ─── Fase 4 ───
export interface RankingImportSummaryItem {
  seasonId: number;
  seasonName: string;
  categoryId: number;
  categoryName: string;
  gender: Gender;
  divisionId: number | null;
  divisionName: string | null;
  players: number;
  points: number;
  /** Puntos que ese ranking ya tenía en el sistema antes de importar. */
  existingPoints: number;
}

export interface RankingImportIssue {
  level: "error" | "warning";
  message: string;
  rowNumbers?: number[];
}

export interface RankingImportPreview {
  ok: boolean;
  issues: RankingImportIssue[];
  rankings: RankingImportSummaryItem[];
  rowCount: number;
  playerCount: number;
  newPlayerCount: number;
  totalPoints: number;
  contentHash: string;
}

export interface RankingImportRecord {
  id: number;
  fileName: string;
  sheetNames: string | null;
  status: "vigente" | "revertida";
  rowCount: number;
  playerCount: number;
  totalPoints: number;
  createdPlayers: number;
  skippedRows: number;
  rankings: RankingImportSummaryItem[];
  warnings: string[];
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  revertedAt: string | null;
  revertedByName: string | null;
  revertReason: string | null;
}

export interface RankingImportRowDetail {
  rowNumber: number;
  sourceName: string;
  sourcePosition: string | null;
  playerId: number;
  playerCode: string;
  playerName: string;
  seasonName: string;
  categoryName: string;
  divisionName: string | null;
  points: number;
  active: boolean;
}

export interface PublicationSettings {
  enabled: boolean;
  showHistory: boolean;
  title: string;
  hiddenSeasonIds: number[];
}

export interface PublicationLink {
  seasonId: number;
  categoryId: number;
  categoryName: string;
  gender: Gender;
  divisionId: number | null;
  divisionName: string | null;
  players: number;
  path: string;
}

export interface PublicationOverview {
  settings: PublicationSettings;
  seasons: { id: number; name: string; year: number; status: SeasonStatus; publicVisible: boolean }[];
  links: PublicationLink[];
  version: number;
}
