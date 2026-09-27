import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/lib/auth";
import {
  getPayslipsFn,
  uploadPayslipFn,
  downloadPayslipFn,
  replacePayslipFn,
  getPayslipHistoryFn,
} from "@/lib/server-functions/payroll.server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/payslips")({ component: Payslips });
type Payslip = Awaited<ReturnType<typeof getPayslipsFn>>["slips"][number];
function Payslips() {
  const user = useCurrentUser();
  const finance = user.activeRole === "Accounts";
  const [manage, setManage] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [payMonth, setPayMonth] = useState(new Date().toISOString().slice(0, 7));
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [selected, setSelected] = useState<Payslip | null>(null);
  const [historySlip, setHistorySlip] = useState<Payslip | null>(null);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [replacementError, setReplacementError] = useState("");
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const scope = finance && manage ? "finance" : "self";
  const query = useQuery({
    queryKey: ["payslips", user.id, user.workspaceEmail, user.activeRole, scope],
    queryFn: () => getPayslipsFn({ data: { actor, scope } }),
    retry: false,
  });
  const history = useQuery({
    queryKey: ["payslip-history", user.id, user.workspaceEmail, user.activeRole, historySlip?.id],
    queryFn: () => getPayslipHistoryFn({ data: { actor, id: historySlip!.id } }),
    enabled: scope === "finance" && !!historySlip,
    retry: false,
  });
  const upload = async () => {
    if (!file || inFlight.current) return;
    if (file.size > 10 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Choose a PDF no larger than 10 MB.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      await uploadPayslipFn({
        data: {
          actor,
          employeeId,
          payMonth,
          file: {
            fileName: file.name,
            mimeType: "application/pdf",
            bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
          },
        },
      });
      toast.success("Payslip shared with the employee.");
      setFile(null);
      setFileKey((key) => key + 1);
      await queryClient.invalidateQueries({ queryKey: ["payslips"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  const replace = async () => {
    if (!selected || !replacementFile || inFlight.current) return;
    if (
      replacementFile.size > 10 * 1024 * 1024 ||
      !replacementFile.name.toLowerCase().endsWith(".pdf")
    ) {
      setReplacementError("Choose a PDF no larger than 10 MB.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setReplacementError("");
    try {
      await replacePayslipFn({
        data: {
          actor,
          id: selected.id,
          expectedVersion: selected.recordVersion,
          reason: reason.trim(),
          file: {
            fileName: replacementFile.name,
            mimeType: "application/pdf",
            bytes: Array.from(new Uint8Array(await replacementFile.arrayBuffer())),
          },
        },
      });
      toast.success("Payslip replaced. The employee has been notified.");
      setSelected(null);
      setReplacementFile(null);
      setReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payslips"] }),
        queryClient.invalidateQueries({ queryKey: ["payslip-history"] }),
      ]);
    } catch (error) {
      setReplacementError(
        error instanceof Error ? error.message : "Replacement failed. Try again.",
      );
      await queryClient.invalidateQueries({ queryKey: ["payslips"] });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  const download = async (id: string) => {
    if (downloading) return;
    setDownloading(id);
    try {
      const result = await downloadPayslipFn({ data: { actor, id } });
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(result.bytes)], { type: "application/pdf" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = result.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setDownloading(null);
    }
  };
  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {scope === "finance" ? "Employee Payslips" : "My Payslips"}
          </h1>
          <p className="text-sm text-muted-foreground">Private monthly PDFs shared by Finance.</p>
        </div>
        {finance && (
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => {
              setSelected(null);
              setHistorySlip(null);
              setManage((value) => !value);
            }}
          >
            {manage ? "My payslips" : "Manage employee payslips"}
          </Button>
        )}
      </header>
      {query.isError && (
        <div role="alert">
          Payslips could not be loaded. {query.error.message}{" "}
          <Button variant="link" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {query.isPending && <p role="status">Loading payslips…</p>}
      {scope === "finance" && query.data && (
        <section aria-label="Upload payslip" className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">Upload and share an individual payslip</h2>
          <p className="text-sm text-muted-foreground">
            Shared immediately with the employee. To correct an existing payslip, use Replace.
          </p>
          <Label htmlFor="payslip-employee">Employee</Label>
          <select
            id="payslip-employee"
            className="h-10 w-full rounded-md border bg-background px-3"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
          >
            <option value="">Choose employee</option>
            {query.data.employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} — {employee.email}
              </option>
            ))}
          </select>
          <Label htmlFor="payslip-month">Pay month</Label>
          <Input
            id="payslip-month"
            type="month"
            value={payMonth}
            onChange={(event) => setPayMonth(event.target.value)}
          />
          <Label htmlFor="payslip-file">Payslip PDF (maximum 10 MB)</Label>
          <Input
            key={fileKey}
            id="payslip-file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Button
            disabled={saving || !file || !employeeId || !payMonth}
            onClick={() => void upload()}
          >
            {saving ? "Uploading…" : "Upload & share"}
          </Button>
        </section>
      )}
      {query.data && !query.isError && (
        <section aria-label="Payslip list" className="space-y-3">
          {!query.data.slips.length && (
            <p className="rounded-xl border p-5 text-muted-foreground">
              No payslips have been shared yet.
            </p>
          )}
          {query.data.slips.map((slip) => (
            <article
              key={slip.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
            >
              <div>
                <h2 className="font-semibold">{slip.payMonth}</h2>
                {scope === "finance" && <p>{slip.employeeName}</p>}
                <p className="text-xs text-muted-foreground">
                  Uploaded {new Date(slip.uploadedAt).toLocaleDateString()}
                  {slip.revision > 1 && ` · Updated · Version ${slip.revision}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!!downloading}
                  onClick={() => void download(slip.id)}
                >
                  {downloading === slip.id ? "Downloading…" : "Download PDF"}
                </Button>
                {scope === "finance" && (
                  <>
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() => {
                        setSelected(slip);
                        setReason("");
                        setReplacementFile(null);
                        setReplacementError("");
                      }}
                    >
                      Replace
                    </Button>
                    <Button variant="ghost" onClick={() => setHistorySlip(slip)}>
                      History
                    </Button>
                  </>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
      {scope === "finance" && (
        <>
          <Dialog
            open={!!selected}
            onOpenChange={(open) => {
              if (!open && !saving) setSelected(null);
            }}
          >
            <DialogContent className="max-h-[90dvh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Replace payslip</DialogTitle>
                <DialogDescription>
                  {selected?.employeeName} · {selected?.payMonth}. The original stays in Finance
                  history.
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void replace();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="replacement-pdf">Replacement PDF (maximum 10 MB)</Label>
                  <Input
                    id="replacement-pdf"
                    type="file"
                    accept="application/pdf,.pdf"
                    required
                    disabled={saving}
                    onChange={(event) => setReplacementFile(event.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="replacement-reason">Reason for replacement</Label>
                  <Textarea
                    id="replacement-reason"
                    value={reason}
                    required
                    minLength={5}
                    maxLength={1000}
                    disabled={saving}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>
                {replacementError && (
                  <p role="alert" className="text-sm text-destructive">
                    {replacementError}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={() => setSelected(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={saving || !replacementFile || reason.trim().length < 5}
                  >
                    {saving ? "Replacing…" : "Replace & notify employee"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog
            open={!!historySlip}
            onOpenChange={(open) => {
              if (!open) setHistorySlip(null);
            }}
          >
            <DialogContent className="max-h-[90dvh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Payslip history</DialogTitle>
                <DialogDescription>
                  {historySlip?.employeeName} · {historySlip?.payMonth}. Only Finance can access
                  previous versions.
                </DialogDescription>
              </DialogHeader>
              {history.isPending && <p role="status">Loading history…</p>}
              {history.isError && (
                <div role="alert">
                  History could not be loaded.{" "}
                  <Button variant="link" onClick={() => void history.refetch()}>
                    Retry
                  </Button>
                </div>
              )}
              {!history.isError &&
                history.data?.map((version) => (
                  <article key={version.id} className="space-y-2 rounded-lg border p-3">
                    <h3 className="font-medium">
                      Version {version.revision} · {version.current ? "Current" : "Superseded"}
                    </h3>
                    <p className="break-all text-sm">{version.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(version.uploadedAt).toLocaleString()}
                    </p>
                    {version.reason && <p className="break-words text-sm">{version.reason}</p>}
                    <Button
                      variant="outline"
                      disabled={!!downloading}
                      onClick={() => void download(version.id)}
                    >
                      {downloading === version.id
                        ? "Downloading…"
                        : `Download version ${version.revision}`}
                    </Button>
                  </article>
                ))}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
