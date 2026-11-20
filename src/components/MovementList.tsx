import { Link } from "react-router";
import { MOVEMENT_KIND_LABEL } from "@shared/constants";
import type { PointMovement } from "@shared/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

const kindTone = { acreditacion: "green", reversion: "red", ajuste: "amber", anulacion_ajuste: "gray" } as const;

/** Lista de movimientos del registro contable (reutilizada en la ficha del jugador y el libro). */
export function MovementList({ items, showPlayer, onAnnul }: { items: PointMovement[]; showPlayer?: boolean; onAnnul?: (m: PointMovement) => void }) {
  return (
    <ul className="divide-y divide-slate-100" data-testid="movement-list">
      {items.map((m) => (
        <li key={m.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
          <div className={cn("w-16 shrink-0 pt-0.5 text-right text-base font-bold tabular", m.points > 0 ? "text-brand-700" : m.points < 0 ? "text-red-600" : "text-slate-400")}>
            {m.points > 0 ? `+${m.points}` : m.points}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={m.balanceImportId ? (m.kind === "ajuste" ? "blue" : "gray") : kindTone[m.kind]}>
                {m.balanceImportId ? (m.kind === "ajuste" ? "Saldo inicial importado" : "Reversión de saldo inicial") : MOVEMENT_KIND_LABEL[m.kind]}
              </Badge>
              {m.tournamentId ? (
                <Link to={`/torneos/${m.tournamentId}?tab=acreditacion`} className="text-sm font-medium text-slate-900 hover:text-brand-700">{m.tournamentName}</Link>
              ) : (
                <span className="text-sm font-medium text-slate-900">{m.reason}</span>
              )}
              {m.creditVersion && <span className="text-xs text-slate-400">v{m.creditVersion}</span>}
              {m.reversedById && <Badge>{m.kind === "ajuste" ? "Anulado" : "Revertido"}</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {showPlayer && <><Link to={`/jugadores/${m.playerId}`} className="font-medium text-slate-700 hover:text-brand-700">{m.playerName}</Link> · </>}
              {m.seasonName} · {m.categoryName}{m.divisionName ? ` ${m.divisionName}` : ""}
              {m.stageLabel && <> · {m.stageLabel}{m.bonusPoints ? ` (${m.stagePoints} + ${m.bonusPoints} bonus)` : ""}</>}
              {m.partnerName && <> · con {m.partnerName}</>}
              {m.tournamentDate && <> · {formatDate(m.tournamentDate)}</>}
            </p>
            {m.tournamentId && m.reason && <p className="text-xs italic text-slate-500">{m.reason}</p>}
            <p className="text-[11px] text-slate-400">#{m.id} · {m.createdByName ?? "Sistema"} · {formatDateTime(m.createdAt)}</p>
          </div>
          {onAnnul && m.kind === "ajuste" && !m.reversedById && !m.balanceImportId && (
            <button type="button" onClick={() => onAnnul(m)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Anular</button>
          )}
        </li>
      ))}
    </ul>
  );
}
