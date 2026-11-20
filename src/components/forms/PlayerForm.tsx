import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { playerSchema } from "@shared/schemas";
import { CATEGORY_CHANGE_LABEL, GENDER_LABEL, type Gender } from "@shared/constants";
import type { DuplicateCandidate, Player } from "@shared/types";
import { api, toQuery } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { keys, useCategories } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { FormError, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

interface Props {
  player: Player | null;
  onClose: () => void;
  onSaved?: (p: Player) => void;
  defaults?: { gender?: Gender; mainCategoryId?: number };
}

export function GenderToggle({ value, onChange, error }: { value: Gender | ""; onChange: (g: Gender) => void; error?: string }) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">Rama<span className="ml-0.5 text-red-500">*</span></span>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Rama">
        {(["M", "F"] as const).map((g) => (
          <button
            key={g}
            type="button"
            role="radio"
            aria-checked={value === g}
            onClick={() => onChange(g)}
            className={cn(
              "h-10 rounded-lg text-sm font-medium ring-1 ring-inset transition-colors",
              value === g
                ? g === "M" ? "bg-sky-50 text-sky-800 ring-sky-400" : "bg-pink-50 text-pink-800 ring-pink-400"
                : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50",
            )}
          >
            {GENDER_LABEL[g]}
          </button>
        ))}
      </div>
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

export function PlayerForm({ player, onClose, onSaved, defaults }: Props) {
  const qc = useQueryClient();
  const toast = useToast();
  const categories = useCategories();
  const form = useForm({
    firstName: player?.firstName ?? "",
    lastName: player?.lastName ?? "",
    nickname: player?.nickname ?? "",
    gender: (player?.gender ?? defaults?.gender ?? "") as Gender | "",
    mainCategoryId: String(player?.mainCategoryId ?? defaults?.mainCategoryId ?? ""),
    documentNumber: player?.documentNumber ?? "",
    phone: player?.phone ?? "",
    email: player?.email ?? "",
    birthDate: player?.birthDate ?? "",
    city: player?.city ?? "",
    notes: player?.notes ?? "",
    categoryChangeType: "manual",
    categoryChangeReason: "",
  });
  const v = form.values;
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);

  const categoryOptions = useMemo(
    () =>
      (categories.data ?? [])
        .filter((c) => c.gender === v.gender && (c.active || c.id === player?.mainCategoryId))
        .sort((a, b) => a.level - b.level),
    [categories.data, v.gender, player?.mainCategoryId],
  );
  const categoryChanged = !!player && String(player.mainCategoryId) !== v.mainCategoryId;

  // Advertencia de homónimos (no bloquea: pueden existir dos personas con el mismo nombre).
  useEffect(() => {
    const first = v.firstName.trim();
    const last = v.lastName.trim();
    if (first.length < 2 || last.length < 2) {
      setDuplicates([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ items: DuplicateCandidate[] }>(
          `/players/duplicates${toQuery({ firstName: first, lastName: last, excludeId: player?.id })}`,
        );
        setDuplicates(res.items);
      } catch {
        setDuplicates([]);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [v.firstName, v.lastName, player?.id]);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      player ? api.put<{ item: Player }>(`/players/${player.id}`, body) : api.post<{ item: Player }>("/players", body),
    onSuccess: ({ item }) => {
      void qc.invalidateQueries({ queryKey: keys.players });
      void qc.invalidateQueries({ queryKey: keys.dashboard });
      void qc.invalidateQueries({ queryKey: keys.categories });
      toast(player ? "Jugador actualizado" : `${item.firstName} ${item.lastName} quedó registrado con el código ${item.code}`);
      onSaved?.(item);
      onClose();
    },
    onError: form.handleApiError,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const data = form.validate(playerSchema);
    if (data) save.mutate(data);
  }

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={player ? `Editar jugador ${player.code}` : "Nuevo jugador"}
      description={player ? `${player.firstName} ${player.lastName}` : "El código interno se asigna automáticamente."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="player-form" loading={save.isPending}>{player ? "Guardar cambios" : "Crear jugador"}</Button>
        </>
      }
    >
      <form id="player-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={form.formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Nombre" required value={v.firstName} onChange={(e) => form.set("firstName", e.target.value)} error={form.errors.firstName} autoComplete="off" />
          <TextField label="Apellido" required value={v.lastName} onChange={(e) => form.set("lastName", e.target.value)} error={form.errors.lastName} autoComplete="off" />
        </div>

        {duplicates.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200" role="status">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" />Ya hay {duplicates.length === 1 ? "un jugador" : `${duplicates.length} jugadores`} con este nombre</p>
            <ul className="mt-1.5 space-y-0.5 pl-6 text-amber-800">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <span className="font-mono text-xs">{d.code}</span> · {d.firstName} {d.lastName} · {d.mainCategoryName}{!d.active && " (inactivo)"}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-amber-700">Si es otra persona, podés guardarlo igual: cada jugador tiene su propio código. Cargá el apodo o DNI para diferenciarlos.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Apodo" value={v.nickname} onChange={(e) => form.set("nickname", e.target.value)} error={form.errors.nickname} hint="Ayuda a distinguir homónimos." />
          <TextField label="DNI" inputMode="numeric" value={v.documentNumber} onChange={(e) => form.set("documentNumber", e.target.value)} error={form.errors.documentNumber} hint="Opcional. No puede repetirse." />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <GenderToggle
            value={v.gender}
            error={form.errors.gender}
            onChange={(g) => {
              form.set("gender", g);
              if (g !== v.gender) form.set("mainCategoryId", "");
            }}
          />
          <SelectField
            label="Categoría principal"
            required
            value={v.mainCategoryId}
            disabled={!v.gender}
            onChange={(e) => form.set("mainCategoryId", e.target.value)}
            error={form.errors.mainCategoryId}
            hint={!v.gender ? "Elegí primero la rama." : categories.isSuccess && categoryOptions.length === 0
              ? `No hay categorías activas de ${GENDER_LABEL[v.gender]}: creala en la sección Categorías.` : "Define el ranking donde suma puntos."}
          >
            <option value="">Elegir…</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{!c.active ? " (inactiva)" : ""}</option>
            ))}
          </SelectField>
        </div>

        {categoryChanged && (
          <div className="grid gap-4 rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200 sm:grid-cols-2">
            <SelectField label="Tipo de cambio de categoría" value={v.categoryChangeType} onChange={(e) => form.set("categoryChangeType", e.target.value)}>
              {(["manual", "ascenso", "descenso"] as const).map((t) => <option key={t} value={t}>{CATEGORY_CHANGE_LABEL[t]}</option>)}
            </SelectField>
            <TextField label="Motivo" value={v.categoryChangeReason} onChange={(e) => form.set("categoryChangeReason", e.target.value)} error={form.errors.categoryChangeReason} placeholder="Ej.: campeón del Apertura" />
            <p className="text-xs text-slate-500 sm:col-span-2">El cambio queda registrado en el historial del jugador.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Teléfono" type="tel" value={v.phone} onChange={(e) => form.set("phone", e.target.value)} error={form.errors.phone} />
          <TextField label="Email" type="email" value={v.email} onChange={(e) => form.set("email", e.target.value)} error={form.errors.email} />
          <TextField label="Fecha de nacimiento" type="date" value={v.birthDate} onChange={(e) => form.set("birthDate", e.target.value)} error={form.errors.birthDate} />
        </div>
        <TextField label="Localidad" value={v.city} onChange={(e) => form.set("city", e.target.value)} error={form.errors.city} />
        <TextAreaField label="Notas" value={v.notes} onChange={(e) => form.set("notes", e.target.value)} error={form.errors.notes} />
      </form>
    </Modal>
  );
}
