import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileCheck2, FileDown, ShieldCheck } from "lucide-react";

import { useCurrentUser } from "@/lib/auth";
import {
  getIndependentSensitiveReviewsFn,
  decideIndependentEmploymentFn,
} from "@/lib/server-functions/sensitive-hr-review.server";
import {
  decideEmployeeDocumentFn,
  readEmployeeDocumentFn,
} from "@/lib/server-functions/core-hr-lifecycle.server";
import {
  decideTrainingRecordFn,
  readTrainingCertificateFn,
} from "@/lib/server-functions/training.server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/staff/independent-record-reviews")({
  component: IndependentRecordReviews,
});

type ReviewForm = {
  id: string;
  decision: "Approve" | "Return";
  note: string;
  answers: Record<string, string>;
};

function IndependentRecordReviews() {
  const user = useCurrentUser();
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: "Employee" as const,
  };
  const assigned = useQuery({
    queryKey: ["independent-sensitive-reviews", user.id, user.activeRole],
    queryFn: () => getIndependentSensitiveReviewsFn({ data: { actor } }),
    enabled: user.activeRole === "Employee",
    refetchInterval: 60_000,
  });
  const [form, setForm] = useState<ReviewForm | null>(null);
  const [saving, setSaving] = useState(false);
  const focusId =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.hash.slice(1)).get("review");
  useEffect(() => {
    if (!focusId || !assigned.data?.some((item) => item.requestId === focusId)) return;
    const card = document.getElementById(`review-${focusId}`);
    card?.scrollIntoView({ block: "center", behavior: "smooth" });
    card?.focus({ preventScroll: true });
  }, [assigned.data, focusId]);

  const openFile = async (id: string, kind: "Document" | "Training Certificate") => {
    try {
      const result =
        kind === "Document"
          ? await readEmployeeDocumentFn({
              data: { actor, fileId: id, reason: "Review assigned employee document" },
            })
          : await readTrainingCertificateFn({ data: { actor, recordId: id } });
      const blob = new Blob([new Uint8Array(result.bytes)], {
        type: result.metadata.mimeType || "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.metadata.name || "review-file";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The file could not be opened.");
    }
  };

  const submit = async (item: NonNullable<typeof assigned.data>[number]) => {
    if (!form || form.id !== item.requestId || saving) return;
    if (form.decision === "Return" && form.note.trim().length < 3) {
      toast.error("Explain what needs to be corrected.");
      return;
    }
    setSaving(true);
    try {
      if (item.module === "Document") {
        const answers = form.answers;
        await decideEmployeeDocumentFn({
          data: {
            actor,
            documentId: item.requestId,
            decision: form.decision === "Approve" ? "verify" : "reject",
            ...(form.decision === "Return" ? { reason: form.note.trim() } : {}),
            ...(form.decision === "Approve"
              ? {
                  ...(item.document.requirementSnapshot ? { answers } : {}),
                  ...(answers["documentNumber"]
                    ? { documentNumber: answers["documentNumber"] }
                    : {}),
                  ...(answers["issuingAuthority"]
                    ? { issuingAuthority: answers["issuingAuthority"] }
                    : {}),
                  ...(answers["issuingCountry"]
                    ? { issuingCountry: answers["issuingCountry"] }
                    : {}),
                  ...(answers["issueDate"] ? { issueDate: answers["issueDate"] } : {}),
                  ...(answers["expiryDate"] ? { expiryDate: answers["expiryDate"] } : {}),
                  visibility: item.document.visibility,
                }
              : {}),
          },
        });
      } else if (item.module === "Training Certificate") {
        await decideTrainingRecordFn({
          data: {
            actor,
            recordId: item.requestId,
            decision: form.decision === "Approve" ? "Verify" : "Reject",
            reason: form.note.trim(),
          },
        });
      } else {
        await decideIndependentEmploymentFn({
          data: {
            actor,
            employeeId: item.requestId,
            decision: form.decision === "Approve" ? "Confirmed" : "Changes Requested",
            note: form.note.trim(),
          },
        });
      }
      toast.success(form.decision === "Approve" ? "Review approved" : "Sent back for correction");
      setForm(null);
      await assigned.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The decision could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (user.activeRole !== "Employee")
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold">Independent reviews</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Switch to your Employee role to review records assigned to you. Super Admin access does
          not grant approval rights.
        </p>
      </main>
    );

  return (
    <main className="mx-auto max-w-5xl space-y-5 pb-8">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Your decisions
        </p>
        <h1 className="text-2xl font-bold">Independent HR record reviews</h1>
        <p className="text-sm text-muted-foreground">
          Only the records assigned to you appear here. Open each file or set of details before
          deciding.
        </p>
      </header>
      <div className="flex justify-end">
        <Button asChild variant="outline" size="sm">
          <Link to="/staff/requests" search={{ view: "reviewed" }}>
            My decision history
          </Link>
        </Button>
      </div>
      {assigned.isLoading && <p role="status">Loading assigned reviews…</p>}
      {assigned.isError && (
        <p role="alert" className="rounded-xl border border-destructive/30 p-4">
          Assigned reviews could not be loaded. Try again or ask HR for help.
        </p>
      )}
      {assigned.data?.length === 0 && (
        <p className="rounded-xl border bg-card p-5 text-sm">Nothing is waiting for your review.</p>
      )}
      <div className="space-y-4">
        {assigned.data?.map((item) => {
          const pending = ["Pending", "Pending Verification", "Pending HR Review"].includes(
            item.status,
          );
          const active = form?.id === item.requestId;
          const values: Record<string, string> =
            item.module === "Document"
              ? {
                  ...(item.document.answers ?? {}),
                  documentNumber:
                    item.document.documentNumber ?? item.document.answers?.["documentNumber"] ?? "",
                  issuingAuthority:
                    item.document.issuingAuthority ??
                    item.document.answers?.["issuingAuthority"] ??
                    "",
                  issuingCountry:
                    item.document.issuingCountry ?? item.document.answers?.["issuingCountry"] ?? "",
                  issueDate: item.document.issueDate ?? item.document.answers?.["issueDate"] ?? "",
                  expiryDate:
                    item.document.expiryDate ?? item.document.answers?.["expiryDate"] ?? "",
                }
              : {};
          return (
            <article
              key={`${item.module}-${item.requestId}`}
              id={`review-${item.requestId}`}
              tabIndex={-1}
              className={`rounded-2xl border bg-card p-5 shadow-sm ${focusId === item.requestId ? "ring-2 ring-primary" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{item.employeeName}</h2>
                  <p className="text-sm text-muted-foreground">
                    {item.module === "Document"
                      ? (item.document.requirementSnapshot?.name ??
                        item.document.type.replaceAll("_", " "))
                      : item.module === "Training Certificate"
                        ? item.title
                        : "Employment details"}
                  </p>
                </div>
                <span className="rounded-full border px-2.5 py-1 text-xs font-medium">
                  {item.status}
                </span>
              </div>
              {item.module === "Document" && (
                <div className="mt-4 space-y-2 text-sm">
                  <p>Document: {item.document.type.replaceAll("_", " ")}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openFile(item.document.fileId, "Document")}
                  >
                    <FileDown className="size-4" /> Open document
                  </Button>
                </div>
              )}
              {item.module === "Training Certificate" && (
                <div className="mt-4 space-y-2 text-sm">
                  <p>
                    {item.provider} · Completed {item.completionDate}
                  </p>
                  {item.certificateFileId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void openFile(item.requestId, "Training Certificate")}
                    >
                      <FileDown className="size-4" /> Open certificate
                    </Button>
                  ) : (
                    <p className="text-amber-800">
                      No certificate attached. Return it for correction.
                    </p>
                  )}
                </div>
              )}
              {item.module === "Employment Confirmation" && (
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  {Object.entries(item.details).map(([label, value]) => (
                    <div key={label} className="border-t pt-2">
                      <dt className="text-xs text-muted-foreground">
                        {label.replace(/([A-Z])/g, " $1")}
                      </dt>
                      <dd className="font-medium">{String(value ?? "—")}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {pending && !active && (
                <div className="mt-5 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      setForm({
                        id: item.requestId,
                        decision: "Approve",
                        note: "",
                        answers: values,
                      })
                    }
                  >
                    <ShieldCheck className="size-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setForm({ id: item.requestId, decision: "Return", note: "", answers: values })
                    }
                  >
                    Return for correction
                  </Button>
                </div>
              )}
              {pending && active && form && (
                <div className="mt-5 space-y-4 border-t pt-4">
                  <h3 className="flex items-center gap-2 font-semibold">
                    <FileCheck2 className="size-4" />
                    {form.decision === "Approve"
                      ? "Confirm this review"
                      : "Explain what needs correcting"}
                  </h3>
                  {item.module === "Document" && form.decision === "Approve" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(
                        item.document.requirementSnapshot?.fields ?? [
                          {
                            key: "documentNumber",
                            label: "Document number",
                            kind: "text",
                            required: true,
                          },
                          {
                            key: "issuingAuthority",
                            label: "Issuing authority",
                            kind: "text",
                            required: true,
                          },
                          {
                            key: "issuingCountry",
                            label: "Issuing country",
                            kind: "text",
                            required: false,
                          },
                          { key: "issueDate", label: "Issue date", kind: "date", required: true },
                          { key: "expiryDate", label: "Expiry date", kind: "date", required: true },
                        ]
                      ).map((field) => (
                        <label key={field.key} className="text-sm font-medium">
                          {field.label}
                          {field.required ? " *" : ""}
                          <Input
                            className="mt-1"
                            type={field.kind === "date" ? "date" : "text"}
                            value={form.answers[field.key] ?? ""}
                            onChange={(event) =>
                              setForm((current) =>
                                current
                                  ? {
                                      ...current,
                                      answers: {
                                        ...current.answers,
                                        [field.key]: event.target.value,
                                      },
                                    }
                                  : current,
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  <label className="block text-sm font-medium">
                    {form.decision === "Return" ? "Correction needed *" : "Note (optional)"}
                    <Textarea
                      className="mt-1"
                      value={form.note}
                      onChange={(event) =>
                        setForm((current) =>
                          current ? { ...current, note: event.target.value } : current,
                        )
                      }
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button disabled={saving} onClick={() => void submit(item)}>
                      {saving
                        ? "Saving…"
                        : form.decision === "Approve"
                          ? "Confirm approval"
                          : "Send back"}
                    </Button>
                    <Button variant="outline" disabled={saving} onClick={() => setForm(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
