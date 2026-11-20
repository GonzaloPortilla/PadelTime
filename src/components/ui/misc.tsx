import type { ReactNode } from "react";
import { Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "green" | "gray" | "blue" | "amber" | "red" | "pink" | "sky" | "lime";
const tones: Record<Tone, string> = {
  green: "bg-ball-50 text-ball-700 ring-ball-500/25",
  gray: "bg-slate-100 text-slate-600 ring-slate-500/20",
  blue: "bg-brand-50 text-brand-700 ring-brand-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  pink: "bg-pink-50 text-pink-700 ring-pink-600/20",
  sky: "bg-sky-50 text-sky-700 ring-sky-600/20",
  lime: "bg-ball-100 text-ball-700 ring-ball-500/30",
};

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl bg-white shadow-[0_1px_2px_rgba(15,90,147,0.06),0_4px_16px_-8px_rgba(15,90,147,0.12)] ring-1 ring-slate-200/80", className)}>{children}</div>;
}

export function CardHeader({ title, action, subtitle }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="truncate font-display text-[15px] font-semibold tracking-wide text-navy">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="mb-2 flex gap-1" aria-hidden><span className="h-1 w-8 rounded-full bg-brand-700" /><span className="h-1 w-4 rounded-full bg-ball-400" /></div>
        <h1 className="font-display text-2xl font-bold uppercase tracking-wide text-navy sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = "Cargando…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-12 text-sm text-slate-500", className)} role="status">
      <Loader2 className="size-5 animate-spin text-brand-600" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-brand-50 p-3 text-brand-600 ring-4 ring-brand-50/50">{icon}</div>}
      <h3 className="font-display text-base font-semibold tracking-wide text-navy">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="m-4 rounded-lg bg-red-50 p-4 text-sm text-red-700 ring-1 ring-inset ring-red-200" role="alert">
      <p className="font-medium">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 font-semibold underline underline-offset-2">
          Reintentar
        </button>
      )}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="block h-10 w-full rounded-lg border-0 bg-white pl-9 pr-9 text-sm shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Limpiar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone = "brand" }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone?: "brand" | "ball" | "sky" | "amber" }) {
  const iconTone = {
    brand: "bg-brand-700 text-white",
    ball: "bg-ball-400 text-white",
    sky: "bg-brand-50 text-brand-700",
    amber: "bg-amber-50 text-amber-700",
  }[tone];
  const bar = { brand: "bg-brand-700", ball: "bg-ball-400", sky: "bg-brand-300", amber: "bg-amber-400" }[tone];
  return (
    <Card className="relative overflow-hidden p-4">
      <span className={cn("absolute inset-x-0 top-0 h-1", bar)} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <p className="font-brand text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
        <div className={cn("rounded-xl p-2", iconTone)}>{icon}</div>
      </div>
      <p className="tabular mt-1 font-display text-3xl font-semibold text-navy">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </Card>
  );
}
