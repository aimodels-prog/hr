import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useCurrentUser } from "@/lib/auth";
import type { CvZipManifest } from "@/lib/recruitment/cv-zip";

export function CvZipDownload({ candidateIds }: { candidateIds: string[] }) {
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manifest, setManifest] = useState<CvZipManifest | null>(null);
  const [progress, setProgress] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const close = () => {
    controller.current?.abort();
    setOpen(false);
    setBusy(false);
    setManifest(null);
  };
  const prepare = async () => {
    const operation = new AbortController();
    controller.current = operation;
    setOpen(true);
    setBusy(true);
    setManifest(null);
    setProgress("Checking original CVs…");
    try {
      const { prepareCandidateCvZipFn } = await import("@/lib/server-functions/candidate.server");
      const result = await prepareCandidateCvZipFn({
        data: { actor, candidateIds, reason: "Requested original CV ZIP for filtered candidates" },
      });
      if (operation.signal.aborted) return;
      if (!result.entries.length)
        throw new Error("No uploaded CVs were found for these candidates.");
      if (result.entries.reduce((sum, entry) => sum + entry.size, 0) > 250 * 1024 * 1024)
        throw new Error(
          "This export exceeds 250 MB. Filter candidates into smaller groups and try again.",
        );
      setManifest(result);
      setProgress("");
    } catch (error) {
      if (!operation.signal.aborted) {
        toast.error(error instanceof Error ? error.message : "Could not prepare the CV export.");
        close();
      }
    } finally {
      if (!operation.signal.aborted) setBusy(false);
    }
  };
  const download = async () => {
    if (!manifest || busy) return;
    const operation = new AbortController();
    controller.current = operation;
    setBusy(true);
    setProgress(`Preparing 0 of ${manifest.entries.length} CVs…`);
    try {
      const { buildCvZip } = await import("@/lib/recruitment/cv-zip");
      const { downloadCandidateCvFn } = await import("@/lib/server-functions/candidate.server");
      const blob = await buildCvZip(
        manifest,
        async (entry) => {
          const result = await downloadCandidateCvFn({
            data: {
              actor,
              cvRecordId: entry.cvRecordId,
              reason: "Downloaded original CV as part of a candidate ZIP export",
            },
          });
          return Uint8Array.from(atob(result.fileBase64), (character) => character.charCodeAt(0));
        },
        (done, total) => setProgress(`Preparing ${done} of ${total} CVs…`),
        operation.signal,
      );
      operation.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `VIA-CVs-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(`ZIP prepared with ${manifest.entries.length} original CV files.`);
      close();
    } catch (error) {
      if (!operation.signal.aborted) {
        toast.error(
          error instanceof Error
            ? error.message
            : "CV download failed. No partial ZIP was downloaded.",
        );
        setProgress("Download failed. You can retry or cancel.");
      }
    } finally {
      if (!operation.signal.aborted) setBusy(false);
    }
  };
  if (!["HR", "Super Admin"].includes(user.activeRole)) return null;
  return (
    <>
      <Button
        variant="outline"
        disabled={!candidateIds.length || open}
        onClick={() => void prepare()}
      >
        <Download className="mr-2 h-4 w-4" />
        Download CVs (ZIP)
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Download original CVs</DialogTitle>
            <DialogDescription>
              All saved CV versions for the candidates in your current filtered list. The documents
              themselves are unchanged.
            </DialogDescription>
          </DialogHeader>
          {manifest && (
            <div className="space-y-2 text-sm">
              <p>
                {manifest.entries.length} CV files · {manifest.candidateCount} candidates ·{" "}
                {(
                  manifest.entries.reduce((sum, entry) => sum + entry.size, 0) /
                  1024 /
                  1024
                ).toFixed(1)}{" "}
                MB
              </p>
              {manifest.withoutCv.length > 0 && (
                <p>
                  {manifest.withoutCv.length} candidates have no saved CV. Their names will be
                  listed in EXPORT-SUMMARY.txt.
                </p>
              )}
              <p className="text-muted-foreground">
                Contains personal information. Store and share it securely. Keep this page open
                until the download starts.
              </p>
            </div>
          )}
          {progress && (
            <p role="status" className="text-sm">
              {progress}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={!manifest || busy} onClick={() => void download()}>
              Download ZIP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
