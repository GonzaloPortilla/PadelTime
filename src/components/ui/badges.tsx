import {
  GENDER_LABEL,
  SEASON_STATUS_LABEL,
  TOURNAMENT_STATUS_LABEL,
  TOURNAMENT_TYPE_LABEL,
  type Gender,
  type SeasonStatus,
  type TournamentStatus,
  type TournamentType,
} from "@shared/constants";
import { Badge } from "./misc";

export const GenderBadge = ({ gender }: { gender: Gender }) => (
  <Badge tone={gender === "M" ? "sky" : "pink"}>{GENDER_LABEL[gender]}</Badge>
);

export const TournamentStatusBadge = ({ status }: { status: TournamentStatus }) => {
  const tone = { programado: "blue", en_curso: "lime", finalizado: "green", cancelado: "gray" } as const;
  return <Badge tone={tone[status]}>{status === "en_curso" && <span className="size-1.5 animate-pulse rounded-full bg-ink-900" />}{TOURNAMENT_STATUS_LABEL[status]}</Badge>;
};

export const TournamentTypeBadge = ({ type }: { type: TournamentType }) => (
  <Badge tone={type === "largo" ? "amber" : "gray"}>{TOURNAMENT_TYPE_LABEL[type]}</Badge>
);

export const SeasonStatusBadge = ({ status }: { status: SeasonStatus }) => {
  const tone = { planificada: "blue", activa: "lime", cerrada: "gray" } as const;
  return <Badge tone={tone[status]}>{SEASON_STATUS_LABEL[status]}</Badge>;
};

export const ActiveBadge = ({ active }: { active: boolean }) =>
  active ? <Badge tone="green">Activo</Badge> : <Badge tone="gray">Inactivo</Badge>;
