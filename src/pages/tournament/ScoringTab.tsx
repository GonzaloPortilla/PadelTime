import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { tournamentScoringSchema } from "@shared/schemas";
import type { Tournament } from "@shared/types";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { keys, useTemplates } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { FormError, SelectField, TextAreaField } from "@/components/ui/Field";
import { Card, ErrorState, Spinner } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { StagesEditor, stagesPayload, toStageDrafts, type RulesDraft, type StageDraft } from "@/components/forms/StagesEditor";
import { useTournamentData } from "./TeamsTab";

export function ScoringTab({ tournament }: { tournament: Tournament }) {
  const qc = useQueryClient();
  const toast = useToast();
  const templates = useTemplates();
  const { scoring, teams } = useTournamentData(tournament.id);
  const config = scoring.data?.item ?? null;
  const locked = scoring.data?.locked ?? null;

  const [stages, setStages] = useState<StageDraft[]>([]);
  const [rules, setRules] = useState<RulesDraft>({ cumulative: false, participationBonus: "0", matchPlayedBonus: "0", matchWonBonus: "0" });
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);

  useEffect(() => {
    if (!config) return;
    setStages(toStageDrafts(config.stages, true));
    setRules({
      cumulative: config.cumulative,
      participationBonus: String(config.participationBonus),
      matchPlayedBonus: String(config.matchPlayedBonus),
      matchWonBonus: String(config.matchWonBonus),
    });
    setNotes(config.rulesNotes ?? "");
    setErrors({});
    setFormError(null);
  }, [config]);

  const usedStageIds = useMemo(() => new Set((teams.data?.items ?? []).map((t) => t.stageId).filter((x): x is number => x !== null)), [teams.data]);
  const invalidate = () => void qc.invalidateQueries({ queryKey: [...keys.tournaments, tournament.id] });

  const save = useMutation({
    mutationFn: (body: unknown) => api.put(`/tournaments/${tournament.id}/scoring`, body),
    onSuccess: () => {
      invalidate();
      toast("Puntuación del torneo guardada");
    },
    onError: (e: Error & { fields?: Record<string, string> }) => {
      setErrors(e.fields ?? {});
      setFormError(e.message);
    },
  });

  const apply = async () => {
    await api.post(`/tournaments/${tournament.id}/scoring/apply-template`, { templateId: Number(templateId) });
    invalidate();
    toast("Plantilla aplicada al torneo");
    setTemplateId("");
  };

  if (scoring.isPending) return <Spinner />;
  if (scoring.isError) return <ErrorState message={scoring.error.message} />;

  const activeTemplates = (templates.data ?? []).filter((t) => t.active);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">Puntuación de este torneo</h2>
          <p className="text-xs text-slate-500">
            {config
              ? `${config.templateName ? `Basada en "${config.templateName}". ` : ""}Los cambios afectan sólo a este torneo. Última modificación: ${formatDateTime(config.updatedAt)}.`
              : "Todavía no tiene puntuación. Aplicá una plantilla para empezar."}
          </p>
        </div>
        {config ? (
          <form
            className="space-y-4 p-4 sm:p-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = tournamentScoringSchema.safeParse({ ...rules, rulesNotes: notes, stages: stagesPayload(stages) });
              if (!parsed.success) {
                const f: Record<string, string> = {};
                for (const i of parsed.error.issues) f[i.path.join(".") || "_"] ??= i.message;
                setErrors(f);
                setFormError("Revisá los campos marcados");
                return;
              }
              setErrors({});
              setFormError(null);
              save.mutate(parsed.data);
            }}
          >
            <FormError message={formError} />
            <StagesEditor stages={stages} onChange={setStages} rules={rules} onRulesChange={setRules} errors={errors} disabled={!!locked} usedStageIds={usedStageIds} />
            <TextAreaField label="Notas del reglamento" placeholder="Ej.: reglamento especial del Master — suma por fase" value={notes} disabled={!!locked}
              onChange={(e) => setNotes(e.target.value)} error={errors.rulesNotes} />
            {!locked && <Button type="submit" icon={<Save className="size-4" />} loading={save.isPending}>Guardar puntuación</Button>}
            {tournament.creditedVersion !== null && (
              <p className="text-xs text-slate-500">El torneo ya está acreditado: los cambios de puntuación se reflejan en los rankings recién al confirmar una corrección.</p>
            )}
          </form>
        ) : (
          <p className="p-5 text-sm text-slate-500">Elegí una plantilla en el panel de la derecha.</p>
        )}
      </Card>

      <Card className="h-fit">
        <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">Aplicar una plantilla</h2>
          <p className="text-xs text-slate-500">Reemplaza la puntuación del torneo por una copia de la plantilla. Las parejas conservan su instancia por orden.</p>
        </div>
        <div className="space-y-3 p-4 sm:p-5">
          <SelectField label="Plantilla" value={templateId} disabled={!!locked} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Elegir…</option>
            {activeTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
          <Button variant="secondary" disabled={!templateId || !!locked} onClick={() => (config ? setConfirmApply(true) : void apply())}>
            Aplicar plantilla
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmApply}
        onClose={() => setConfirmApply(false)}
        title="Reemplazar la puntuación"
        message="Se reemplazarán las instancias, puntos y bonificaciones de este torneo por los de la plantilla elegida."
        confirmLabel="Reemplazar"
        tone="primary"
        onConfirm={apply}
      />
    </div>
  );
}
