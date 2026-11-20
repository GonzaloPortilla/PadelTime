import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Crop, ImageUp, PencilLine, RotateCcw, RotateCw, ScanText, Undo2 } from "lucide-react";
import { applyAdjustments, DEFAULT_ADJUSTMENTS, loadImage, type Adjustments, type Rect } from "@/ocr/image";
import { recognizeBracket, type RawBracket } from "@/ocr/recognize";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

interface Props {
  onRecognized: (raw: RawBracket, fileName: string) => void;
  onManual: (teams: 4 | 8 | 16 | 32) => void;
  onManualLoad: () => void;
}

export function ImageStep({ onRecognized, onManual, onManualLoad }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [adj, setAdj] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  const [cropMode, setCropMode] = useState(false);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const working = useRef<HTMLCanvasElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  // Redibuja la imagen de trabajo cuando cambian los ajustes.
  useEffect(() => {
    if (!image || !canvasHost.current) return;
    working.current = null;
    const t = setTimeout(() => {
      const c = applyAdjustments(image, adj);
      c.className = "block h-auto w-full select-none";
      c.setAttribute("aria-label", "Vista previa de la imagen a reconocer");
      working.current = c;
      canvasHost.current!.replaceChildren(c);
    }, 60);
    return () => clearTimeout(t);
  }, [image, adj]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (!f.type.startsWith("image/")) {
      setError("El archivo no es una imagen. Usá una captura o foto en JPG o PNG.");
      return;
    }
    try {
      const img = await loadImage(f);
      setFile(f);
      setImage(img);
      setAdj(DEFAULT_ADJUSTMENTS);
      setSelection(null);
      setCropMode(false);
    } catch {
      setError("No se pudo abrir la imagen. Probá con otro formato (JPG o PNG).");
    }
  };

  /** Coordenadas del puntero en píxeles del canvas de trabajo. */
  const toCanvas = (e: ReactPointerEvent) => {
    const c = working.current!;
    const box = c.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * c.width, y: ((e.clientY - box.top) / box.height) * c.height };
  };

  const run = async () => {
    if (!image || !file) return;
    // Si la vista previa todavía no se dibujó (clic muy rápido), se genera ahora con los ajustes actuales.
    if (!working.current) working.current = applyAdjustments(image, adj);
    setError(null);
    setProgress({ stage: "Preparando el reconocimiento", done: 0, total: 1 });
    try {
      const raw = await recognizeBracket(working.current, (stage, done, total) => setProgress({ stage, done, total }));
      if (import.meta.env.DEV) (window as unknown as { __ptOcr?: RawBracket }).__ptOcr = raw;
      if (raw.blocks.length === 0) {
        setError("No se reconoció ningún partido en la imagen. Probá recortar sólo el cuadro, mejorar el contraste, o cargá los resultados a mano.");
        return;
      }
      onRecognized(raw, file.name);
    } catch (e) {
      console.error(e);
      setError("El reconocimiento falló en este dispositivo. Podés reintentar o continuar con la carga manual.");
    } finally {
      setProgress(null);
    }
  };

  const busy = progress !== null;
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900">Imagen del cuadro</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Subí una captura o foto del cuadro eliminatorio. El reconocimiento se hace en este dispositivo: la imagen no se envía a ningún servidor.
        </p>
        <label className={cn("mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          image ? "border-slate-200 bg-slate-50" : "border-brand-600/40 bg-brand-50/40 hover:bg-brand-50")}>
          <ImageUp className="size-7 text-brand-700" aria-hidden />
          <span className="text-sm font-medium text-slate-800">{image ? `Cambiar imagen (${file?.name})` : "Elegir imagen desde la compu o el celular"}</span>
          <span className="text-xs text-slate-500">PNG o JPG · en el celular podés sacar una foto</span>
          <input type="file" accept="image/*" className="sr-only" aria-label="Imagen del cuadro" disabled={busy}
            onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200">{error}</p>}
      </Card>

      {image && (
        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-slate-900">Ajustes (opcional)</h2>
          <p className="mt-0.5 text-sm text-slate-500">Enderezá y recortá el cuadro si la foto lo necesita. La ampliación de cada celda se hace automáticamente.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} disabled={busy}
              onClick={() => setAdj((a) => ({ ...a, rotation: Math.round(a.rotation - 90), crop: null }))}>90°</Button>
            <Button size="sm" variant="secondary" icon={<RotateCw className="size-4" />} disabled={busy}
              onClick={() => setAdj((a) => ({ ...a, rotation: Math.round(a.rotation + 90), crop: null }))}>90°</Button>
            <Button size="sm" variant={cropMode ? "primary" : "secondary"} icon={<Crop className="size-4" />} disabled={busy}
              onClick={() => { setCropMode((m) => !m); setSelection(null); }}>
              {cropMode ? "Arrastrá sobre la imagen" : "Recortar"}
            </Button>
            {cropMode && selection && selection.w > 10 && selection.h > 10 && (
              <Button size="sm" onClick={() => {
                setAdj((a) => ({ ...a, crop: { x: (a.crop?.x ?? 0) + selection.x, y: (a.crop?.y ?? 0) + selection.y, w: selection.w, h: selection.h } }));
                setSelection(null);
                setCropMode(false);
              }}>Aplicar recorte</Button>
            )}
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} disabled={busy}
              onClick={() => { setAdj(DEFAULT_ADJUSTMENTS); setSelection(null); setCropMode(false); }}>Restablecer</Button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-600">
              Enderezar: {adj.rotation % 90 === 0 ? "0" : (adj.rotation - Math.round(adj.rotation / 90) * 90).toFixed(1)}°
              <input type="range" min={-15} max={15} step={0.5} className="mt-1 w-full accent-brand-700" disabled={busy}
                value={adj.rotation - Math.round(adj.rotation / 90) * 90}
                onChange={(e) => setAdj((a) => ({ ...a, rotation: Math.round(a.rotation / 90) * 90 + Number(e.target.value), crop: null }))} />
            </label>
            <label className="text-xs text-slate-600">
              Contraste: {adj.contrast.toFixed(1)}
              <input type="range" min={0.5} max={2.5} step={0.1} className="mt-1 w-full accent-brand-700" disabled={busy}
                value={adj.contrast} onChange={(e) => setAdj((a) => ({ ...a, contrast: Number(e.target.value) }))} />
            </label>
            <label className="text-xs text-slate-600">
              Brillo: {adj.brightness}
              <input type="range" min={-50} max={50} step={5} className="mt-1 w-full accent-brand-700" disabled={busy}
                value={adj.brightness} onChange={(e) => setAdj((a) => ({ ...a, brightness: Number(e.target.value) }))} />
            </label>
          </div>
          <div
            className={cn("relative mt-3 overflow-hidden rounded-lg ring-1 ring-slate-200", cropMode && "cursor-crosshair touch-none")}
            onPointerDown={(e) => {
              if (!cropMode || !working.current) return;
              (e.target as Element).setPointerCapture?.(e.pointerId);
              dragStart.current = toCanvas(e);
              setSelection({ ...dragStart.current, w: 0, h: 0 });
            }}
            onPointerMove={(e) => {
              if (!cropMode || !dragStart.current) return;
              const p = toCanvas(e);
              const s = dragStart.current;
              setSelection({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
            }}
            onPointerUp={() => { dragStart.current = null; }}
          >
            <div ref={canvasHost} />
            {selection && working.current && (
              <div className="pointer-events-none absolute border-2 border-brand-600 bg-brand-500/10" style={{
                left: `${(selection.x / working.current.width) * 100}%`, top: `${(selection.y / working.current.height) * 100}%`,
                width: `${(selection.w / working.current.width) * 100}%`, height: `${(selection.h / working.current.height) * 100}%`,
              }} />
            )}
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {busy ? (
              <div className="flex-1" role="status" aria-live="polite">
                <div className="mb-1 flex justify-between text-xs text-slate-600"><span>{progress.stage}…</span><span className="tabular">{pct}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} /></div>
                <p className="mt-1 text-xs text-slate-400">La primera vez se descarga el modelo de reconocimiento (≈2 MB).</p>
              </div>
            ) : (
              <p className="text-xs text-slate-500">El reconocimiento sólo propone resultados: vas a revisar y corregir todo antes de guardar.</p>
            )}
            <Button icon={<ScanText className="size-4" />} loading={busy} onClick={() => void run()}>Reconocer cuadro</Button>
          </div>
        </Card>
      )}

      <Card className="p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><PencilLine className="size-4 text-slate-400" />¿Sin imagen o no se pudo leer?</h2>
        <p className="mt-0.5 text-sm text-slate-500">Armá el cuadro a mano con la misma revisión, o cargá directamente la instancia de cada pareja.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {([4, 8, 16, 32] as const).map((n) => (
            <Button key={n} size="sm" variant="secondary" onClick={() => onManual(n)}>Cuadro de {n} parejas</Button>
          ))}
          <Button size="sm" variant="ghost" onClick={onManualLoad}>Ir a la carga manual por pareja</Button>
        </div>
      </Card>
    </div>
  );
}
