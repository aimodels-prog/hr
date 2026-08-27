import { BrandLogo } from "@/components/brand-logo";

export function ApplicationBootScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="flex flex-col items-center text-center" role="status" aria-live="polite">
        <BrandLogo className="h-12" />
        <div className="mt-7 h-7 w-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <p className="mt-4 text-sm font-medium text-foreground">Preparing your workspace</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Loading your VIA profile and permissions
        </p>
        <span className="sr-only">VIA HR System is loading.</span>
      </div>
    </div>
  );
}
