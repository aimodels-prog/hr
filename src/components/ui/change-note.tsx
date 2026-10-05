import type { ReactNode } from "react";

/** Routine audit notes stay out of the way; consequential decisions remain visible. */
export function ChangeNote({
  required = false,
  children,
}: {
  required?: boolean;
  children: ReactNode;
}) {
  if (required) return <div>{children}</div>;
  return (
    <details className="space-y-2">
      <summary className="cursor-pointer text-sm text-muted-foreground">
        Add note (optional)
      </summary>
      {children}
    </details>
  );
}
