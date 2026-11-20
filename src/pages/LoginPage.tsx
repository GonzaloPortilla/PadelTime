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
    <div className="brand-waves flex min-h-dvh flex-col lg:flex-row">
      {/* Identidad: logotipo oficial sobre las ondas azul y verde de la web */}
      <div className="hidden flex-1 flex-col items-center justify-center px-12 pb-40 pt-12 text-center lg:flex">
        <Logo variant="completo" className="w-72 drop-shadow-sm" />
        <p className="mt-6 font-display text-3xl font-bold uppercase tracking-wide text-navy">Comunidad de pádel</p>
        <p className="mt-2 max-w-md text-slate-600">
          Torneos, puntos y rankings en un solo lugar, siempre actualizados para todo el equipo organizador.
        </p>
      </div>

      <div className="flex flex-1 items-start justify-center px-4 pb-40 pt-10 sm:px-6 lg:items-center lg:pb-12">
        <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl shadow-brand-900/10 ring-1 ring-slate-200">
          <div className="brand-stripe h-1.5" aria-hidden />
          <div className="px-6 py-8 sm:px-8">
            <Logo variant="completo" className="mx-auto mb-6 w-36 lg:hidden" />
            <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-navy">Ingresar</h2>
            <p className="mt-1 text-sm text-slate-500">Usá las credenciales que te dio el administrador.</p>
            <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
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
              <Button type="submit" loading={loading} className="h-11 w-full" icon={<LogIn className="size-4" />}>
                Ingresar
              </Button>
            </form>
            <p className="mt-6 text-center text-xs text-slate-400">Acceso exclusivo para organizadores de Padel Time.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
