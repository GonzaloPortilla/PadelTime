import { cn } from "@/lib/cn";

/**
 * Logotipo oficial de Padel Time (tomado de padeltime.com.ar).
 *  - "horizontal": símbolo + nombre, como en la barra de la web oficial.
 *  - "completo": el logotipo apilado original (símbolo y PADELTIME).
 * `dark` se mantiene por compatibilidad: indica que el fondo es oscuro.
 */
export function Logo({ className, dark = false, variant = "horizontal" }: { className?: string; dark?: boolean; variant?: "horizontal" | "completo" }) {
  if (variant === "completo") {
    return <img src="/brand/padeltime-logo.png" alt="Padel Time" width={280} height={262} className={cn("h-auto w-56", className)} />;
  }
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <img src="/brand/padeltime-simbolo.png" alt="" width={40} height={40} className="size-10 shrink-0" />
      <span className={cn("font-brand text-lg font-bold tracking-tight", dark ? "text-white" : "text-brand-700")}>
        PADEL <span className="text-ball-400">TIME</span>
      </span>
    </div>
  );
}
