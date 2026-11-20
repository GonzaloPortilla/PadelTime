import { cn } from "@/lib/cn";

export function Logo({ className, dark = false }: { className?: string; dark?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 64 64" className="size-8 shrink-0" aria-hidden>
        <rect width="64" height="64" rx="14" fill={dark ? "#0b1f1a" : "#17423a"} />
        <circle cx="32" cy="32" r="17" fill="#c6f432" />
        <path d="M19 22c8 4 8 16 0 20M45 22c-8 4-8 16 0 20" stroke="#0b1f1a" strokeWidth="3" fill="none" strokeLinecap="round" />
      </svg>
      <span className={cn("text-lg font-bold tracking-tight", dark ? "text-ink-950" : "text-white")}>
        Padel <span className={dark ? "text-brand-700" : "text-ball-400"}>Time</span>
      </span>
    </div>
  );
}
