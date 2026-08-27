import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { LeaveService } from "@/lib/data/leave-service";
import { EmployeeService } from "@/lib/data/employee-service";
import type { LeavePolicy, LeaveBalanceReport } from "@/lib/data/leave-types";
import { useCurrentUser } from "@/lib/auth";
import { toast } from "sonner";
import {
  CalendarRange,
  Info,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Upload,
  X,
} from "lucide-react";
import { getApplicationDataServices } from "@/lib/data/application-data";

const MAX_EVIDENCE_SIZE = 10 * 1024 * 1024;
const EVIDENCE_TYPES = ["application/pdf", "image/jpeg", "image/png"];

interface LeaveRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  employeeId: string;
}

export function LeaveRequestDialog({
  open,
  onOpenChange,
  onSuccess,
  employeeId,
}: LeaveRequestDialogProps) {
  const currentUser = useCurrentUser();
  const leaveService = useMemo(() => new LeaveService(), []);
  const empService = useMemo(() => new EmployeeService(), []);

  const employees = empService.getEmployees();
  const policies = leaveService.getEligiblePolicies(employeeId);

  const [policyId, setPolicyId] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [handoverContactId, setHandoverContactId] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);

  const [workingDays, setWorkingDays] = useState(0);
  const [balance, setBalance] = useState<LeaveBalanceReport | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sickPayBreakdown, setSickPayBreakdown] = useState<
    Array<{ fromDay: number; toDay: number; payPercentage: number; days: number }>
  >([]);

  const selectedPolicy = policies.find((p) => p.id === policyId);

  // Recalculate working days and fetch balance when inputs change
  useEffect(() => {
    if (policyId && startDate && endDate) {
      try {
        const days = leaveService.calculateWorkingDays(startDate, endDate, isHalfDay);
        setWorkingDays(days);

        const bal = leaveService.calculateBalance(employeeId, policyId);
        setBalance(bal);

        if (selectedPolicy?.type === "Sick" && days > 0) {
          setSickPayBreakdown(leaveService.getSickLeavePayBreakdown(employeeId, days));
        } else {
          setSickPayBreakdown([]);
        }
      } catch (e) {
        setWorkingDays(0);
        setSickPayBreakdown([]);
      }
    } else {
      setWorkingDays(0);
      setSickPayBreakdown([]);
    }
  }, [policyId, startDate, endDate, isHalfDay, employeeId, selectedPolicy, leaveService]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policyId || !startDate || !endDate || !reason || !handoverContactId) {
      toast.error("Please fill in all required fields, including a Covering Colleague.");
      return;
    }

    if (workingDays <= 0) {
      toast.error("Requested period contains no working days.");
      return;
    }

    if (selectedPolicy?.requiresAttachment && !attachment) {
      toast.error(`Upload the required evidence for ${selectedPolicy.name}.`);
      return;
    }

    const actorContext = currentUser.getActorContext();
    let uploadedFileId: string | undefined;
    try {
      setIsSubmitting(true);
      if (attachment) {
        const metadata = await getApplicationDataServices().files.save(
          {
            blob: attachment,
            name: attachment.name,
            mimeType: attachment.type,
            owner: { entityType: "leave-request-evidence", entityId: employeeId },
          },
          actorContext,
        );
        uploadedFileId = metadata.id;
      }
      const req = await leaveService.submitLeaveRequest(
        {
          employeeId,
          policyId,
          startDate,
          endDate,
          isHalfDay,
          reason,
          handoverContactId,
          ...(uploadedFileId ? { attachmentFileId: uploadedFileId } : {}),
        },
        actorContext,
      );

      if (req.status === "Automatically Refused") {
        toast.error("Request Automatically Refused", {
          description: req.refusalReason,
          duration: 10000,
        });
      } else {
        toast.success("Leave request sent", {
          description: "Your request is now pending approval.",
        });
      }

      onOpenChange(false);
      setAttachment(null);
      onSuccess?.();
    } catch (err: unknown) {
      if (uploadedFileId) {
        await getApplicationDataServices().files.delete(uploadedFileId, actorContext);
      }
      toast.error(err instanceof Error ? err.message : "Failed to submit request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSameDay = startDate && endDate && startDate === endDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-primary" />
            Request Leave
          </DialogTitle>
          <DialogDescription>
            Submit a new time-off request. Your balance will be projected automatically.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>
                Leave Type <span className="text-destructive">*</span>
              </Label>
              <Select
                value={policyId}
                onValueChange={(value) => {
                  setPolicyId(value);
                  setAttachment(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select leave type..." />
                </SelectTrigger>
                <SelectContent>
                  {policies.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedPolicy?.requiresAttachment && (
              <div className="space-y-2">
                <Label htmlFor="leave-evidence">
                  Supporting Evidence <span className="text-destructive">*</span>
                </Label>
                {attachment ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <FileText className="h-5 w-5 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{attachment.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(attachment.size / 1024 / 1024).toFixed(1)} MB
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Remove attachment"
                      onClick={() => setAttachment(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <label
                    htmlFor="leave-evidence"
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
                  >
                    <Upload className="h-4 w-4" /> Upload PDF, JPG or PNG
                  </label>
                )}
                <Input
                  id="leave-evidence"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    if (!EVIDENCE_TYPES.includes(file.type)) {
                      toast.error("Upload a PDF, JPG or PNG file.");
                      return;
                    }
                    if (file.size > MAX_EVIDENCE_SIZE) {
                      toast.error("The attachment must be 10 MB or smaller.");
                      return;
                    }
                    setAttachment(file);
                  }}
                />
                <p className="text-xs text-muted-foreground">Maximum file size: 10 MB.</p>
              </div>
            )}

            {selectedPolicy && (
              <div className="flex items-start gap-2 border rounded-md p-3 bg-muted/20 text-sm">
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  <div>{selectedPolicy.description}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {selectedPolicy.legalBasis
                      ? `Legal basis: ${selectedPolicy.legalBasis}`
                      : "Company policy, not required by the Labour Law."}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  Start Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (!endDate || e.target.value > endDate) setEndDate(e.target.value);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>
                  End Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                />
              </div>
            </div>

            {isSameDay && (
              <div className="flex items-center space-x-2 border p-3 rounded-md bg-muted/20">
                <Checkbox
                  id="halfDay"
                  checked={isHalfDay}
                  onCheckedChange={(c) => setIsHalfDay(!!c)}
                />
                <Label htmlFor="halfDay" className="font-normal cursor-pointer">
                  This is a partial / half day (0.5 days)
                </Label>
              </div>
            )}
          </div>

          {/* Balance Impact Preview */}
          {policyId && startDate && endDate && (
            <div className="bg-muted/30 p-4 rounded-md border space-y-3">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Info className="h-4 w-4" /> Balance Impact Preview
              </h4>

              {selectedPolicy && !selectedPolicy.consumesBalance ? (
                <div className="text-sm text-muted-foreground bg-background p-2 rounded border">
                  This leave type does not use the employee leave balance and is a record-keeping
                  marker only, with no balance approval required.
                </div>
              ) : selectedPolicy?.scope === "Once Per Service" ? (
                <div className="grid grid-cols-3 gap-2 text-sm text-center">
                  <div className="bg-background p-2 rounded border col-span-1">
                    <div className="text-muted-foreground text-xs mb-1">Available</div>
                    <div className="font-semibold text-lg">
                      {selectedPolicy.baseEntitlementDays}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Usable only once across the whole employment period
                    </div>
                  </div>
                  <div className="bg-background p-2 rounded border">
                    <div className="text-muted-foreground text-xs mb-1">Requested</div>
                    <div className="font-semibold text-lg text-amber-600">-{workingDays}</div>
                  </div>
                  <div className="bg-background p-2 rounded border border-primary/50">
                    <div className="text-muted-foreground text-xs mb-1">Remaining</div>
                    <div className="font-semibold text-lg text-primary">
                      {selectedPolicy.baseEntitlementDays - workingDays}
                    </div>
                  </div>
                </div>
              ) : selectedPolicy?.scope === "Per Event" ? (
                <div className="grid grid-cols-3 gap-2 text-sm text-center">
                  <div className="bg-background p-2 rounded border col-span-1">
                    <div className="text-muted-foreground text-xs mb-1">Available</div>
                    <div className="font-semibold text-lg">
                      {selectedPolicy.baseEntitlementDays}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Available per occurrence
                    </div>
                  </div>
                  <div className="bg-background p-2 rounded border">
                    <div className="text-muted-foreground text-xs mb-1">Requested</div>
                    <div className="font-semibold text-lg text-amber-600">-{workingDays}</div>
                  </div>
                  <div className="bg-background p-2 rounded border border-primary/50">
                    <div className="text-muted-foreground text-xs mb-1">Remaining</div>
                    <div className="font-semibold text-lg text-primary">
                      {selectedPolicy.baseEntitlementDays - workingDays}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 text-sm text-center">
                  <div className="bg-background p-2 rounded border">
                    <div className="text-muted-foreground text-xs mb-1">Available</div>
                    <div className="font-semibold text-lg">{balance?.projectedAvailable || 0}</div>
                  </div>
                  <div className="bg-background p-2 rounded border">
                    <div className="text-muted-foreground text-xs mb-1">Requested</div>
                    <div className="font-semibold text-lg text-amber-600">-{workingDays}</div>
                  </div>
                  <div className="bg-background p-2 rounded border border-primary/50">
                    <div className="text-muted-foreground text-xs mb-1">Remaining</div>
                    <div className="font-semibold text-lg text-primary">
                      {(balance?.projectedAvailable || 0) - workingDays}
                    </div>
                  </div>
                </div>
              )}

              {selectedPolicy?.type === "Sick" &&
                workingDays > 0 &&
                sickPayBreakdown.length > 0 && (
                  <div className="text-xs mt-2 border-t pt-2">
                    <p className="text-muted-foreground mb-1">
                      Pay is calculated automatically based on how many sick days you have already
                      taken this year.
                    </p>
                    <ul className="list-disc pl-4">
                      {sickPayBreakdown.map((tier, idx) => (
                        <li key={idx}>
                          {tier.days.toFixed(1)} days at {tier.payPercentage}% pay
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              {selectedPolicy?.noticeRules?.enabled && (
                <div className="text-xs text-muted-foreground mt-2 border-t pt-2">
                  <strong>Notice Rules Apply:</strong>
                  <ul className="list-disc pl-4 mt-1">
                    <li>
                      &gt; {selectedPolicy.noticeRules.shortLeaveMaxDays} working days requires{" "}
                      {selectedPolicy.noticeRules.longLeaveNoticeDays}+ calendar days notice.
                    </li>
                    <li>
                      ≤ {selectedPolicy.noticeRules.shortLeaveMaxDays} working days requires{" "}
                      {selectedPolicy.noticeRules.shortLeaveNoticeDays}+ calendar days notice.
                    </li>
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>
                Reason for Leave <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Provide context for your manager..."
              />
            </div>

            <div className="space-y-2">
              <Label>
                Covering Colleague (Backstop) <span className="text-destructive">*</span>
              </Label>
              <Select value={handoverContactId} onValueChange={setHandoverContactId}>
                <SelectTrigger>
                  <SelectValue placeholder="Who will cover your duties while you are away?" />
                </SelectTrigger>
                <SelectContent>
                  {employees
                    .filter((e) => e.id !== employeeId)
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.preferredName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isSubmitting ||
                workingDays <= 0 ||
                Boolean(selectedPolicy?.requiresAttachment && !attachment)
              }
            >
              {isSubmitting ? "Submitting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
