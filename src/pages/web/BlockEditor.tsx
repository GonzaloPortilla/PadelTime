import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2, X } from "lucide-react";
import { SECTION_KINDS, SECTION_LABEL, type Block, type SectionKind } from "@shared/site";
import { api } from "@/lib/api";
import { Button, IconButton } from "@/components/ui/Button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import { MediaField, MediaPicker, useMedia } from "./media";

type BlockType = Block["type"];

const LABEL: Record<BlockType, string> = {
  heading: "Título", paragraph: "Texto", list: "Lista", steps: "Pasos numerados", callout: "Aviso destacado", button: "Botón",
  document: "Documento (PDF)", image: "Imagen", gallery: "Galería de fotos", hero: "Banner principal", section: "Sección automática",
};

const CONTENT_TYPES: BlockType[] = ["heading", "paragraph", "list", "steps", "callout", "button", "document", "image", "gallery"];

function newBlock(type: BlockType, kind?: SectionKind): Block {
  switch (type) {
    case "heading": return { type, text: "Nuevo título" };
    case "paragraph": return { type, text: "Escribí el texto acá." };
    case "list": return { type, items: ["Primer ítem"] };
    case "steps": return { type, items: [{ title: "Paso", text: "Descripción" }] };
    case "callout": return { type, text: "Aviso importante." };
    case "button": return { type, label: "Inscribite", url: "whatsapp" };
    case "document": return { type, label: "Descargar reglamento (PDF)", url: "/reglamentos" };
    case "image": return { type, mediaId: "00000000-0000-0000-0000-000000000000" };
    case "gallery": return { type, mediaIds: [] as unknown as [string] };
    case "hero": return { type, title: "Padel Time", subtitle: "", mediaId: null, buttons: [] };
    case "section": return { type, kind: kind ?? "upcoming", title: SECTION_LABEL[kind ?? "upcoming"] };
  }
}

/** Ayuda de formato para los textos (se muestra debajo de cada campo de texto largo). */
const RICH_HINT = "Formato: **negrita**, *cursiva* y [texto del enlace](https://…). Dejá una línea en blanco para separar párrafos.";

function LinkField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const isWa = value === "whatsapp";
  return (
    <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
      <SelectField label={`${label}: destino`} value={isWa ? "whatsapp" : "url"} onChange={(e) => onChange(e.target.value === "whatsapp" ? "whatsapp" : "/torneos")}>
        <option value="whatsapp">WhatsApp de Padel Time</option>
        <option value="url">Página o enlace</option>
      </SelectField>
      {isWa ? <p className="self-end pb-2 text-xs text-slate-500">Usa el número y el mensaje de "Datos de la web".</p>
        : <TextField label={`${label}: dirección`} value={value} placeholder="/torneos o https://…" onChange={(e) => onChange(e.target.value)} hint="Una página de la web (/torneos, /reglamentos…) o un enlace https://" />}
    </div>
  );
}

function TournamentSelect({ value, onChange }: { value: number | null | undefined; onChange: (v: number | null) => void }) {
  const q = useQuery({ queryKey: ["cms", "tournament-options"], queryFn: async () => (await api.get<{ items: { id: number; name: string; startDate: string }[] }>("/cms/tournament-options")).items });
  return (
    <SelectField label="Torneo" value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      hint="Automático: el próximo torneo publicado marcado como destacado (o el próximo). Los torneos se publican desde su ficha.">
      <option value="">Automático</option>
      {(q.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.startDate.split("-").reverse().join("/")})</option>)}
    </SelectField>
  );
}

