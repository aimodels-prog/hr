import { SafeForm } from "@/components/ui/safe-form";
import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { LeaveService } from "@/lib/data/leave-service";
import { SettingsService } from "@/lib/data/settings-service";
import { siteVisitLocalNow } from "@/lib/data/site-visit";
import { leaveNoticeAssessment } from "@/lib/data/leave-notice";
import { leaveYearForDate } from "@/lib/data/leave-year";
import { EmployeeService } from "@/lib/data/employee-service";
import { isSupervisorOptionalPosition } from "@/lib/data/executive-reporting";
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

  const employees = empService.getDirectoryEmployees(currentUser.getActorContext());
  const requestingEmployee = employees.find(
    (employee) => employee.id === employeeId || employee.databaseId === employeeId,
  );
  const executiveHrReview = Boolean(
    requestingEmployee?.status === "Active" &&
    requestingEmployee.employmentConfirmationStatus === "Confirmed" &&
    isSupervisorOptionalPosition(requestingEmployee.position) &&
    !requestingEmployee.lineManagerId,
  );
  const actorContext = useMemo(() => currentUser.getActorContext(), [currentUser]);
  const policies = leaveService.getEligiblePolicies(employeeId, actorContext);
  const coveringColleagueCandidates = employees.filter(
    (employee) => employee.id !== employeeId && !["Inactive", "Archived"].includes(employee.status),
  );

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
  const [settingsReady, setSettingsReady] = useState(false);
  const [timezone, setTimezone] = useState("Asia/Muscat");
  const [leaveYearStart, setLeaveYearStart] = useState("01-01");
  const [useSpecialRoute, setUseSpecialRoute] = useState(false);
  const [specialRequestOpen, setSpecialRequestOpen] = useState(false);
  const [specialRequestReason, setSpecialRequestReason] = useState("");
  useEffect(() => {
    setSettingsReady(false);
    if (!open) return;
    let active = true;
    void new SettingsService()
      .getAppSettings()
      .then((settings) => {
        if (active) {
          setTimezone(settings.timezone);
          setLeaveYearStart(settings.leaveYearStart);
          setSettingsReady(true);
        }
      })
      .catch(() => {
        if (active) toast.error("Could not load leave settings. Close this form and try again.");
      });
    return () => {
      active = false;
    };
  }, [open]);
  const [sickPayBreakdown, setSickPayBreakdown] = useState<
    Array<{ fromDay: number; toDay: number; payPercentage: number; days: number }>
  >([]);

  const selectedPolicy = policies.find((p) => p.id === policyId);

  // Recalculate working days and fetch balance when inputs change
  useEffect(() => {
    if (settingsReady && policyId && startDate && endDate) {
      try {
        const days = leaveService.calculateWorkingDays(startDate, endDate, isHalfDay);
        setWorkingDays(days);

        const bal = leaveService.calculateBalance(employeeId, policyId, actorContext);
        setBalance(bal);

        if (selectedPolicy?.type === "Sick" && days > 0) {
          setSickPayBreakdown(
            leaveService.getSickLeavePayBreakdown(employeeId, days, actorContext),
          );
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
  }, [
    policyId,
    startDate,
    endDate,
    isHalfDay,
    employeeId,
    selectedPolicy,
    leaveService,
    actorContext,
    settingsReady,
  ]);

  const handoverRequired = selectedPolicy?.requiresHandoverContact ?? true;
  const today = siteVisitLocalNow(timezone).date;
  const shortNotice =
    selectedPolicy && !(selectedPolicy.type === "Sick" && startDate < today)
      ? leaveNoticeAssessment(selectedPolicy.noticeRules, workingDays, startDate, today)
      : null;
  const crossesLeaveYear = Boolean(
    startDate &&
    endDate &&
    leaveYearForDate(startDate, leaveYearStart) !== leaveYearForDate(endDate, leaveYearStart),
  );
  const exceedsAllowance = Boolean(
    selectedPolicy?.consumesBalance &&
    workingDays > 0 &&
    (selectedPolicy.scope === "Annual" || selectedPolicy.scope === "Ledger"
      ? workingDays > (balance?.projectedAvailable ?? 0)
      : workingDays > selectedPolicy.baseEntitlementDays),
  );
  const needsSpecialRoute = Boolean(
    shortNotice || crossesLeaveYear || exceedsAllowance || useSpecialRoute,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsReady) return;
    if (!policyId || !startDate || !endDate) {
      toast.error("Please fill in all required fields.");
      return;
    }

    if (handoverRequired && !handoverContactId) {
      toast.error("Please select a Covering Colleague for this leave type.");
      return;
    }

    let countedDays: number;
    try {
      countedDays = leaveService.calculateWorkingDays(startDate, endDate, isHalfDay);
    } catch {
      toast.error("Check the leave dates and try again.");
      return;
    }
    if (countedDays <= 0) {
      toast.error("No leave days are counted for these dates. Check the leave settings.");
      return;
    }

    if (selectedPolicy?.requiresAttachment && !attachment) {
      toast.error(`Upload the required evidence for ${selectedPolicy.name}.`);
      return;
    }

    const currentNotice =
      selectedPolicy && !(selectedPolicy.type === "Sick" && startDate < today)
        ? leaveNoticeAssessment(selectedPolicy.noticeRules, countedDays, startDate, today)
        : null;
    if (currentNotice || crossesLeaveYear || exceedsAllowance || useSpecialRoute) {
      setSpecialRequestOpen(true);
      return;
    }

    if (selectedPolicy?.type !== "Annual" && reason.trim().length < 3) {
      toast.error("Explain the reason for this leave request.");
      return;
    }

    await submitRequest();
  };

  const submitRequest = async (specialRequestReason?: string) => {
    const actorContext = currentUser.getActorContext();
    try {
      setIsSubmitting(true);
      const req = await leaveService.submitLeaveRequest(
        {
          employeeId,
          policyId,
          startDate,
          endDate,
          isHalfDay,
          reason,
          ...(specialRequestReason ? { specialRequestReason } : {}),
          ...(handoverContactId ? { handoverContactId } : {}),
        },
        actorContext,
        attachment ?? undefined,
      );

      if (req.status === "Automatically Refused") {
        toast.error("Request Automatically Refused", {
          description: req.refusalReason,
          duration: 10000,
        });
      } else {
        const sentDirectlyToHr =
          !specialRequestReason &&
          req.status === "Pending HR" &&
          req.chainApprovals.length === 1 &&
          req.chainApprovals[0]?.role === "HR";
        toast.success(
          specialRequestReason
            ? "Special request sent"
            : sentDirectlyToHr
              ? "Leave request sent to HR"
              : "Leave request sent",
          {
            description: specialRequestReason
              ? "Your line manager reviews first, then Riccardo, then HR. HR decides the balance and pay treatment."
              : sentDirectlyToHr
                ? "HR is the only reviewer for this request. Follow its status in My Requests."
                : "Your request is now pending approval.",
          },
        );
      }

      onOpenChange(false);
      setSpecialRequestOpen(false);
      setSpecialRequestReason("");
      setAttachment(null);
      onSuccess?.();
    } catch (err: unknown) {
      if (
        !specialRequestReason &&
        err instanceof Error &&
        err.message.includes("Choose the special request option")
      ) {
        setSpecialRequestOpen(true);
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to submit request.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSameDay = startDate && endDate && startDate === endDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl p-4 sm:max-w-[600px] sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-primary" />
            Request Leave
          </DialogTitle>
          <DialogDescription>
            Choose your leave type and dates. You will see the days and any special approval needed
            before sending.
          </DialogDescription>
        </DialogHeader>

        {executiveHrReview && !needsSpecialRoute && (
          <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">
            Ordinary leave for your position goes directly to HR. You do not need a line manager.
          </p>
        )}
        {executiveHrReview && needsSpecialRoute && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            This request needs special approval, which requires an independent reviewer. Ask HR to
            arrange that route before sending it.
          </p>
        )}

        <SafeForm onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="leave-policy">
                Leave Type <span className="text-destructive">*</span>
              </Label>
              <Select
                value={policyId}
                onValueChange={(value) => {
                  setPolicyId(value);
                  setAttachment(null);
                  setBalance(null);
                  setWorkingDays(0);
                }}
              >
                <SelectTrigger id="leave-policy" aria-required="true">
                  <SelectValue placeholder="Select leave type..." />
                </SelectTrigger>
                <SelectContent>
                  {policies.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
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
              <details className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                <summary className="min-h-8 cursor-pointer py-1 font-medium text-primary">
                  About {selectedPolicy.name}
                </summary>
                <p className="mt-2 leading-6">{selectedPolicy.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedPolicy.legalBasis
                    ? `Legal basis: ${selectedPolicy.legalBasis}`
                    : "Company policy, not required by the Labour Law."}
                </p>
              </details>
            )}

            <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="leave-start-date">
                  Start Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="leave-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (!endDate || e.target.value > endDate) setEndDate(e.target.value);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="leave-end-date">
                  End Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="leave-end-date"
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

          {/* Keep the result and any exception visible; detailed rules are available on demand. */}
          {policyId && startDate && endDate && (
            <section className="space-y-3 rounded-lg border bg-muted/30 p-3 sm:p-4">
              <p
                className="flex flex-wrap items-center gap-2 text-sm font-semibold"
                aria-live="polite"
              >
                <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
                {workingDays > 0
                  ? `${workingDays} ${workingDays === 1 ? "day" : "days"} requested`
                  : settingsReady
                    ? "Check the selected dates"
                    : "Calculating leave days…"}
                {selectedPolicy && !selectedPolicy.consumesBalance && workingDays > 0 && (
                  <span className="font-normal text-muted-foreground">· No balance deduction</span>
                )}
                {selectedPolicy?.consumesBalance &&
                  (selectedPolicy.scope === "Annual" || selectedPolicy.scope === "Ledger") &&
                  balance?.policyId === policyId &&
                  workingDays > 0 && (
                    <span className="font-normal text-muted-foreground">
                      · {balance.projectedAvailable} days available
                    </span>
                  )}
              </p>
              {needsSpecialRoute && (
                <p
                  className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900"
                  role="status"
                >
                  This needs special approval. HR will decide which balance and year to use, and
                  whether any excess days are paid or unpaid. Nothing is deducted yet.
                </p>
              )}
              {shortNotice && (
                <p
                  className="rounded-md border border-red-200 bg-red-50 p-2 text-sm font-medium text-red-800"
                  role="status"
                >
                  You have given {shortNotice.actualDays} of the required {shortNotice.requiredDays}
                  days&apos; notice. You can explain why in the next step and send this for special
                  approval.
                </p>
              )}
              <details className="text-sm">
                <summary className="min-h-9 cursor-pointer py-2 font-medium text-primary">
                  See balance calculation and leave rules
                </summary>
                <div className="space-y-3 pt-2">
                  {selectedPolicy && !selectedPolicy.consumesBalance ? (
                    <div className="text-sm text-muted-foreground bg-background p-2 rounded border">
                      This leave type does not use the employee leave balance and is a
                      record-keeping marker only, with no balance approval required.
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
                        <div className="font-semibold text-lg">
                          {balance?.projectedAvailable || 0}
                        </div>
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

                  {selectedPolicy?.type === "Sick" && (
                    <p className="rounded-md border bg-muted/30 p-3 text-sm">
                      Too unwell to apply earlier? Ask HR to permit backdated sick leave for your
                      exact dates. Submit within 14 days of permission, with the required medical
                      evidence. Your assigned reviewer still checks the request.
                    </p>
                  )}
                  {selectedPolicy?.type === "Sick" &&
                    workingDays > 0 &&
                    sickPayBreakdown.length > 0 && (
                      <div className="text-xs mt-2 border-t pt-2">
                        <p className="text-muted-foreground mb-1">
                          Pay is calculated automatically based on how many sick days you have
                          already taken this year.
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
                      <strong>Notice period</strong>
                      <ul className="list-disc pl-4 mt-1">
                        <li>
                          &gt; {selectedPolicy.noticeRules.shortLeaveMaxDays} leave days requires{" "}
                          {selectedPolicy.noticeRules.longLeaveNoticeDays}+ calendar days notice.
                        </li>
                        <li>
                          ≤ {selectedPolicy.noticeRules.shortLeaveMaxDays} leave days requires{" "}
                          {selectedPolicy.noticeRules.shortLeaveNoticeDays}+ calendar days notice.
                        </li>
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            </section>
          )}

          <div className="space-y-4">
            <details className="rounded-lg border px-3 py-2 text-sm">
              <summary className="min-h-8 cursor-pointer py-1 font-medium text-primary">
                {useSpecialRoute
                  ? "Special approval requested"
                  : "Need special approval for another reason?"}
              </summary>
              <div className="mt-2 flex items-start gap-2 border-t pt-3">
                <Checkbox
                  id="special-leave-route"
                  checked={useSpecialRoute}
                  onCheckedChange={(value) => setUseSpecialRoute(Boolean(value))}
                />
                <Label htmlFor="special-leave-route" className="cursor-pointer font-normal">
                  Ask for special approval even if this request meets the normal rules
                </Label>
              </div>
            </details>
            <div className="space-y-2">
              <Label htmlFor="leave-reason">
                {selectedPolicy?.type === "Annual" || needsSpecialRoute ? (
                  "Note (optional)"
                ) : (
                  <>
                    Reason for Leave <span className="text-destructive">*</span>
                  </>
                )}
              </Label>
              <Textarea
                id="leave-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Add anything your reviewer should know..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="leave-covering-colleague">
                Covering Colleague{" "}
                {handoverRequired ? (
                  <span className="text-destructive">*</span>
                ) : (
                  <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                )}
              </Label>
              <SearchableSelect
                id="leave-covering-colleague"
                aria-label="Covering Colleague"
                aria-required={handoverRequired}
                value={handoverContactId}
                onValueChange={setHandoverContactId}
                placeholder="Search covering colleague…"
                options={[
                  ...(!handoverRequired ? [{ value: "", label: "No covering colleague" }] : []),
                  ...coveringColleagueCandidates.map((employee) => ({
                    value: employee.id,
                    label: `${employee.preferredName} · ${employee.employeeNumber}`,
                    keywords: [employee.legalName, employee.workEmail, employee.department],
                  })),
                ]}
              />
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
                !settingsReady ||
                workingDays <= 0 ||
                Boolean(selectedPolicy?.requiresAttachment && !attachment) ||
                (handoverRequired && !handoverContactId)
              }
            >
              {isSubmitting
                ? "Submitting..."
                : needsSpecialRoute
                  ? "Request special approval"
                  : "Submit Request"}
            </Button>
          </DialogFooter>
        </SafeForm>
      </DialogContent>
      <AlertDialog open={specialRequestOpen} onOpenChange={setSpecialRequestOpen}>
        <AlertDialogContent className="max-h-[90dvh] w-[calc(100%-1.5rem)] overflow-y-auto rounded-xl p-4 sm:p-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Send a special leave request?</AlertDialogTitle>
            <AlertDialogDescription>
              {shortNotice
                ? `This request gives ${shortNotice.actualDays} of ${shortNotice.requiredDays} required days' notice. `
                : ""}
              {crossesLeaveYear ? "It crosses entitlement years. " : ""}
              {exceedsAllowance ? "It exceeds the usual leave allowance. " : ""}
              {executiveHrReview
                ? "Special approval needs an independent reviewer. Ask HR to arrange the approval route before sending this request; ordinary leave can go directly to HR."
                : "Explain the circumstances. Your line manager reviews first, then Riccardo, then HR. HR decides which balances to deduct from and whether any remaining days are paid or unpaid. Nothing is approved automatically."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!executiveHrReview && (
            <div className="space-y-2">
              <Label htmlFor="leave-special-reason">Why is special approval needed?</Label>
              <Textarea
                id="leave-special-reason"
                value={specialRequestReason}
                onChange={(event) => setSpecialRequestReason(event.target.value)}
                placeholder="Briefly explain the circumstances"
                maxLength={2000}
              />
              {specialRequestReason.trim().length > 0 &&
                specialRequestReason.trim().length < 10 && (
                  <p className="text-xs text-muted-foreground">Please add a little more detail.</p>
                )}
            </div>
          )}
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => setSpecialRequestOpen(false)}>
              Back to request
            </Button>
            {!executiveHrReview && (
              <Button
                type="button"
                disabled={isSubmitting || specialRequestReason.trim().length < 10}
                onClick={() => void submitRequest(specialRequestReason.trim())}
              >
                {isSubmitting ? "Submitting..." : "Send for special approval"}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
