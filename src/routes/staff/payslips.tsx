import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/lib/auth";
import {
  getPayslipsFn,
  uploadPayslipFn,
  downloadPayslipFn,
} from "@/lib/server-functions/payroll.server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/payslips")({ component: Payslips });
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
  const upload = async () => {
    if (!file || saving) return;
    if (file.size > 10 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Choose a PDF no larger than 10 MB.");
      return;
    }
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
      await query.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
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
          <Button variant="outline" onClick={() => setManage((value) => !value)}>
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
            Check the employee and PDF carefully. Sharing makes it available to that employee
            immediately. Existing payslips are not overwritten.
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
                </p>
              </div>
              <Button
                variant="outline"
                disabled={!!downloading}
                onClick={() => void download(slip.id)}
              >
                {downloading === slip.id ? "Downloading…" : "Download PDF"}
              </Button>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
