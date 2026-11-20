import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowDown, ArrowUp, Pencil, Power, UserPlus, Repeat } from "lucide-react";
import { CATEGORY_CHANGE_LABEL, GENDER_LABEL } from "@shared/constants";
import type { CategoryChange, Player, PlayerDetail } from "@shared/types";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { keys } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, ErrorState, Spinner } from "@/components/ui/misc";
import { ActiveBadge, GenderBadge } from "@/components/ui/badges";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PlayerForm } from "@/components/forms/PlayerForm";
import { useToast } from "@/components/ui/Toast";
import { PlayerPointsCard } from "@/components/PlayerPointsCard";

function HistoryIcon({ type }: { type: CategoryChange["changeType"] }) {
  const map = {
    alta: { icon: UserPlus, cls: "bg-brand-50 text-brand-700" },
    ascenso: { icon: ArrowUp, cls: "bg-ball-300/60 text-ink-900" },
    descenso: { icon: ArrowDown, cls: "bg-amber-50 text-amber-700" },
    manual: { icon: Repeat, cls: "bg-slate-100 text-slate-600" },
  }[type];
  const Icon = map.icon;
  return <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${map.cls}`}><Icon className="size-4" /></div>;
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value || "—"}</dd>
    </div>
  );
}

export function PlayerDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const query = useQuery({
    queryKey: [...keys.players, "detail", id],
    queryFn: async () => (await api.get<{ item: PlayerDetail }>(`/players/${id}`)).item,
  });
  const toggle = useMutation({
    mutationFn: (active: boolean) => api.patch<{ item: Player }>(`/players/${id}/active`, { active }),
    onSuccess: ({ item }) => {
      void qc.invalidateQueries({ queryKey: keys.players });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
      void qc.invalidateQueries({ queryKey: keys.categories });
      toast(item.active ? "Jugador reactivado" : "Jugador desactivado");
    },
  });

  if (query.isPending) return <Spinner />;
  if (query.isError) return <ErrorState message={query.error.message} />;
  const p = query.data;

  return (
    <>
      <Link to="/jugadores" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft className="size-4" /> Jugadores
      </Link>

      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-ink-950 text-lg font-bold text-ball-400">
            {p.firstName[0]}{p.lastName[0]}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{p.firstName} {p.lastName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{p.code}</span>
              {p.nickname && <span>“{p.nickname}”</span>}
              <GenderBadge gender={p.gender} />
              <ActiveBadge active={p.active} />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar</Button>
          <Button
            variant={p.active ? "ghost" : "subtle"}
            icon={<Power className="size-4" />}
            onClick={() => (p.active ? setConfirming(true) : toggle.mutate(true))}
            loading={toggle.isPending}
          >
            {p.active ? "Desactivar" : "Reactivar"}
          </Button>
        </div>
      </div>
      {toggle.isError && <ErrorState message={toggle.error.message} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Datos del jugador" />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 p-4 sm:grid-cols-3 sm:p-5">
            <Info label="Categoría principal" value={<span className="font-semibold">{p.mainCategoryName} {GENDER_LABEL[p.gender]}</span>} />
            <Info label="DNI" value={p.documentNumber} />
            <Info label="Fecha de nacimiento" value={p.birthDate ? formatDate(p.birthDate) : null} />
            <Info label="Teléfono" value={p.phone ? <a href={`tel:${p.phone}`} className="text-brand-700 hover:underline">{p.phone}</a> : null} />
            <Info label="Email" value={p.email ? <a href={`mailto:${p.email}`} className="break-all text-brand-700 hover:underline">{p.email}</a> : null} />
            <Info label="Localidad" value={p.city} />
            <div className="col-span-2 sm:col-span-3"><Info label="Notas" value={p.notes && <span className="whitespace-pre-line">{p.notes}</span>} /></div>
            <div className="col-span-2 border-t border-slate-100 pt-3 text-xs text-slate-400 sm:col-span-3">
              Alta: {formatDateTime(p.createdAt)} · Última modificación: {formatDateTime(p.updatedAt)}
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Historial de categoría" subtitle="Altas, ascensos, descensos y cambios" />
          <ol className="space-y-4 p-4 sm:p-5">
            {p.categoryHistory.map((h) => (
              <li key={h.id} className="flex gap-3">
                <HistoryIcon type={h.changeType} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {CATEGORY_CHANGE_LABEL[h.changeType]}: {h.fromCategoryName ? `${h.fromCategoryName} → ` : ""}{h.toCategoryName}
                  </p>
                  <p className="text-xs text-slate-500">{formatDate(h.effectiveDate)}{h.createdByName ? ` · ${h.createdByName}` : ""}</p>
                  {h.reason && <p className="mt-0.5 text-xs italic text-slate-600">{h.reason}</p>}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <PlayerPointsCard player={p} />

      {editing && <PlayerForm player={p} onClose={() => setEditing(false)} onSaved={() => void query.refetch()} />}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Desactivar jugador"
        message={`${p.firstName} ${p.lastName} dejará de aparecer en los listados y búsquedas por defecto. Su historial se conserva y podés reactivarlo cuando quieras.`}
        confirmLabel="Desactivar"
        onConfirm={() => toggle.mutateAsync(false)}
      />
    </>
  );
}
