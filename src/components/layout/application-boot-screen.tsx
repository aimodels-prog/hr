import { BrandLogo } from "@/components/brand-logo";

export function ApplicationBootScreen({ compact = false }: { compact?: boolean }) {
  // Inside an existing workspace, keep navigation visible and reserve space for content.
  // No timers or minimum display duration: ready content replaces this immediately.
  if (compact) {
    return (
      <div role="status" aria-live="polite" className="w-full py-2">
        <span className="sr-only">VIA HR System is loading.</span>
        <div aria-hidden="true" className="space-y-5 motion-safe:animate-pulse">
          <div className="h-5 w-36 rounded-md bg-muted" />
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-20 rounded-xl border border-border/50 bg-muted/60" />
            ))}
          </div>
          <div className="space-y-3 rounded-xl border border-border/50 p-5">
            <div className="h-3 w-2/3 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-5/6 rounded bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6">
      <div
        className="flex flex-col items-center gap-6 text-center"
        role="status"
        aria-live="polite"
      >
        <BrandLogo className="h-12 dark:brightness-0 dark:invert" />
        <div aria-hidden="true" className="flex items-center gap-2">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="size-1.5 rounded-full bg-primary/60 motion-safe:animate-pulse [animation-duration:1.4s]"
              style={{ animationDelay: `${dot * 180}ms` }}
            />
          ))}
        </div>
        <span className="sr-only">VIA HR System is loading.</span>
      </div>
    </div>
  );
}
