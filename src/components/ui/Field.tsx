import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const control =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500";
const invalid = "ring-red-400 focus:ring-red-500";

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500" aria-hidden>*</span>}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

type Common = { label: string; error?: string; hint?: ReactNode; containerClassName?: string };

export const TextField = forwardRef<HTMLInputElement, Common & InputHTMLAttributes<HTMLInputElement>>(function TextField(
  { label, error, hint, containerClassName, className, required, ...rest },
  ref,
) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={containerClassName}>
      {(id, describedBy) => (
        <input
          ref={ref}
          id={id}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          required={required}
          className={cn(control, error && invalid, className)}
          {...rest}
        />
      )}
    </Field>
  );
});

export function SelectField({
  label, error, hint, containerClassName, className, required, children, ...rest
}: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={containerClassName}>
      {(id, describedBy) => (
        <select
          id={id}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          required={required}
          className={cn(control, "pr-8", error && invalid, className)}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

export function TextAreaField({
  label, error, hint, containerClassName, className, required, ...rest
}: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={containerClassName}>
      {(id, describedBy) => (
        <textarea
          id={id}
          rows={3}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          required={required}
          className={cn(control, error && invalid, className)}
          {...rest}
        />
      )}
    </Field>
  );
}

/** Select compacto para barras de filtros. */
export function FilterSelect({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, "h-10 w-auto min-w-0 pr-8", className)} {...rest} />;
}

export function Checkbox({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 rounded border-slate-300 text-brand-700 accent-brand-700"
      />
      <label htmlFor={id} className="text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </label>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200">
      {message}
    </div>
  );
}
