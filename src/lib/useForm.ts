import { useCallback, useState } from "react";
import type { z } from "zod";
import { ApiError } from "./api";

/**
 * Manejo simple de formularios: valores, validación con el mismo schema zod que usa la API,
 * y errores por campo (del cliente o devueltos por el servidor).
 */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!e[key as string]) return e;
      const rest = { ...e };
      delete rest[key as string];
      return rest;
    });
  }, []);

  function validate<S extends z.ZodType>(schema: S): z.output<S> | null {
    const result = schema.safeParse(values);
    if (result.success) {
      setErrors({});
      setFormError(null);
      return result.data;
    }
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const k = issue.path.join(".") || "_";
      fields[k] ??= issue.message;
    }
    setErrors(fields);
    setFormError("Revisá los campos marcados");
    return null;
  }

  function handleApiError(err: unknown) {
    if (err instanceof ApiError) {
      setErrors(err.fields);
      setFormError(err.message);
    } else {
      setFormError("Ocurrió un error inesperado");
    }
  }

  return { values, setValues, set, errors, setErrors, formError, setFormError, validate, handleApiError };
}
