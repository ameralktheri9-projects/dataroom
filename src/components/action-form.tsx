"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, buttonClass } from "@/components/ui";
import type { FormState } from "@/lib/form";

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  className,
  disabled,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={buttonClass(variant, "md", className)}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

/** A form bound to a server action that returns FormState; shows its error/success message. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  confirm,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.success) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {(state.error || state.success) && (
        <div className="mt-3">
          <Alert tone={state.error ? "red" : "green"}>{state.error ?? state.success}</Alert>
        </div>
      )}
    </form>
  );
}

/** Submit button that asks for confirmation first; use inside a plain <form action={serverAction}>. */
export function ConfirmSubmit({
  message,
  children,
  variant = "danger",
  size = "md",
  className,
}: {
  message: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  size?: "sm" | "md";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
