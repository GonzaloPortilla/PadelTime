import { useState, type FormEvent } from "react";
import { changePasswordSchema } from "@shared/schemas";
import { MIN_PASSWORD_LENGTH, ROLE_LABEL } from "@shared/constants";
import { useAuth } from "@/auth/AuthContext";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { Button } from "@/components/ui/Button";
import { FormError, TextField } from "@/components/ui/Field";
import { Card, CardHeader, PageHeader } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";

export function AccountPage() {
  const { user } = useAuth();
  const toast = useToast();
  const form = useForm({ currentPassword: "", newPassword: "", confirm: "" });
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const data = form.validate(changePasswordSchema);
    if (!data) return;
    if (form.values.confirm !== form.values.newPassword) {
      form.setErrors({ confirm: "Las contraseñas no coinciden" });
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/password", data);
      form.setValues({ currentPassword: "", newPassword: "", confirm: "" });
      toast("Contraseña actualizada. Se cerraron tus otras sesiones.");
    } catch (err) {
      form.handleApiError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader title="Mi cuenta" description={`${user?.displayName} · ${user ? ROLE_LABEL[user.role] : ""} · usuario ${user?.username}`} />
      <Card className="max-w-lg">
        <CardHeader title="Cambiar contraseña" subtitle="Al cambiarla se cierran tus sesiones en otros dispositivos." />
        <form onSubmit={onSubmit} className="space-y-4 p-4 sm:p-5" noValidate>
          <FormError message={form.formError} />
          <TextField label="Contraseña actual" type="password" autoComplete="current-password" value={form.values.currentPassword}
            onChange={(e) => form.set("currentPassword", e.target.value)} error={form.errors.currentPassword} />
          <TextField label="Nueva contraseña" type="password" autoComplete="new-password" value={form.values.newPassword}
            onChange={(e) => form.set("newPassword", e.target.value)} error={form.errors.newPassword}
            hint={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres. Mejor una frase larga que una palabra rara.`} />
          <TextField label="Repetir nueva contraseña" type="password" autoComplete="new-password" value={form.values.confirm}
            onChange={(e) => form.set("confirm", e.target.value)} error={form.errors.confirm} />
          <Button type="submit" loading={loading}>Guardar contraseña</Button>
        </form>
      </Card>
    </>
  );
}
