import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, Power, Shapes, Trash2, Layers } from "lucide-react";
import { categorySchema, divisionSchema } from "@shared/schemas";
import { GENDER_LABEL, type Gender } from "@shared/constants";
import type { Category, Division } from "@shared/types";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { plural } from "@/lib/format";
import { keys, useActiveGenders, useCategories } from "@/hooks/data";
import { Button, IconButton } from "@/components/ui/Button";
import { Checkbox, FormError, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { GenderToggle } from "@/components/forms/PlayerForm";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.categories });
    void qc.invalidateQueries({ queryKey: keys.dashboard });
  };
}

function CategoryForm({ category, gender, onClose }: { category: Category | null; gender: Gender; onClose: () => void }) {
  const invalidate = useInvalidate();
  const activeGenders = useActiveGenders();
  const toast = useToast();
  const form = useForm({
    name: category?.name ?? "",
    gender: (category?.gender ?? gender) as Gender | "",
    level: String(category?.level ?? ""),
    description: category?.description ?? "",
    active: category?.active ?? true,
  });
  const save = useMutation({
    mutationFn: (body: unknown) => (category ? api.put(`/categories/${category.id}`, body) : api.post("/categories", body)),
    onSuccess: () => {
      invalidate();
      toast(category ? "Categoría actualizada" : "Categoría creada");
      onClose();
    },
    onError: form.handleApiError,
  });
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const data = form.validate(categorySchema);
    if (data) save.mutate(data);
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={category ? `Editar ${category.name}` : "Nueva categoría"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="category-form" loading={save.isPending}>Guardar</Button>
        </>
      }
    >
      <form id="category-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={form.formError} />
        <GenderToggle options={category ? ["M", "F"] : activeGenders} value={form.values.gender} onChange={(g) => form.set("gender", g)} error={form.errors.gender} />
        <div className="grid grid-cols-3 gap-4">
          <TextField label="Nombre" required containerClassName="col-span-2" placeholder="Ej.: 4ta" value={form.values.name}
            onChange={(e) => form.set("name", e.target.value)} error={form.errors.name} />
          <TextField label="Nivel" required type="number" min={1} max={99} inputMode="numeric" value={form.values.level}
            onChange={(e) => form.set("level", e.target.value)} error={form.errors.level} />
        </div>
        <p className="-mt-2 text-xs text-slate-500">El nivel ordena las categorías: 1 es la más alta (p. ej. 1ra = 1, 2da = 2…).</p>
        <TextAreaField label="Descripción" value={form.values.description} onChange={(e) => form.set("description", e.target.value)} error={form.errors.description} />
        {category && <Checkbox label="Categoría activa" checked={form.values.active} onChange={(v) => form.set("active", v)} hint="Las inactivas no se ofrecen para jugadores ni torneos nuevos." />}
      </form>
    </Modal>
  );
}

