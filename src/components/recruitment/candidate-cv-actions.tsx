import { useEffect, useState } from "react";
import { strFromU8, unzipSync } from "fflate";
import { Eye, FileDown } from "lucide-react";
import { toast } from "sonner";

import { useCurrentUser } from "@/lib/auth";
import { CandidateService } from "@/lib/data/candidate-service";
import { accessCandidateCvFn } from "@/lib/server-functions/candidate.server";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function docxText(bytes: Uint8Array): string | null {
  try {
    const archive = unzipSync(bytes, {
      filter: (entry) => entry.name === "word/document.xml" && entry.originalSize <= 20_000_000,
    });
    const document = archive["word/document.xml"];
    if (!document) return null;
    const xml = new DOMParser().parseFromString(strFromU8(document), "application/xml");
    if (xml.querySelector("parsererror")) return null;
    const paragraphs = Array.from(xml.getElementsByTagNameNS(WORD_NS, "p"));
    return paragraphs
      .map((paragraph) =>
        Array.from(paragraph.getElementsByTagNameNS(WORD_NS, "t"))
          .map((node) => node.textContent ?? "")
          .join(""),
      )
      .filter(Boolean)
      .join("\n")
      .slice(0, 200_000);
  } catch {
    return null;
  }
}

type CandidateCvActionsProps = {
  cvRecordId?: string | undefined;
  applicationId?: string | undefined;
  fileName: string;
  firstOpenedAt?: string | undefined;
  firstOpenedBy?: string | undefined;
};

/** Private, audited access to the original CV; Word files get an in-app text preview. */
export function CandidateCvActions({
  cvRecordId,
  applicationId,
  fileName,
  firstOpenedAt,
  firstOpenedBy,
}: CandidateCvActionsProps) {
  const currentUser = useCurrentUser();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [busyIntent, setBusyIntent] = useState<"preview" | "download" | null>(null);
  const [openedAt, setOpenedAt] = useState(firstOpenedAt);
  const [openedBy, setOpenedBy] = useState(firstOpenedBy);

  useEffect(() => {
    setOpenedAt(firstOpenedAt);
    setOpenedBy(firstOpenedBy);
  }, [firstOpenedAt, firstOpenedBy]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const access = async (intent: "preview" | "download") => {
    setBusyIntent(intent);
    try {
      const result = await accessCandidateCvFn({
        data: {
          actor: {
            actorId: currentUser.userId,
            ...(currentUser.workspaceEmail ? { actorEmail: currentUser.workspaceEmail } : {}),
            activeRole: currentUser.activeRole,
          },
          ...(cvRecordId ? { cvRecordId } : { applicationId }),
          intent,
        },
      });
      const binary = atob(result.fileBase64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const name = result.metadata.name || fileName;
      const extension = name.toLowerCase().split(".").at(-1);
      setOpenedAt(firstOpenedAt ?? result.openedAt);
      setOpenedBy(firstOpenedBy ?? result.openedBy);
      if (intent === "download") {
        const url = URL.createObjectURL(new Blob([bytes], { type: result.metadata.mimeType }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        setPreviewUrl(null);
        setPreviewText(null);
        setPreviewNote(null);
        if (extension === "pdf" && binary.startsWith("%PDF-")) {
          setPreviewUrl(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
        } else if (extension === "txt") {
          setPreviewText(new TextDecoder().decode(bytes).slice(0, 200_000));
        } else if (extension === "docx") {
          const text = result.previewText || docxText(bytes);
          setPreviewText(text || null);
          setPreviewNote(
            text
              ? "Text preview of the Word CV; formatting and images may differ."
              : "This Word CV could not be read in the preview. Download the original to review it.",
          );
        } else if (extension === "doc") {
          setPreviewText(result.previewText || null);
          setPreviewNote(
            result.previewText
              ? "Text preview of the Word CV; formatting and images may differ."
              : "This older Word CV could not be read in the preview. Download the original to review it.",
          );
        }
        setPreviewOpen(true);
      }
      // Keep the vacancy list's opened indicator current when HR returns to it.
      try {
        await new CandidateService().hydrateCompatibilityCache(currentUser.getActorContext());
      } catch {
        // The CV is already open; the next page refresh can recover this display-only marker.
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The CV could not be opened.");
    } finally {
      setBusyIntent(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busyIntent !== null}
          onClick={() => void access("preview")}
        >
          <Eye className="mr-2 h-4 w-4" />
          {busyIntent === "preview" ? "Opening CV…" : "Preview CV"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busyIntent !== null}
          onClick={() => void access("download")}
        >
          <FileDown className="mr-2 h-4 w-4" />
          {busyIntent === "download" ? "Preparing download…" : "Download original"}
        </Button>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {openedAt
            ? `Opened${openedBy ? ` by ${openedBy}` : ""} on ${new Date(openedAt).toLocaleDateString()}`
            : "No recorded CV open"}
        </span>
      </div>
      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          setPreviewOpen(open);
          if (!open) {
            setPreviewUrl(null);
            setPreviewText(null);
            setPreviewNote(null);
          }
        }}
      >
        <DialogContent className="flex h-[min(90vh,60rem)] w-[min(96vw,70rem)] max-w-none flex-col p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="truncate pr-7">{fileName}</DialogTitle>
          </DialogHeader>
          {previewNote && <p className="text-sm text-muted-foreground">{previewNote}</p>}
          {previewUrl ? (
            <iframe
              title={`CV preview: ${fileName}`}
              src={previewUrl}
              className="min-h-0 flex-1 rounded-md border"
            />
          ) : previewText ? (
            <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-white p-5">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">
                {previewText}
              </pre>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border p-6 text-center text-sm text-muted-foreground">
              This CV has no readable in-app preview. The original is available using Download
              original.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
