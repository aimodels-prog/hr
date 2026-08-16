import logo from "@/assets/via-logo.png.asset.json";
import { cn } from "@/lib/utils";

export function BrandLogo({ className, invert = false }: { className?: string; invert?: boolean }) {
  return (
    <img
      src={logo.url}
      alt="VIA International"
      className={cn("h-9 w-auto object-contain", invert && "brightness-0 invert", className)}
    />
  );
}
