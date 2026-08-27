import logo from "@/assets/via-logo.png";
import { cn } from "@/lib/utils";

export function BrandLogo({ className, invert = false }: { className?: string; invert?: boolean }) {
  return (
    <img
      src={logo}
      alt="VIA International"
      className={cn(
        "h-10 w-auto object-contain object-left",
        invert && "brightness-0 invert",
        className,
      )}
    />
  );
}