function DivisionForm({ category, division, onClose }: { category: Category; division: Division | null; onClose: () => void }) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const form = useForm({
    name: division?.name ?? "",
    sortOrder: String(division?.sortOrder ?? category.divisions.length + 1),
    active: division?.active ?? true,
  });
  const save = useMutation({
    mutationFn: (body: unknown) => (division ? api.put(`/divisions/${division.id}`, body) : api.post(`/categories/${category.id}/divisions`, body)),
    onSuccess: () => {
      invalidate();
      toast(division ? "División actualizada" : "División creada");
      onClose();
    },
    onError: form.handleApiError,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/divisions/${division!.id}`),
    onSuccess: () => {
      invalidate();
      toast("División eliminada");
      onClose();
    },
    onError: form.handleApiError,
  });
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const data = form.validate(divisionSchema);
    if (data) save.mutate(data);
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={division ? `Editar división ${division.name}` : `Nueva división en ${category.name} ${GENDER_LABEL[category.gender]}`}
      description="Subdivisiones opcionales de una categoría, por ejemplo A/B u Oro/Plata."
      footer={
        <>
          {division && (
            <Button variant="ghost" className="sm:mr-auto text-red-600 hover:bg-red-50 hover:text-red-700" icon={<Trash2 className="size-4" />}
              loading={remove.isPending} onClick={() => remove.mutate()}>
              Eliminar
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="division-form" loading={save.isPending}>Guardar</Button>
        </>
      }
    >
      <form id="division-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={form.formError} />
        <div className="grid grid-cols-3 gap-4">
          <TextField label="Nombre" required containerClassName="col-span-2" placeholder="Ej.: A" value={form.values.name}
            onChange={(e) => form.set("name", e.target.value)} error={form.errors.name} />
          <TextField label="Orden" type="number" min={1} max={99} value={form.values.sortOrder}
            onChange={(e) => form.set("sortOrder", e.target.value)} error={form.errors.sortOrder} />
        </div>
        {division && <Checkbox label="División activa" checked={form.values.active} onChange={(v) => form.set("active", v)} />}
      </form>
    </Modal>
  );
}

function CategoryCard({ c, onEdit, onDivision, onToggle, onDelete }: {
  c: Category;
  onEdit: () => void;
  onDivision: (d: Division | null) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const unused = c.playerCount === 0 && c.tournamentCount === 0;
  return (
    <li className={cn("px-4 py-3 sm:px-5", !c.active && "bg-slate-50/70")}>
      <div className="flex items-start gap-3">
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold tabular", c.active ? "bg-brand-700 font-display text-white" : "bg-slate-200 text-slate-500")}>
          {c.level}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900">{c.name}</h3>
            {!c.active && <Badge>Inactiva</Badge>}
          </div>
          <p className="text-xs text-slate-500">
            <Link to={`/jugadores?categoryId=${c.id}`} className="hover:text-brand-700 hover:underline">{plural(c.playerCount, "jugador activo", "jugadores activos")}</Link>
            {" · "}{plural(c.tournamentCount, "torneo")}
          </p>
          {c.description && <p className="mt-1 text-xs text-slate-500">{c.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {c.divisions.map((d) => (
              <button key={d.id} type="button" onClick={() => onDivision(d)}
                className={cn("rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset hover:bg-slate-100", d.active ? "bg-white text-slate-700 ring-slate-300" : "bg-slate-100 text-slate-400 line-through ring-slate-200")}
                title="Editar división">
                {d.name}
              </button>
            ))}
            <button type="button" onClick={() => onDivision(null)} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
              <Plus className="size-3" /> División
            </button>
          </div>
        </div>
        <div className="relative">
          <IconButton label={`Acciones de ${c.name}`} onClick={() => setMenu((m) => !m)}><MoreHorizontal className="size-5" /></IconButton>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
                <button type="button" className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50" onClick={() => { setMenu(false); onEdit(); }}>
                  <Pencil className="size-4 text-slate-400" /> Editar
                </button>
                <button type="button" className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50" onClick={() => { setMenu(false); onToggle(); }}>
                  <Power className="size-4 text-slate-400" /> {c.active ? "Desactivar" : "Reactivar"}
                </button>
                {unused && (
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50" onClick={() => { setMenu(false); onDelete(); }}>
                    <Trash2 className="size-4" /> Eliminar
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export function CategoriesPage() {
  const categories = useCategories();
  const activeGenders = useActiveGenders();
  const invalidate = useInvalidate();
  const toast = useToast();
  const [editing, setEditing] = useState<{ category: Category | null; gender: Gender } | null>(null);
  const [division, setDivision] = useState<{ category: Category; division: Division | null } | null>(null);
  const [confirm, setConfirm] = useState<{ category: Category; action: "toggle" | "delete" } | null>(null);

  const doConfirm = async () => {
    if (!confirm) return;
    const { category, action } = confirm;
    if (action === "delete") {
      await api.delete(`/categories/${category.id}`);
      toast("Categoría eliminada");
    } else {
      await api.patch(`/categories/${category.id}/active`, { active: !category.active });
      toast(category.active ? "Categoría desactivada" : "Categoría reactivada");
    }
    invalidate();
  };

  return (
    <>
      <PageHeader
        title="Categorías y divisiones"
        description="Categorías por rama, ordenadas por nivel. Cada una puede tener divisiones opcionales."
      />
      {categories.isPending ? <Spinner /> : categories.isError ? <ErrorState message={categories.error.message} onRetry={() => void categories.refetch()} /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          {(["M", "F"] as const).map((g) => {
            const list = categories.data.filter((c) => c.gender === g);
            const discontinued = !activeGenders.includes(g);
            // Rama discontinuada (Damas): se conservan y editan sus categorías históricas, pero no se crean nuevas.
            if (discontinued && list.length === 0) return null;
            return (
              <Card key={g}>
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2.5 rounded-full", g === "M" ? "bg-sky-500" : "bg-pink-500")} />
                    <h2 className="font-semibold text-slate-900">{GENDER_LABEL[g]}</h2>
                    <span className="text-sm text-slate-400">{list.length}</span>
                    {discontinued && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Discontinuada · histórico</span>}
                  </div>
                  {!discontinued && (
                    <Button size="sm" variant="subtle" icon={<Plus className="size-4" />} onClick={() => setEditing({ category: null, gender: g })}>
                      Categoría
                    </Button>
                  )}
                </div>
                {list.length === 0 ? (
                  <EmptyState icon={g === "M" ? <Shapes className="size-6" /> : <Layers className="size-6" />} title={`Sin categorías de ${GENDER_LABEL[g].toLowerCase()}`}
                    description="Creá las categorías con las que se organizan los torneos (por ejemplo 1ra a 8va)." />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {list.map((c) => (
                      <CategoryCard
                        key={c.id}
                        c={c}
                        onEdit={() => setEditing({ category: c, gender: g })}
                        onDivision={(d) => setDivision({ category: c, division: d })}
                        onToggle={() => setConfirm({ category: c, action: "toggle" })}
                        onDelete={() => setConfirm({ category: c, action: "delete" })}
                      />
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {editing && <CategoryForm category={editing.category} gender={editing.gender} onClose={() => setEditing(null)} />}
      {division && <DivisionForm category={division.category} division={division.division} onClose={() => setDivision(null)} />}
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.action === "delete" ? "Eliminar categoría" : confirm?.category.active ? "Desactivar categoría" : "Reactivar categoría"}
        message={
          confirm?.action === "delete"
            ? `Se eliminará definitivamente ${confirm.category.name} (${GENDER_LABEL[confirm.category.gender]}) y sus divisiones.`
            : confirm?.category.active
              ? "No se ofrecerá para jugadores ni torneos nuevos. Los datos históricos se conservan."
              : "Volverá a estar disponible para jugadores y torneos."
        }
        confirmLabel={confirm?.action === "delete" ? "Eliminar" : confirm?.category.active ? "Desactivar" : "Reactivar"}
        tone={confirm?.action === "toggle" && !confirm.category.active ? "primary" : "danger"}
        onConfirm={doConfirm}
      />
    </>
  );
}
