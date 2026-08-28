import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useRef } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { TravelService } from "@/lib/data/travel-service";
import type { ExpenseLine, TravelRequest } from "@/lib/data/travel-types";
import { getMasterDataRepository, getProjectRepository } from "@/lib/data/master-data";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  XCircle,
  Plus,
  Trash2,
  FileText,
  Paperclip,
} from "lucide-react";
import { getApplicationDataServices } from "@/lib/data/application-data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseISO, isAfter } from "date-fns";

const generateId = () => Math.random().toString(36).substring(2, 9);

export const Route = createFileRoute("/staff/travel/$requestId")({
  component: TravelDetailRoute,
});

function TravelDetailRoute() {
  const { requestId } = Route.useParams();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const travelService = useMemo(() => new TravelService(), []);
  const pendingReceiptIds = useRef(new Set<string>());

  const [request, setRequest] = useState<TravelRequest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!currentUser?.employeeId) return;
    try {
      setRequest(travelService.getRequestById(requestId, currentUser.getActorContext()));
      setLoadError(null);
    } catch (error: unknown) {
      setRequest(null);
      setLoadError(
        error instanceof Error
          ? error.message
          : "You are not authorised to view this travel request.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, currentUser?.employeeId]);

  const [expenseLines, setExpenseLines] = useState<ExpenseLine[]>([]);
  const [varianceExplanation, setVarianceExplanation] = useState("");
  useEffect(() => {
    if (!request) return;
    setExpenseLines(request.expenses || []);
    setVarianceExplanation(request.varianceExplanation || "");
  }, [request]);

  useEffect(() => {
    const actorContext = currentUser.getActorContext();
    const pendingIds = pendingReceiptIds.current;
    return () => {
      for (const fileId of pendingIds) {
        void getApplicationDataServices().files.delete(fileId, {
          ...actorContext,
          reason: "Unused travel receipt removed when the expense draft was closed",
        });
      }
      pendingIds.clear();
    };
  }, [currentUser]);

  if (!currentUser?.employeeId) return <div>Employee profile required.</div>;
  if (loadError) return <div className="p-8 text-destructive">{loadError}</div>;
  if (!request) return <div className="p-8">Travel request not found.</div>;

  const project = request.projectId ? getProjectRepository().getById(request.projectId) : null;
  const costCentre = request.costCentreId
    ? getMasterDataRepository("costCentres").getById(request.costCentreId)
    : null;

  const handleWithdraw = () => {
    try {
      const updated = travelService.withdrawRequest(request.id, currentUser!.getActorContext());
      setRequest(updated);
      toast.success("Travel request withdrawn");
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Travel request could not be withdrawn.",
      );
    }
  };

  const getStatusIcon = (status: string) => {
    if (status === "Approved" || status === "Closed")
      return <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
    if (status === "Rejected") return <XCircle className="w-5 h-5 text-destructive" />;
    return <Clock className="w-5 h-5 text-amber-500" />;
  };

  // Expense Logic
  const endDate = parseISO(request.endDate);
  const today = new Date();
  endDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const canSubmitExpenses = request.status === "Pre-authorised" && today > endDate;
  const isSubmissionLocked =
    request.status === "Pending Super Admin Closure" || request.status === "Closed";

  const actualTotal =
    isSubmissionLocked && request.actualTotal !== undefined
      ? request.actualTotal
      : expenseLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const isVarianceHigh = actualTotal > request.totalEstimate * 1.1;

  // Expense lines inherit the trip's approved currency (there is no per-line currency picker),
  // so whenever that currency isn't OMR every line needs an exchange rate to OMR or
  // TravelService.submitExpenses will reject the submission outright (fail-closed, by design -
  // see computeActualTotalOmr). Surface that requirement here instead of leaving the trip stuck.
  const isForeignCurrency = request.currency !== "OMR";

  const addLine = () => {
    setExpenseLines([
      ...expenseLines,
      {
        id: generateId(),
        category: "Transport",
        amount: 0,
        date: request.startDate,
        currency: request.currency,
        ...(!isForeignCurrency ? { exchangeRate: 1 } : {}),
        reference: "",
      },
    ]);
  };

  const updateLine = <K extends keyof ExpenseLine>(id: string, field: K, value: ExpenseLine[K]) => {
    setExpenseLines(
      expenseLines.map((line) => (line.id === id ? { ...line, [field]: value } : line)),
    );
  };

  const removeLine = (id: string) => {
    const receiptFileId = expenseLines.find((line) => line.id === id)?.receiptFileId;
    if (receiptFileId && pendingReceiptIds.current.delete(receiptFileId)) {
      void getApplicationDataServices().files.delete(receiptFileId, {
        ...currentUser.getActorContext(),
        reason: "Unused receipt removed with the expense line",
      });
    }
    setExpenseLines(expenseLines.filter((line) => line.id !== id));
  };

  const uploadReceipt = async (lineId: string, file: File | undefined | null) => {
    if (!file) return;
    try {
      const { files } = getApplicationDataServices();
      const previousReceiptId = expenseLines.find((line) => line.id === lineId)?.receiptFileId;
      const saved = await files.save(
        {
          blob: file,
          name: file.name,
          mimeType: file.type,
          owner: { entityType: "travel-expense-line", entityId: lineId },
        },
        currentUser!.getActorContext(),
      );
      pendingReceiptIds.current.add(saved.id);
      updateLine(lineId, "receiptFileId", saved.id);
      if (previousReceiptId && pendingReceiptIds.current.delete(previousReceiptId)) {
        await files.delete(previousReceiptId, {
          ...currentUser.getActorContext(),
          reason: "Travel receipt replaced before expense submission",
        });
      }
      toast.success("Receipt attached");
    } catch {
      toast.error("Failed to upload receipt");
    }
  };

  const handleSubmitExpenses = async () => {
    try {
      if (expenseLines.length === 0) {
        toast.error("Add at least one expense line.");
        return;
      }
      const lineMissingReference = expenseLines.find((line) => !line.reference?.trim());
      if (lineMissingReference) {
        toast.error(
          `Enter a bill/receipt reference for the ${lineMissingReference.category} expense dated ${lineMissingReference.date} before submitting.`,
        );
        return;
      }
      const lineMissingReceipt = expenseLines.find((line) => !line.receiptFileId);
      if (lineMissingReceipt) {
        toast.error(
          `Upload the receipt or invoice for the ${lineMissingReceipt.category} expense dated ${lineMissingReceipt.date}.`,
        );
        return;
      }
      const lineMissingRate = expenseLines.find(
        (line) =>
          line.currency !== "OMR" &&
          !(typeof line.exchangeRate === "number" && line.exchangeRate > 0),
      );
      if (lineMissingRate) {
        toast.error(
          `Enter a positive exchange rate to OMR for the ${lineMissingRate.category} expense dated ${lineMissingRate.date} before submitting.`,
        );
        return;
      }
      const updated = await travelService.submitExpenses(
        request.id,
        expenseLines,
        varianceExplanation,
        currentUser!.getActorContext(),
      );
      pendingReceiptIds.current.clear();
      setRequest(updated);
      toast.success("Expenses sent for final review");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Expenses could not be submitted.");
    }
  };

  return (
    <RequirePermission permission="travel:request_self" resourceName="Travel Details">
      <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
        <div className="flex items-center gap-2 mb-2">
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/staff/travel" })}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to List
          </Button>
        </div>

        <PageHeader
          title={`Travel to ${request.destination}`}
          description={request.purpose}
          actions={
            <Badge
              className="text-sm px-3 py-1"
              variant={
                request.status === "Pre-authorised" || request.status === "Closed"
                  ? "default"
                  : request.status === "Rejected"
                    ? "destructive"
                    : "secondary"
              }
            >
              {request.status}
            </Badge>
          }
        />

        {request.status === "Pending HR and Accounts" &&
          request.hrApprovalStatus === "Pending" &&
          request.accountsApprovalStatus === "Pending" && (
            <div className="flex justify-end">
              <Button variant="outline" onClick={handleWithdraw}>
                Withdraw Request
              </Button>
            </div>
          )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">Approval Timeline</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-6">
              <div className="flex items-start gap-4">
                {getStatusIcon(request.hrApprovalStatus)}
                <div>
                  <div className="font-medium">HR Policy & Dates</div>
                  <div className="text-sm text-muted-foreground">{request.hrApprovalStatus}</div>
                  {request.hrNotes && (
                    <div className="text-sm mt-1 bg-muted/50 p-2 rounded">{request.hrNotes}</div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-4">
                {getStatusIcon(request.accountsApprovalStatus)}
                <div>
                  <div className="font-medium">Accounts & Budgeting</div>
                  <div className="text-sm text-muted-foreground">
                    {request.accountsApprovalStatus}
                  </div>
                  {request.accountsNotes && (
                    <div className="text-sm mt-1 bg-muted/50 p-2 rounded">
                      {request.accountsNotes}
                    </div>
                  )}
                </div>
              </div>

              {request.closureNotes && (
                <div className="flex items-start gap-4 pt-4 border-t">
                  <FileText className="w-5 h-5 text-blue-500" />
                  <div>
                    <div className="font-medium">Super Admin Closure Notes</div>
                    <div className="text-sm mt-1 bg-muted/50 p-2 rounded">
                      {request.closureNotes}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">Trip Details</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-y-4">
                <div>
                  <span className="text-muted-foreground block mb-1">Start Date</span>{" "}
                  {request.startDate}
                </div>
                <div>
                  <span className="text-muted-foreground block mb-1">End Date</span>{" "}
                  {request.endDate}
                </div>
                <div>
                  <span className="text-muted-foreground block mb-1">Project Allocation</span>{" "}
                  {project ? project.name : "None"}
                </div>
                <div>
                  <span className="text-muted-foreground block mb-1">Cost Centre</span>{" "}
                  {costCentre ? costCentre.name : "Default"}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Notes / Justification</span>
                <p className="whitespace-pre-wrap">{request.notes || "None provided."}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base">Financial Overview ({request.currency})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-4 font-medium">Category</th>
                    <th className="text-right p-4 font-medium">Pre-Authorised Estimate</th>
                    <th className="text-right p-4 font-medium text-emerald-700">Actual Expenses</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr className="bg-muted/10 font-bold">
                    <td className="p-4">Total</td>
                    <td className="p-4 text-right text-lg">
                      {request.totalEstimate.toLocaleString()}
                    </td>
                    <td className="p-4 text-right text-lg text-emerald-700">
                      {actualTotal.toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>

          {(canSubmitExpenses || isSubmissionLocked) && (
            <Card className="md:col-span-2">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-base">Expense Report</CardTitle>
                <CardDescription>
                  {isSubmissionLocked
                    ? "Expenses have been sent and can no longer be changed."
                    : "Add the actual expenses from your trip."}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                {isForeignCurrency && !isSubmissionLocked && (
                  <div className="p-3 bg-blue-50 rounded-md border border-blue-200 text-sm text-blue-900">
                    This trip was authorised in {request.currency}. Enter the exchange rate to OMR
                    for each expense line (amount x rate = OMR equivalent) - it's required before
                    expenses can be sent for final review.
                  </div>
                )}
                <div className="space-y-4">
                  {expenseLines.map((line, idx) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-[repeat(13,minmax(0,1fr))] gap-2 items-center bg-muted/20 p-2 rounded"
                    >
                      <div className="col-span-1 text-center text-muted-foreground font-mono text-xs">
                        {idx + 1}
                      </div>
                      <div className="col-span-2">
                        <Select
                          value={line.category}
                          onValueChange={(v) =>
                            updateLine(line.id, "category", v as ExpenseLine["category"])
                          }
                          disabled={isSubmissionLocked}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Transport">Transport</SelectItem>
                            <SelectItem value="Accommodation">Accommodation</SelectItem>
                            <SelectItem value="Per Diem">Per Diem</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Input
                          type="date"
                          value={line.date}
                          onChange={(e) => updateLine(line.id, "date", e.target.value)}
                          disabled={isSubmissionLocked}
                        />
                      </div>
                      <div className="col-span-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder={`Amount (${line.currency})`}
                          value={line.amount || ""}
                          onChange={(e) =>
                            updateLine(line.id, "amount", parseFloat(e.target.value) || 0)
                          }
                          disabled={isSubmissionLocked}
                        />
                      </div>
                      {isForeignCurrency && (
                        <div className="col-span-2">
                          <Input
                            type="number"
                            step="0.0001"
                            min="0"
                            placeholder="Rate to OMR"
                            value={line.exchangeRate ?? ""}
                            onChange={(e) =>
                              updateLine(
                                line.id,
                                "exchangeRate",
                                e.target.value === "" ? undefined : parseFloat(e.target.value) || 0,
                              )
                            }
                            disabled={isSubmissionLocked}
                          />
                        </div>
                      )}
                      <div className={isForeignCurrency ? "col-span-2" : "col-span-4"}>
                        <Input
                          placeholder="Bill / receipt reference *"
                          value={line.reference || ""}
                          onChange={(e) => updateLine(line.id, "reference", e.target.value)}
                          disabled={isSubmissionLocked}
                        />
                      </div>
                      <div className="col-span-1 text-center">
                        {!isSubmissionLocked && (
                          <label
                            className={`inline-flex cursor-pointer items-center justify-center ${line.receiptFileId ? "text-emerald-600" : "text-muted-foreground"}`}
                            title={line.receiptFileId ? "Receipt attached" : "Attach receipt"}
                          >
                            <Paperclip className="w-4 h-4" />
                            <input
                              type="file"
                              className="hidden"
                              onChange={(e) => void uploadReceipt(line.id, e.target.files?.[0])}
                            />
                          </label>
                        )}
                      </div>
                      <div className="col-span-1 text-right">
                        {!isSubmissionLocked && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive px-2"
                            onClick={() => removeLine(line.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}

                  {!isSubmissionLocked && (
                    <Button variant="outline" size="sm" onClick={addLine}>
                      <Plus className="w-4 h-4 mr-2" /> Add Expense Line
                    </Button>
                  )}
                </div>

                {isVarianceHigh && (
                  <div className="p-4 bg-amber-50 rounded-md border border-amber-200 mt-4">
                    <div className="text-amber-900 font-medium mb-2">
                      High Variance Detected (+10% above estimate)
                    </div>
                    <Textarea
                      placeholder="Please explain the reason for the additional expenses..."
                      value={varianceExplanation}
                      onChange={(e) => setVarianceExplanation(e.target.value)}
                      className="bg-white border-amber-300"
                      disabled={isSubmissionLocked}
                    />
                  </div>
                )}
              </CardContent>
              {!isSubmissionLocked && (
                <div className="p-4 bg-muted/10 border-t flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setExpenseLines(request.expenses || [])}>
                    Reset
                  </Button>
                  <Button onClick={handleSubmitExpenses}>Submit for Closure</Button>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </RequirePermission>
  );
}
