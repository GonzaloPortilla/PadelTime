import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-500 sm:px-5">
      <p className="tabular">{from}–{to} de {total}</p>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Página anterior"
            className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent">
            <ChevronLeft className="size-4" />
          </button>
          <span className="tabular px-2">{page} / {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Página siguiente"
            className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent">
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
