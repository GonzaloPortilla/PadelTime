import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, UserCog } from "lucide-react";
import { userCreateSchema, userUpdateSchema } from "@shared/schemas";
import { MIN_PASSWORD_LENGTH, ROLE_LABEL, type Role } from "@shared/constants";
import type { User } from "@shared/types";
import { api } from "@/lib/api";
import { useForm } from "@/lib/useForm";
import { relativeTime } from "@/lib/format";
import { keys } from "@/hooks/data";
import { useAuth } from "@/auth/AuthContext";
import { Button, IconButton } from "@/components/ui/Button";
import { Checkbox, FormError, SelectField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ActiveBadge } from "@/components/ui/badges";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";

function UserForm({ user, onClose }: { user: User | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const form = useForm({
    username: user?.username ?? "",
    displayName: user?.displayName ?? "",
    role: (user?.role ?? "organizador") as Role,
    active: user?.active ?? true,
    password: "",
  });
  const save = useMutation({
    mutationFn: (body: unknown) => (user ? api.put(`/users/${user.id}`, body) : api.post("/users", body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.users });
      toast(user ? "Usuario actualizado" : "Usuario creado");
      onClose();
    },
    onError: form.handleApiError,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const data = user ? form.validate(userUpdateSchema) : form.validate(userCreateSchema);
    if (data) save.mutate(data);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={user ? `Editar ${user.displayName}` : "Nuevo organizador"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" form="user-form" loading={save.isPending}>Guardar</Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={form.formError} />
        <TextField label="Usuario" required disabled={!!user} value={form.values.username} autoCapitalize="none"
          onChange={(e) => form.set("username", e.target.value)} error={form.errors.username}
          hint={user ? "El nombre de usuario no se puede cambiar." : "Con este nombre va a ingresar."} />
        <TextField label="Nombre visible" required value={form.values.displayName}
          onChange={(e) => form.set("displayName", e.target.value)} error={form.errors.displayName} />
        <SelectField label="Rol" value={form.values.role} onChange={(e) => form.set("role", e.target.value as Role)}
          hint="Los administradores además pueden gestionar usuarios.">
          <option value="organizador">{ROLE_LABEL.organizador}</option>
          <option value="admin">{ROLE_LABEL.admin}</option>
        </SelectField>
        <TextField label={user ? "Nueva contraseña (opcional)" : "Contraseña inicial"} type="password" autoComplete="new-password"
          required={!user} value={form.values.password} onChange={(e) => form.set("password", e.target.value)} error={form.errors.password}
          hint={user ? "Dejala vacía para no cambiarla. Si la cambiás, se cierran sus sesiones." : `Mínimo ${MIN_PASSWORD_LENGTH} caracteres. Pedile que la cambie al ingresar.`} />
        {user && <Checkbox label="Usuario activo" checked={form.values.active} onChange={(v) => form.set("active", v)} hint="Un usuario inactivo no puede ingresar." />}
      </form>
    </Modal>
  );
}

export function UsersPage() {
  const { user: me } = useAuth();
  const [editing, setEditing] = useState<User | null | "new">(null);
  const users = useQuery({ queryKey: keys.users, queryFn: async () => (await api.get<{ items: User[] }>("/users")).items });

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Organizadores con acceso al sistema. No existe registro público: sólo un administrador puede dar acceso."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>Nuevo usuario</Button>}
      />
      <Card>
        {users.isPending ? <Spinner /> : users.isError ? <ErrorState message={users.error.message} onRetry={() => void users.refetch()} /> :
          users.data.length === 0 ? <EmptyState icon={<UserCog className="size-6" />} title="Sin usuarios" /> : (
          <ul className="divide-y divide-slate-100">
            {users.data.map((u) => (
              <li key={u.id} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                    {u.displayName}
                    {u.id === me?.id && <Badge tone="lime">Vos</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">
                    @{u.username} · {ROLE_LABEL[u.role]} · {u.lastLoginAt ? `último ingreso ${relativeTime(u.lastLoginAt)}` : "nunca ingresó"}
                  </p>
                </div>
                <ActiveBadge active={u.active} />
                <IconButton label={`Editar ${u.displayName}`} onClick={() => setEditing(u)}><Pencil className="size-4" /></IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <UserForm user={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
