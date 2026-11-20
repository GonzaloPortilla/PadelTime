import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GENDER_LABEL, type Gender } from "@shared/constants";
import type { SiteSettings } from "@shared/site";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/auth/AuthContext";
import { keys, useSiteSettings } from "@/hooks/data";
import { Button } from "@/components/ui/Button";
import { Checkbox, FormError, TextField } from "@/components/ui/Field";
import { Card, CardHeader, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";

interface FormState extends Omit<SiteSettings, "mapLat" | "mapLng"> { mapLat: string; mapLng: string }

const toForm = (s: SiteSettings): FormState => ({ ...s, mapLat: s.mapLat === null ? "" : String(s.mapLat), mapLng: s.mapLng === null ? "" : String(s.mapLng) });

/** Datos de la web pública: contacto, sede, aviso destacado y ramas activas. */
export function SiteSettingsCard() {
  const { user } = useAuth();
  const site = useSiteSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  useEffect(() => { if (site.data) setForm(toForm(site.data)); }, [site.data]);
  const save = useMutation({
    mutationFn: (f: FormState) =>
      api.put<{ settings: SiteSettings }>("/site", {
        ...f,
        mapLat: f.mapLat.trim() === "" ? null : Number(f.mapLat.replace(",", ".")),
        mapLng: f.mapLng.trim() === "" ? null : Number(f.mapLng.replace(",", ".")),
      }),
    onSuccess: ({ settings }) => {
      qc.setQueryData(keys.site, settings);
      toast("Datos de la web actualizados");
    },
  });
  if (!form || !site.data) return <Card><Spinner className="py-8" /></Card>;
  const readOnly = user?.role !== "admin";
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(site.data));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v });
  const fieldErrors = save.error instanceof ApiError ? save.error.fields : {};
  const toggleGender = (g: Gender, on: boolean) => set("activeGenders", on ? [...new Set([...form.activeGenders, g])] : form.activeGenders.filter((x) => x !== g));

  return (
    <Card>
      <CardHeader title="Datos de la web" subtitle={readOnly ? "Sólo un administrador puede cambiarlos." : "Contacto, sede y aviso destacado. Los cambios se ven en la web de inmediato."} />
      <fieldset disabled={readOnly} className="space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
        <TextField label="Frase de presentación" value={form.tagline} maxLength={120} onChange={(e) => set("tagline", e.target.value)} error={fieldErrors.tagline} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="WhatsApp" inputMode="tel" placeholder="5491112345678" value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)}
            hint="Con código de país, sin espacios. Lo usan los botones de inscripción y contacto." error={fieldErrors.whatsapp} />
          <TextField label="Instagram" placeholder="usuario" value={form.instagram} onChange={(e) => set("instagram", e.target.value)} error={fieldErrors.instagram} />
        </div>
        <TextField label="Mensaje inicial de WhatsApp" value={form.whatsappMessage} maxLength={300} onChange={(e) => set("whatsappMessage", e.target.value)}
          hint="Texto que aparece escrito al tocar el botón general de WhatsApp." error={fieldErrors.whatsappMessage} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Sede" value={form.venueName} maxLength={120} onChange={(e) => set("venueName", e.target.value)} error={fieldErrors.venueName} />
          <TextField label="Dirección" value={form.address} maxLength={200} onChange={(e) => set("address", e.target.value)} error={fieldErrors.address} />
          <TextField label="Latitud (mapa)" inputMode="decimal" value={form.mapLat} onChange={(e) => set("mapLat", e.target.value)} error={fieldErrors.mapLat} />
          <TextField label="Longitud (mapa)" inputMode="decimal" value={form.mapLng} onChange={(e) => set("mapLng", e.target.value)} error={fieldErrors.mapLng} />
        </div>
        <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
          <p className="text-sm font-semibold text-slate-800">Aviso destacado</p>
          <p className="mb-3 text-xs text-slate-500">Franja verde arriba de todas las páginas (por ejemplo, el próximo torneo). Vacío = no se muestra.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Texto" value={form.announcementText} maxLength={200} onChange={(e) => set("announcementText", e.target.value)} error={fieldErrors.announcementText} />
            <TextField label="Enlace (opcional)" placeholder="/torneos o https://…" value={form.announcementUrl} onChange={(e) => set("announcementUrl", e.target.value)} error={fieldErrors.announcementUrl} />
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">Ramas activas</p>
          <p className="mb-2 text-xs text-slate-500">Una rama inactiva no se muestra en la web ni se ofrece al crear categorías, jugadores o torneos. Sus datos históricos se conservan.</p>
          <div className="flex flex-wrap gap-4">
            {(["M", "F"] as const).map((g) => (
              <Checkbox key={g} label={GENDER_LABEL[g]} checked={form.activeGenders.includes(g)} onChange={(v) => toggleGender(g, v)} />
            ))}
          </div>
        </div>
        <FormError message={save.error?.message ?? null} />
        {!readOnly && <Button loading={save.isPending} disabled={!dirty || form.activeGenders.length === 0} onClick={() => save.mutate(form)}>Guardar datos de la web</Button>}
      </fieldset>
    </Card>
  );
}
