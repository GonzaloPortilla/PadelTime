import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import {
  BookOpenCheck, CalendarRange, ClipboardList, FileUp, Globe, LayoutDashboard, ListOrdered, LogOut, Menu, Shapes, Trophy, UserCog, Users, X, KeyRound, DatabaseBackup, LayoutTemplate, Layers,
} from "lucide-react";
import { ROLE_LABEL } from "@shared/constants";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/cn";
import { Logo } from "./Logo";

const NAV = [
  { to: "/", label: "Panel", icon: LayoutDashboard, end: true },
  { to: "/jugadores", label: "Jugadores", icon: Users },
  { to: "/torneos", label: "Torneos", icon: Trophy },
  { to: "/eventos", label: "Eventos", icon: Layers },
  { to: "/rankings", label: "Rankings", icon: ListOrdered },
  { to: "/importar-rankings", label: "Importar rankings", icon: FileUp },
  { to: "/web", label: "Contenidos web", icon: LayoutTemplate },
  { to: "/publicacion", label: "Publicación web", icon: Globe },
  { to: "/temporadas", label: "Temporadas", icon: CalendarRange },
  { to: "/categorias", label: "Categorías", icon: Shapes },
  { to: "/puntuacion", label: "Puntuación", icon: ClipboardList },
  { to: "/movimientos", label: "Movimientos", icon: BookOpenCheck },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const items = [...NAV, ...(user?.role === "admin" ? [{ to: "/usuarios", label: "Usuarios", icon: UserCog, end: false }, { to: "/respaldo", label: "Respaldo", icon: DatabaseBackup, end: false }] : [])];
  return (
    <nav className="flex flex-col gap-1" aria-label="Principal">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2.5 font-brand text-[13px] font-bold transition-colors",
              isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-brand-700",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-ball-400" aria-hidden />}
              <Icon className={cn("size-5", isActive ? "text-brand-700" : "text-slate-400")} aria-hidden />
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function UserBox({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  if (!user) return null;
  const initials = user.displayName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="border-t border-slate-200 pt-4">
      <div className="flex items-center gap-3 px-2">
        <div className="flex size-9 items-center justify-center rounded-full bg-brand-700 font-display text-sm font-semibold text-white ring-2 ring-ball-400 ring-offset-2">{initials}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{user.displayName}</p>
          <p className="truncate text-xs text-slate-500">{ROLE_LABEL[user.role]}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <NavLink
          to="/cuenta"
          onClick={onNavigate}
          className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-brand-700"
        >
          <KeyRound className="size-3.5" /> Mi cuenta
        </NavLink>
        <button
          type="button"
          onClick={() => void logout()}
          className="flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-brand-700"
        >
          <LogOut className="size-3.5" /> Salir
        </button>
      </div>
    </div>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-dvh">
      {/* Barra lateral fija en escritorio */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 pb-5 lg:flex">
        <div className="brand-stripe -mx-4 mb-5 h-1" aria-hidden />
        <Logo className="mb-6 px-2" />
        <div className="flex-1 overflow-y-auto"><NavItems /></div>
        <UserBox />
      </aside>

      {/* Barra superior en celulares/tablets */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
        <div className="brand-stripe h-1" aria-hidden />
        <div className="flex h-14 items-center justify-between px-4">
        <Logo />
        <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menú" className="rounded-lg p-2 text-brand-700 hover:bg-brand-50">
          <Menu className="size-6" />
        </button>
        </div>
      </header>

      {/* Menú deslizable en celulares */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-white px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-6 flex items-center justify-between px-2">
              <Logo />
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar menú" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto"><NavItems onNavigate={() => setOpen(false)} /></div>
            <UserBox onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-5 pb-24 sm:px-6 sm:py-8 lg:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
