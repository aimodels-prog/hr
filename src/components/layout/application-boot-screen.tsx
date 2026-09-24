import { BrandLogo } from "@/components/brand-logo";

export function ApplicationBootScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="flex flex-col items-center text-center" role="status" aria-live="polite">
        <BrandLogo className="h-12 animate-spin [animation-duration:3s] motion-reduce:animate-none dark:brightness-0 dark:invert" />
        <span className="sr-only">VIA HR System is loading.</span>
      </div>
    </div>
  );
}
