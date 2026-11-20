import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Pencil, Plus, Trash2 } from "lucide-react";
import { scoringTemplateSchema } from "@shared/schemas";
import { TOURNAMENT_TYPE_LABEL, type TournamentType } from "@shared/constants";
import type { ScoringTemplate } from "@shared/types";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { plural } from "@/lib/format";
import { keys, useTemplates } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { Checkbox, FormError, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { StagesEditor, newStageKey, stagesPayload, toStageDrafts, type RulesDraft, type StageDraft } from "@/components/forms/StagesEditor";

const DEFAULT_STAGES: StageDraft[] = [
  ["Campeón", "100", "1"], ["Finalista", "70", "1"], ["Semifinal", "50", "2"], ["Cuartos de final", "30", "4"], ["Fase de grupos", "5", ""],
].map(([label, points, maxTeams]) => ({ key: newStageKey(), label: label!, points: points!, maxTeams: maxTeams! }));

function TemplateForm({ template, onClose }: { template: ScoringTemplate | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm({
    name: template?.name ?? "",
    description: template?.description ?? "",
    defaultForType: (template?.defaultForType ?? "") as TournamentType | "",
    active: template?.active ?? true,
  });
  const [stages, setStages] = useState<StageDraft[]>(template ? toStageDrafts(template.stages, false) : DEFAULT_STAGES);
  const [rules, setRules] = useState<RulesDraft>({
    cumulative: template?.cumulative ?? false,
    participationBonus: String(template?.participationBonus ?? 0),
    matchPlayedBonus: String(template?.matchPlayedBonus ?? 0),
    matchWonBonus: String(template?.matchWonBonus ?? 0),
  });

  const save = useMutation({
    mutationFn: (body: unknown) => (template ? api.put(`/scoring-templates/${template.id}`, body) : api.post("/scoring-templates", body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.templates });
      toast(template ? "Plantilla actualizada" : "Plantilla creada");
      onClose();
    },
    onError: form.handleApiError,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = { ...form.values, defaultForType: form.values.defaultForType || null, ...rules, stages: stagesPayload(stages) };
    const parsed = scoringTemplateSchema.safeParse(payload);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
      form.setErrors(fields);
      form.setFormError("Revisá los campos marcados");
      return;
    }
    save.mutate(parsed.data);
  }

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={template ? `Editar ${template.name}` : "Nueva plantilla de puntuación"}
      description="Los cambios aplican a los torneos nuevos. Cada torneo guarda su propia copia editable."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="template-form" loading={save.isPending}>Guardar plantilla</Button>
        </>
      }
    >
      <form id="template-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={form.formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Nombre" required value={form.values.name} onChange={(e) => form.set("name", e.target.value)} error={form.errors.name} />
          <SelectField label="Predeterminada para" value={form.values.defaultForType} onChange={(e) => form.set("defaultForType", e.target.value as TournamentType | "")}
            hint="Se aplica automáticamente a los torneos nuevos de ese tipo.">
            <option value="">Ningún tipo</option>
            <option value="largo">{TOURNAMENT_TYPE_LABEL.largo}</option>
            <option value="americano">{TOURNAMENT_TYPE_LABEL.americano}</option>
          </SelectField>
        </div>
        <TextAreaField label="Descripción" value={form.values.description} onChange={(e) => form.set("description", e.target.value)} error={form.errors.description} />
        <StagesEditor stages={stages} onChange={setStages} rules={rules} onRulesChange={setRules} errors={form.errors} />
        <Checkbox label="Plantilla activa" checked={form.values.active} onChange={(v) => form.set("active", v)} hint="Las inactivas no se ofrecen al configurar torneos." />
      </form>
    </Modal>
  );
}

export function TemplatesPage() {
  const templates = useTemplates();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<ScoringTemplate | null | "new">(null);
  const [deleting, setDeleting] = useState<ScoringTemplate | null>(null);

  return (
    <>
      <PageHeader
        title="Plantillas de puntuación"
        description="Tablas de puntos reutilizables. Al aplicarlas a un torneo se copian y se pueden ajustar sólo para ese torneo."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nueva plantilla</Button>}
      />
      {templates.isPending ? <Spinner /> : templates.isError ? <ErrorState message={templates.error.message} /> : templates.data.length === 0 ? (
        <Card><EmptyState icon={<ClipboardList className="size-6" />} title="No hay plantillas" action={<Button onClick={() => setEditing("new")}>Crear plantilla</Button>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.data.map((t) => (
            <Card key={t.id} className="flex flex-col">
              <div className="flex-1 p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-slate-900">{t.name}</h2>
                  {t.defaultForType && <Badge tone="lime">Predeterminada · {TOURNAMENT_TYPE_LABEL[t.defaultForType]}</Badge>}
                  {!t.active && <Badge>Inactiva</Badge>}
                  {t.cumulative && <Badge tone="amber">Acumulativa</Badge>}
                </div>
                {t.description && <p className="mt-1 text-sm text-slate-500">{t.description}</p>}
                <table className="mt-3 w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {t.stages.map((s) => (
                      <tr key={s.id}>
                        <td className="py-1.5 text-slate-700">{s.label}</td>
                        <td className="py-1.5 text-right text-xs text-slate-400">{s.maxTeams ? `hasta ${s.maxTeams}` : ""}</td>
                        <td className="w-20 py-1.5 text-right font-semibold tabular text-slate-900">{s.points} pts</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(t.participationBonus > 0 || t.matchPlayedBonus > 0 || t.matchWonBonus > 0) && (
                  <p className="mt-2 text-xs text-slate-500">
                    Bonificaciones: {[
                      t.participationBonus && `+${t.participationBonus} por participar`,
                      t.matchPlayedBonus && `+${t.matchPlayedBonus} por partido jugado`,
                      t.matchWonBonus && `+${t.matchWonBonus} por partido ganado`,
                    ].filter(Boolean).join(" · ")}
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-400">Usada en {plural(t.usageCount, "torneo")}</p>
              </div>
              <div className="flex gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">
                <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(t)}>Editar</Button>
                <Button size="sm" variant="ghost" className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(t)}>
                  Eliminar
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <TemplateForm template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Eliminar plantilla"
        message={`Se eliminará "${deleting?.name}". Los torneos que la usaron conservan su propia copia de la puntuación.`}
        confirmLabel="Eliminar"
        onConfirm={async () => {
          await api.delete(`/scoring-templates/${deleting!.id}`);
          void qc.invalidateQueries({ queryKey: keys.templates });
          toast("Plantilla eliminada");
        }}
      />
    </>
  );
}
