import * as React from "react";
import { createSubmissionLock } from "@/lib/submission-lock";

export const FormBusyContext = React.createContext(false);

/** Native form semantics, with repeated async submissions blocked immediately. */
export function SafeForm({ onSubmit, children, ...props }: React.ComponentProps<"form">) {
  const lock = React.useRef(createSubmissionLock());
  const [busy, setBusy] = React.useState(false);
  return (
    <FormBusyContext.Provider value={busy}>
      <form
        {...props}
        aria-busy={busy || undefined}
        onSubmit={(event) => {
          if (lock.current.pending) {
            event.preventDefault();
            return;
          }
          if (!onSubmit) return;
          return lock.current.run(async () => {
            setBusy(true);
            try {
              await onSubmit(event);
            } finally {
              setBusy(false);
            }
          });
        }}
      >
        {children}
      </form>
    </FormBusyContext.Provider>
  );
}
