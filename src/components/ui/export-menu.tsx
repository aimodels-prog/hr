import { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import type { ExportFormat } from "@/lib/data/excel-export";
import { toast } from "sonner";

export function ExportMenu({
  onExport,
  disabled = false,
  label = "Export",
}: {
  onExport: (format: ExportFormat) => Promise<void>;
  disabled?: boolean;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const run = async (format: ExportFormat) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await onExport(format);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The file could not be exported.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled || busy}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          {busy ? "Preparing…" : label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            void run("xlsx");
          }}
        >
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void run("csv");
          }}
        >
          CSV (.csv)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