function GalleryField({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const media = useMedia();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">Fotos ({value.length})</p>
      <ul className="mb-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
        {value.map((id, i) => {
          const m = media.data?.find((x) => x.id === id);
          return (
            <li key={id} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
              {m && <img src={m.url} alt="" className="size-full object-cover" />}
              <button type="button" aria-label="Quitar foto" onClick={() => onChange(value.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white"><X className="size-3.5" /></button>
            </li>
          );
        })}
      </ul>
      <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Agregar fotos</Button>
      <MediaPicker open={open} onClose={() => setOpen(false)} kind="imagen" multiple onPick={(items) => onChange([...new Set([...value, ...items.map((i) => i.id)])])} />
    </div>
  );
}

function BlockFields({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  const set = (patch: Partial<Block>) => onChange({ ...block, ...patch } as Block);
  switch (block.type) {
    case "heading":
      return <TextField label="Texto del título" value={block.text} maxLength={160} onChange={(e) => set({ text: e.target.value })} />;
    case "paragraph":
      return <TextAreaField label="Texto" rows={5} value={block.text} maxLength={4000} onChange={(e) => set({ text: e.target.value })} hint={RICH_HINT} />;
    case "callout":
      return <TextAreaField label="Texto del aviso" rows={3} value={block.text} maxLength={1000} onChange={(e) => set({ text: e.target.value })} hint={RICH_HINT} />;
    case "list":
      return (
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <TextAreaField label="Ítems (uno por línea)" rows={5} value={block.items.join("\n")} onChange={(e) => set({ items: e.target.value.split("\n") })} />
          <SelectField label="Estilo" value={block.style ?? "bullets"} onChange={(e) => set({ style: e.target.value as "bullets" | "pills" })}>
            <option value="bullets">Viñetas</option>
            <option value="pills">Etiquetas</option>
          </SelectField>
        </div>
      );
    case "steps":
      return (
        <div className="space-y-3">
          {block.items.map((it, i) => (
            <div key={i} className="grid gap-2 rounded-lg bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-[200px_1fr_auto]">
              <TextField label={`Paso ${i + 1}: título`} value={it.title} maxLength={120} onChange={(e) => set({ items: block.items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
              <TextAreaField label="Descripción" rows={2} value={it.text} maxLength={600} onChange={(e) => set({ items: block.items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              <IconButton label={`Quitar paso ${i + 1}`} disabled={block.items.length === 1} onClick={() => set({ items: block.items.filter((_, j) => j !== i) })} className="self-center"><Trash2 className="size-4" /></IconButton>
            </div>
          ))}
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => set({ items: [...block.items, { title: "Paso", text: "Descripción" }] })}>Agregar paso</Button>
        </div>
      );
    case "button":
      return (
        <div className="space-y-3">
          <TextField label="Texto del botón" value={block.label} maxLength={80} onChange={(e) => set({ label: e.target.value })} />
          <LinkField label="Botón" value={block.url} onChange={(url) => set({ url })} />
        </div>
      );
    case "document":
      return (
        <div className="space-y-3">
          <TextField label="Texto del enlace" value={block.label} maxLength={160} onChange={(e) => set({ label: e.target.value })} />
          <MediaField label="Archivo PDF" kind="documento" value={block.mediaId} allowEmpty={false}
            onChange={(id) => onChange({ type: "document", label: block.label, hidden: block.hidden, ...(id ? { mediaId: id } : { url: "/reglamentos" }) })}
            hint={block.mediaId ? undefined : "Elegí un PDF de la biblioteca (o subilo)."} />
        </div>
      );
    case "image":
      return (
        <div className="space-y-3">
          <MediaField label="Imagen" kind="imagen" value={block.mediaId.startsWith("00000000") ? null : block.mediaId} allowEmpty={false} onChange={(id) => id && set({ mediaId: id })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Texto alternativo (opcional)" value={block.alt ?? ""} maxLength={200} onChange={(e) => set({ alt: e.target.value })} hint="Si está vacío, se usa el de la biblioteca." />
            <TextField label="Epígrafe (opcional)" value={block.caption ?? ""} maxLength={300} onChange={(e) => set({ caption: e.target.value })} />
          </div>
        </div>
      );
    case "gallery":
      return (
        <div className="space-y-3">
          <GalleryField value={block.mediaIds} onChange={(ids) => set({ mediaIds: ids as [string] })} />
          <TextField label="Epígrafe (opcional)" value={block.caption ?? ""} maxLength={300} onChange={(e) => set({ caption: e.target.value })} />
        </div>
      );
    case "hero":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Título del banner" value={block.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
            <TextField label="Frase (debajo del título)" value={block.subtitle ?? ""} maxLength={160} onChange={(e) => set({ subtitle: e.target.value })} />
          </div>
          <MediaField label="Foto de fondo" kind="imagen" value={block.mediaId} onChange={(id) => set({ mediaId: id })} hint="Sin foto elegida se usa la foto actual de la web oficial. Ideal: horizontal, 1600 px o más." />
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Botones del banner</p>
            {block.buttons.map((b, i) => (
              <div key={i} className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-slate-200">
                <div className="flex items-end gap-2">
                  <TextField label={`Botón ${i + 1}: texto`} containerClassName="flex-1" value={b.label} maxLength={60} onChange={(e) => set({ buttons: block.buttons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <IconButton label={`Quitar botón ${i + 1}`} onClick={() => set({ buttons: block.buttons.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></IconButton>
                </div>
                <LinkField label={`Botón ${i + 1}`} value={b.url} onChange={(url) => set({ buttons: block.buttons.map((x, j) => (j === i ? { ...x, url } : x)) })} />
              </div>
            ))}
            {block.buttons.length < 4 && <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => set({ buttons: [...block.buttons, { label: "Ver torneos", url: "/torneos" }] })}>Agregar botón</Button>}
          </div>
        </div>
      );
    case "section":
      return (
        <div className="space-y-3">
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-inset ring-sky-200">
            Muestra automáticamente: <b>{SECTION_LABEL[block.kind]}</b>. Los datos salen de los módulos de torneos, rankings, novedades, patrocinadores y datos de la web.
          </p>
          <TextField label="Título de la sección" value={block.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
          {block.kind === "featured_tournament" && <TournamentSelect value={block.tournamentId} onChange={(v) => set({ tournamentId: v })} />}
        </div>
      );
  }
}

/** Editor de una lista de bloques: agregar, ordenar, ocultar y quitar. */
export function BlockEditor({ blocks, onChange, allowHome = false }: { blocks: Block[]; onChange: (b: Block[]) => void; allowHome?: boolean }) {
  const [adding, setAdding] = useState(false);
  const move = (i: number, d: -1 | 1) => {
    const next = [...blocks];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  const usedSections = new Set(blocks.filter((b) => b.type === "section").map((b) => (b as { kind: SectionKind }).kind));
  const add = (b: Block) => {
    onChange([...blocks, b]);
    setAdding(false);
  };
  return (
    <div className="space-y-3">
      {blocks.length === 0 && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500 ring-1 ring-inset ring-slate-200">Esta página todavía no tiene bloques. Agregá el primero.</p>}
      {blocks.map((b, i) => (
        <section key={i} className={cn("rounded-xl ring-1 ring-inset", b.hidden ? "bg-slate-100/70 ring-slate-200" : "bg-slate-50 ring-slate-200")} aria-label={`Bloque ${i + 1}: ${LABEL[b.type]}`}>
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{i + 1}. {LABEL[b.type]}{b.type === "section" ? ` · ${SECTION_LABEL[b.kind]}` : ""}</span>
            {b.hidden && <span className="rounded bg-slate-200 px-1.5 text-xs font-medium text-slate-600">Oculto</span>}
            <div className="ml-auto flex items-center gap-1">
              <IconButton label={b.hidden ? `Mostrar bloque ${i + 1}` : `Ocultar bloque ${i + 1}`} onClick={() => onChange(blocks.map((x, j) => (j === i ? ({ ...x, hidden: !x.hidden } as Block) : x)))}>{b.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</IconButton>
              <IconButton label={`Subir bloque ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-30"><ArrowUp className="size-4" /></IconButton>
              <IconButton label={`Bajar bloque ${i + 1}`} disabled={i === blocks.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-30"><ArrowDown className="size-4" /></IconButton>
              <IconButton label={`Quitar bloque ${i + 1}`} onClick={() => onChange(blocks.filter((_, j) => j !== i))}><Trash2 className="size-4" /></IconButton>
            </div>
          </div>
          <div className={cn("p-3", b.hidden && "opacity-60")}><BlockFields block={b} onChange={(nb) => onChange(blocks.map((x, j) => (j === i ? nb : x)))} /></div>
        </section>
      ))}
      {adding ? (
        <div className="rounded-xl bg-white p-3 ring-1 ring-brand-200">
          <p className="mb-2 text-sm font-semibold text-slate-800">¿Qué querés agregar?</p>
          <div className="flex flex-wrap gap-2">
            {CONTENT_TYPES.map((t) => <Button key={t} size="sm" variant="secondary" onClick={() => add(newBlock(t))}>{LABEL[t]}</Button>)}
            {allowHome && !blocks.some((b) => b.type === "hero") && <Button size="sm" variant="secondary" onClick={() => add(newBlock("hero"))}>{LABEL.hero}</Button>}
            {allowHome && SECTION_KINDS.filter((k) => !usedSections.has(k)).map((k) => <Button key={k} size="sm" variant="subtle" onClick={() => add(newBlock("section", k))}>Sección: {SECTION_LABEL[k]}</Button>)}
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Agregar bloque</Button>
      )}
    </div>
  );
}
