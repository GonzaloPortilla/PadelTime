import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { LogIn } from "lucide-react";
import { loginSchema } from "@shared/schemas";
import { useAuth } from "@/auth/AuthContext";
import { useForm } from "@/lib/useForm";
import { Button } from "@/components/ui/Button";
import { FormError, TextField } from "@/components/ui/Field";
import { Logo } from "@/components/layout/Logo";

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const form = useForm({ username: "", password: "" });
  const [loading, setLoading] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (user) return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const data = form.validate(loginSchema);
    if (!data) return;
    setLoading(true);
    try {
      await login(data.username, data.password);
      navigate(from, { replace: true });
    } catch (err) {
      form.handleApiError(err);
      form.set("password", "");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh">
      <div className="relative hidden flex-1 overflow-hidden bg-ink-950 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Logo />
        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white">
            Rankings de pádel, <span className="text-ball-400">sin planillas</span>.
          </h1>
          <p className="mt-4 text-slate-300">
            Jugadores, categorías, temporadas y torneos en un solo lugar, siempre actualizados para todo el equipo organizador.
          </p>
        </div>
        <p className="relative z-10 text-xs text-slate-500">Acceso exclusivo para organizadores de Padel Time.</p>
        {/* Cancha estilizada */}
        <svg viewBox="0 0 400 600" className="absolute -right-24 top-1/2 h-[120%] -translate-y-1/2 opacity-[0.12]" aria-hidden>
          <rect x="20" y="20" width="360" height="560" rx="8" fill="none" stroke="#c6f432" strokeWidth="6" />
          <line x1="20" y1="300" x2="380" y2="300" stroke="#c6f432" strokeWidth="8" />
          <line x1="20" y1="160" x2="380" y2="160" stroke="#c6f432" strokeWidth="4" />
          <line x1="20" y1="440" x2="380" y2="440" stroke="#c6f432" strokeWidth="4" />
          <line x1="200" y1="160" x2="200" y2="440" stroke="#c6f432" strokeWidth="4" />
        </svg>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-sm">
          <Logo dark className="mb-8 lg:hidden" />
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Ingresar</h2>
          <p className="mt-1 text-sm text-slate-500">Usá las credenciales que te dio el administrador.</p>
          <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
            <FormError message={form.formError} />
            <TextField
              label="Usuario"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={form.values.username}
              onChange={(e) => form.set("username", e.target.value)}
              error={form.errors.username}
            />
            <TextField
              label="Contraseña"
              name="password"
              type="password"
              autoComplete="current-password"
              value={form.values.password}
              onChange={(e) => form.set("password", e.target.value)}
              error={form.errors.password}
            />
            <Button type="submit" loading={loading} className="w-full" icon={<LogIn className="size-4" />}>
              Ingresar
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
