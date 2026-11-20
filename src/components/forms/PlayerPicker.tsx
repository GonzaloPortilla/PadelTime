import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import type { Gender } from "@shared/constants";
import type { Paginated, Player } from "@shared/types";
import { api, toQuery } from "@/lib/api";
import { useDebounced } from "@/hooks/data";
import { cn } from "@/lib/cn";

export interface PickedPlayer {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  mainCategoryName: string;
}

interface Props {
  label: string;
  value: PickedPlayer | null;
  onChange: (p: PickedPlayer | null) => void;
  gender: Gender;
  /** Jugadores que no se pueden elegir (ya inscriptos o elegidos en el otro campo). */
  excluded: Set<number>;
  error?: string;
  onCreateNew?: (query: string) => void;
}

/** Buscador de jugadores activos de una rama, por nombre, apodo, DNI o código. */
export function PlayerPicker({ label, value, onChange, gender, excluded, error, onCreateNew }: Props) {
  const id = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const q = useDebounced(text.trim(), 250);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useQuery({
    queryKey: ["players", "picker", gender, q],
    queryFn: () => api.get<Paginated<Player>>(`/players${toQuery({ q, gender, status: "activos", pageSize: 8 })}`),
    enabled: open && q.length >= 1,
  });
  const items = results.data?.items ?? [];

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  useEffect(() => setHighlight(0), [q]);

  const pick = (p: Player) => {
    if (excluded.has(p.id)) return;
    onChange({ id: p.id, code: p.code, firstName: p.firstName, lastName: p.lastName, mainCategoryName: p.mainCategoryName });
    setText("");
    setOpen(false);
  };

  if (value) {
    return (
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
        <div className="flex h-10 items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 text-sm ring-1 ring-inset ring-brand-600/30">
          <span className="truncate">
            <span className="font-medium text-slate-900">{value.lastName}, {value.firstName}</span>
            <span className="ml-2 font-mono text-xs text-slate-500">{value.code}</span>
            <span className="ml-2 text-xs text-slate-500">{value.mainCategoryName}</span>
          </span>
          <button type="button" onClick={() => onChange(null)} aria-label={`Quitar ${value.firstName} ${value.lastName}`} className="rounded p-1 text-slate-400 hover:text-slate-700">
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          value={text}
          placeholder="Buscar por nombre, apodo, DNI o código"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, items.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
            if (e.key === "Enter" && items[highlight]) { e.preventDefault(); pick(items[highlight]); }
            if (e.key === "Escape") setOpen(false);
          }}
          className={cn(
            "block h-10 w-full rounded-lg border-0 bg-white pl-9 pr-3 text-sm shadow-sm ring-1 ring-inset placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600",
            error ? "ring-red-400" : "ring-slate-300",
          )}
        />
      </div>
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      {open && q.length >= 1 && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200">
          {results.isPending && <li className="px-3 py-2 text-slate-400">Buscando…</li>}
          {results.isSuccess && items.length === 0 && <li className="px-3 py-2 text-slate-400">Sin resultados.</li>}
          {items.map((p, i) => {
            const taken = excluded.has(p.id);
            return (
              <li
                key={p.id}
                role="option"
                aria-selected={i === highlight}
                aria-disabled={taken}
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                onMouseEnter={() => setHighlight(i)}
                className={cn("flex cursor-pointer items-center justify-between gap-2 px-3 py-2", i === highlight && !taken && "bg-brand-50", taken && "cursor-not-allowed opacity-50")}
              >
                <span className="truncate">
                  <span className="font-medium text-slate-900">{p.lastName}, {p.firstName}</span>
                  {p.nickname && <span className="ml-1 text-slate-400">“{p.nickname}”</span>}
                  <span className="ml-2 font-mono text-xs text-slate-500">{p.code}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">{taken ? "Ya inscripto" : p.mainCategoryName}</span>
              </li>
            );
          })}
          {onCreateNew && results.isSuccess && (
            <li>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); setOpen(false); onCreateNew(text); }} className="w-full px-3 py-2 text-left font-medium text-brand-700 hover:bg-brand-50">
                + Crear jugador nuevo
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
