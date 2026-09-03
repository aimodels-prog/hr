import { useEffect, useMemo, useState } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { LeaveService } from "@/lib/data/leave-service";

interface ManualAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  defaultEmployeeId?: string;
  defaultPolicyId?: string;
}

function formatDays(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
}

export function ManualAdjustmentDialog({
  open,
  onOpenChange,
  onSuccess,
  defaultEmployeeId,
  defaultPolicyId,
}: ManualAdjustmentDialogProps) {
  const currentUser = useCurrentUser();
  const actorContext = useMemo(() => currentUser.getActorContext(), [currentUser]);
  const leaveService = useMemo(() => new LeaveService(), []);
  const employeeService = useMemo(() => new EmployeeService(), []);
  const employees = employeeService
    .getEmployees(currentUser.getActorContext())
    .filter((employee) => !["Inactive", "Archived"].includes(employee.status));

  const [employeeId, setEmployeeId] = useState(defaultEmployeeId ?? "");
  const [policyId, setPolicyId] = useState(defaultPolicyId ?? "");
  const [newBalance, setNewBalance] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const policies = employeeId
    ? leaveService
        .getEligiblePolicies(employeeId, actorContext)
        .filter((policy) =>
          ["Annual", "Ledger", "Per Event", "Once Per Service"].includes(policy.scope),
        )
    : [];
  const employee = employees.find((record) => record.id === employeeId);
  const policy = policies.find((record) => record.id === policyId);
  const balance =
    employeeId && policyId
      ? leaveService.calculateBalance(employeeId, policyId, actorContext)
      : null;
  const isIndividualLimit = policy?.scope === "Per Event" || policy?.scope === "Once Per Service";
  const currentValue =
    employeeId && policyId && isIndividualLimit
      ? leaveService.getEmployeeEntitlementLimit(employeeId, policyId, actorContext)
      : (balance?.available ?? 0);
  const parsedBalance = Number(newBalance);
  const adjustment = balance && Number.isFinite(parsedBalance) ? parsedBalance - currentValue : 0;

  useEffect(() => {
    if (!open) return;
    setEmployeeId(defaultEmployeeId ?? "");
    setPolicyId(defaultPolicyId ?? "");
    setReason("");
  }, [defaultEmployeeId, defaultPolicyId, open]);

  useEffect(() => {
    if (!open || !employeeId || !policyId) {
      setNewBalance("");
      return;
    }
    const selectedPolicy = leaveService
      .getEligiblePolicies(employeeId, actorContext)
      .find((item) => item.id === policyId);
    setNewBalance(
      String(
        selectedPolicy?.scope === "Per Event" || selectedPolicy?.scope === "Once Per Service"
          ? leaveService.getEmployeeEntitlementLimit(employeeId, policyId, actorContext)
          : leaveService.calculateBalance(employeeId, policyId, actorContext).available,
      ),
    );
  }, [actorContext, employeeId, leaveService, open, policyId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!employeeId || !policyId || newBalance === "" || !reason.trim()) {
      toast.error("Complete the employee, leave type, new balance and reason.");
      return;
    }

    try {
      setIsSubmitting(true);
      await leaveService.setEmployeeAvailableBalanceAsync(
        employeeId,
        policyId,
        Number(newBalance),
        reason,
        currentUser.getActorContext(),
      );
      toast.success(
        `${policy?.name ?? "Leave"} ${isIndividualLimit ? "allowance" : "balance"} updated for ${employee?.preferredName}.`,
      );
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The balance could not be updated.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Edit Leave Balance
          </DialogTitle>
          <DialogDescription>
            {isIndividualLimit
              ? "Set the employee-specific allowance for this leave type. The reason and previous decision remain available for review."
              : "Set the employee's correct available balance. VIA will record the difference while keeping the previous history available for review."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="balance-employee">Employee</Label>
              <Select
                value={employeeId}
                onValueChange={(value) => {
                  setEmployeeId(value);
                  setPolicyId("");
                }}
                disabled={Boolean(defaultEmployeeId)}
              >
                <SelectTrigger id="balance-employee">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((record) => (
                    <SelectItem key={record.id} value={record.id}>
                      {record.preferredName} · {record.employeeNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="balance-policy">Leave type</Label>
              <Select
                value={policyId}
                onValueChange={setPolicyId}
                disabled={!employeeId || Boolean(defaultPolicyId)}
              >
                <SelectTrigger id="balance-policy">
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {policies.map((record) => (
                    <SelectItem key={record.id} value={record.id}>
                      {record.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {balance && (
            <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
              <div>
                <p className="text-muted-foreground">
                  {isIndividualLimit ? "Current allowance" : "Current available"}
                </p>
                <p className="mt-1 text-xl font-semibold tabular-nums">
                  {formatDays(currentValue)} days
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Change to record</p>
                <p
                  className={`mt-1 text-xl font-semibold tabular-nums ${
                    adjustment < 0 ? "text-destructive" : adjustment > 0 ? "text-emerald-700" : ""
                  }`}
                >
                  {adjustment > 0 ? "+" : ""}
                  {formatDays(adjustment)} days
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="new-balance">
              {isIndividualLimit ? "New individual allowance" : "New available balance"}
            </Label>
            <Input
              id="new-balance"
              type="number"
              step="0.5"
              value={newBalance}
              onChange={(event) => setNewBalance(event.target.value)}
              placeholder="Enter the correct balance"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="balance-reason">Reason for change</Label>
            <Textarea
              id="balance-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: HR verified three carried-forward days from the 2025 leave record."
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              This explanation will appear in the employee&apos;s balance activity and audit
              history.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || adjustment === 0}>
              {isSubmitting ? "Saving…" : "Save Balance"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
