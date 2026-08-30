import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Edit, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LeaveService } from "@/lib/data/leave-service";
import type { LeavePolicy } from "@/lib/data/leave-types";
import { useCurrentUser } from "@/lib/auth";
import { toast } from "sonner";

export function LeavePolicyConfig() {
  const currentUser = useCurrentUser();
  const leaveService = useMemo(() => new LeaveService(), []);

  const [policies, setPolicies] = useState<LeavePolicy[]>([]);
  const [editingPolicy, setEditingPolicy] = useState<LeavePolicy | null>(null);

  useEffect(() => {
    setPolicies(leaveService.getPolicies());
  }, [leaveService]);

  const handleEdit = (policy: LeavePolicy) => {
    // Clone it
    setEditingPolicy(JSON.parse(JSON.stringify(policy)));
  };

  const categoryBadgeVariant = (category: LeavePolicy["category"]) => {
    if (category === "Statutory") return "default" as const;
    if (category === "Company Policy") return "outline" as const;
    return "secondary" as const;
  };

  const handleToggleEnabled = (policy: LeavePolicy, next: boolean) => {
    try {
      leaveService.updatePolicy(policy.id, { isEnabled: next }, currentUser.getActorContext());
      toast.success(`${policy.name} ${next ? "turned on" : "turned off"}.`);
      setPolicies(leaveService.getPolicies());
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to update policy");
    }
  };

  const handleSave = () => {
    if (!editingPolicy) return;
    try {
      leaveService.updatePolicy(editingPolicy.id, editingPolicy, currentUser.getActorContext());
      toast.success(`${editingPolicy.name} updated for all staff covered by this policy.`);
      setPolicies(leaveService.getPolicies());
      setEditingPolicy(null);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to update policy");
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Leave Policies</CardTitle>
          <CardDescription>
            Set leave allowances, carry-over limits and notice periods for each leave type.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">
            The yearly allowance sets the starting balance and is used when checking leave requests.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Policy Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Yearly Allowance</TableHead>
                <TableHead>Carry-over Limit</TableHead>
                <TableHead>Notice Rules</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {p.code}
                  </TableCell>
                  <TableCell>
                    <Badge variant={categoryBadgeVariant(p.category)}>{p.category}</Badge>
                  </TableCell>
                  <TableCell>{p.isPaid ? "Yes" : "No"}</TableCell>
                  <TableCell>{p.baseEntitlementDays}</TableCell>
                  <TableCell>{p.carryForwardLimit}</TableCell>
                  <TableCell>
                    {p.noticeRules?.enabled ? (
                      <Badge
                        variant="outline"
                        className="border-amber-200 text-amber-700 bg-amber-50"
                      >
                        Enabled
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Disabled</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.isStatutory ? (
                      <span
                        title={`Required by ${p.legalBasis || "the Labour Law"} and cannot be disabled.`}
                      >
                        <Switch checked disabled />
                      </span>
                    ) : (
                      <Switch
                        checked={p.isEnabled}
                        onCheckedChange={(c) => handleToggleEnabled(p, c)}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(p)}>
                      <Edit className="h-4 w-4 mr-2" /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!editingPolicy} onOpenChange={(open) => !open && setEditingPolicy(null)}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingPolicy?.code && (
                <span className="text-xs font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                  {editingPolicy.code}
                </span>
              )}
              Edit Policy: {editingPolicy?.name}
            </DialogTitle>
            <DialogDescription>
              Update the company rules for this leave type. Changes to the yearly allowance will
              update the balance of every staff member covered by this policy.
            </DialogDescription>
          </DialogHeader>

          {editingPolicy && (
            <div className="space-y-6 py-4">
              <div className="border rounded-md p-3 bg-muted/20 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Code:</span>
                  <span className="text-xs font-mono">{editingPolicy.code}</span>
                  <Badge variant={categoryBadgeVariant(editingPolicy.category)}>
                    {editingPolicy.category}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {editingPolicy.legalBasis
                    ? `Legal basis: ${editingPolicy.legalBasis}`
                    : "Company policy, not required by law"}
                </p>
              </div>

              <div className="space-y-2">
                <Label>Policy Explanation</Label>
                <Textarea
                  required
                  value={editingPolicy.description}
                  onChange={(e) =>
                    setEditingPolicy({ ...editingPolicy, description: e.target.value })
                  }
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  This text is shown to HR and employees everywhere this leave type appears in the
                  app, so it should be self-explanatory: what it is, who qualifies, how many days,
                  and why.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Base Entitlement Days</Label>
                  <Input
                    type="number"
                    value={editingPolicy.baseEntitlementDays}
                    onChange={(e) =>
                      setEditingPolicy({
                        ...editingPolicy,
                        baseEntitlementDays: Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Carry-Forward Limit (Days)</Label>
                  <Input
                    type="number"
                    value={editingPolicy.carryForwardLimit}
                    onChange={(e) =>
                      setEditingPolicy({
                        ...editingPolicy,
                        carryForwardLimit: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>

              <div className="grid gap-4 rounded-md border bg-muted/20 p-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Balance Method</Label>
                  <Select
                    value={editingPolicy.accrualMode}
                    onValueChange={(value: LeavePolicy["accrualMode"]) =>
                      setEditingPolicy({ ...editingPolicy, accrualMode: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Upfront">Granted at the start of the year</SelectItem>
                      <SelectItem value="Monthly">Earned each month</SelectItem>
                      <SelectItem value="Per Pay Period">Earned each pay period</SelectItem>
                      <SelectItem value="Not Applicable">Does not use accrual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between rounded-md border bg-background p-3">
                  <div>
                    <Label>Paid Leave</Label>
                    <p className="text-xs text-muted-foreground">Included as paid time away.</p>
                  </div>
                  <Switch
                    checked={editingPolicy.isPaid}
                    onCheckedChange={(isPaid) => setEditingPolicy({ ...editingPolicy, isPaid })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border bg-background p-3">
                  <div>
                    <Label>Deduct From Balance</Label>
                    <p className="text-xs text-muted-foreground">
                      Turn off for attendance-only leave types.
                    </p>
                  </div>
                  <Switch
                    checked={editingPolicy.consumesBalance}
                    onCheckedChange={(consumesBalance) =>
                      setEditingPolicy({ ...editingPolicy, consumesBalance })
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border bg-background p-3">
                  <div>
                    <Label>Allow Negative Balance</Label>
                    <p className="text-xs text-muted-foreground">
                      Allow approved leave in advance.
                    </p>
                  </div>
                  <Switch
                    checked={editingPolicy.allowNegativeBalance}
                    onCheckedChange={(allowNegativeBalance) =>
                      setEditingPolicy({ ...editingPolicy, allowNegativeBalance })
                    }
                  />
                </div>
                {editingPolicy.allowNegativeBalance && (
                  <div className="space-y-2">
                    <Label>Maximum Advance Days</Label>
                    <Input
                      type="number"
                      min={0}
                      value={editingPolicy.maxNegativeBalance ?? 0}
                      onChange={(event) =>
                        setEditingPolicy({
                          ...editingPolicy,
                          maxNegativeBalance: Number(event.target.value),
                        })
                      }
                    />
                  </div>
                )}
              </div>

              <div className="space-y-3 rounded-md border p-4">
                <div>
                  <Label className="text-base font-semibold">Request Requirements</Label>
                  <p className="text-sm text-muted-foreground">
                    Choose what employees must provide before this leave can be submitted.
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-md bg-muted/30 p-3">
                  <Label>Supporting Document Required</Label>
                  <Switch
                    checked={editingPolicy.requiresAttachment}
                    onCheckedChange={(requiresAttachment) =>
                      setEditingPolicy({ ...editingPolicy, requiresAttachment })
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-md bg-muted/30 p-3">
                  <Label>Handover Contact Required</Label>
                  <Switch
                    checked={editingPolicy.requiresHandoverContact}
                    onCheckedChange={(requiresHandoverContact) =>
                      setEditingPolicy({ ...editingPolicy, requiresHandoverContact })
                    }
                  />
                </div>
                <div className="rounded-md bg-primary/5 p-3 text-sm">
                  Approval route: Employee submits, Supervisor reviews, then HR confirms.
                </div>
              </div>

              <div className="space-y-3 rounded-md border p-4">
                <div>
                  <Label className="text-base font-semibold">Who Qualifies</Label>
                  <p className="text-sm text-muted-foreground">
                    Leave blank when the policy applies to every employee.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Gender Requirement</Label>
                    <Select
                      value={editingPolicy.eligibility?.genderRestriction ?? "Any"}
                      onValueChange={(value) =>
                        setEditingPolicy({
                          ...editingPolicy,
                          eligibility: {
                            ...editingPolicy.eligibility,
                            genderRestriction:
                              value === "Any" ? undefined : (value as "Male" | "Female"),
                          },
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Any">Everyone</SelectItem>
                        <SelectItem value="Female">Female employees</SelectItem>
                        <SelectItem value="Male">Male employees</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Minimum Service (Months)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={editingPolicy.eligibility?.minimumServiceMonths ?? 0}
                      onChange={(event) =>
                        setEditingPolicy({
                          ...editingPolicy,
                          eligibility: {
                            ...editingPolicy.eligibility,
                            minimumServiceMonths: Number(event.target.value) || undefined,
                          },
                        })
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md bg-muted/30 p-3">
                  <Label>Omani Employees Only</Label>
                  <Switch
                    checked={editingPolicy.eligibility?.omaniOnly ?? false}
                    onCheckedChange={(omaniOnly) =>
                      setEditingPolicy({
                        ...editingPolicy,
                        eligibility: { ...editingPolicy.eligibility, omaniOnly },
                      })
                    }
                  />
                </div>
              </div>

              <div className="border rounded-md p-4 space-y-4 bg-muted/20">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-semibold">Notice Period Rules</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically refuse requests that violate notice requirements.
                    </p>
                  </div>
                  <Switch
                    checked={editingPolicy.noticeRules?.enabled ?? false}
                    onCheckedChange={(c) => {
                      setEditingPolicy({
                        ...editingPolicy,
                        noticeRules: {
                          enabled: c,
                          shortLeaveMaxDays: editingPolicy.noticeRules?.shortLeaveMaxDays || 5,
                          shortLeaveNoticeDays:
                            editingPolicy.noticeRules?.shortLeaveNoticeDays || 14,
                          longLeaveNoticeDays: editingPolicy.noticeRules?.longLeaveNoticeDays || 60,
                        },
                      });
                    }}
                  />
                </div>

                {editingPolicy.noticeRules?.enabled && (
                  <div className="space-y-4 mt-4 pt-4 border-t">
                    <div className="space-y-2">
                      <Label>Short Leave Threshold (Days)</Label>
                      <Input
                        type="number"
                        value={editingPolicy.noticeRules.shortLeaveMaxDays}
                        onChange={(e) =>
                          setEditingPolicy({
                            ...editingPolicy,
                            noticeRules: {
                              ...editingPolicy.noticeRules!,
                              shortLeaveMaxDays: Number(e.target.value),
                            },
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Requests up to this many working days are considered "Short Leave".
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Short Leave Notice Required (Days)</Label>
                        <Input
                          type="number"
                          value={editingPolicy.noticeRules.shortLeaveNoticeDays}
                          onChange={(e) =>
                            setEditingPolicy({
                              ...editingPolicy,
                              noticeRules: {
                                ...editingPolicy.noticeRules!,
                                shortLeaveNoticeDays: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Long Leave Notice Required (Days)</Label>
                        <Input
                          type="number"
                          value={editingPolicy.noticeRules.longLeaveNoticeDays}
                          onChange={(e) =>
                            setEditingPolicy({
                              ...editingPolicy,
                              noticeRules: {
                                ...editingPolicy.noticeRules!,
                                longLeaveNoticeDays: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="bg-primary/5 p-3 rounded text-sm text-primary flex gap-2 items-start mt-2 border border-primary/20">
                      <Info className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        Requests for{" "}
                        <strong>{editingPolicy.noticeRules.shortLeaveMaxDays} days or fewer</strong>{" "}
                        will require{" "}
                        <strong>
                          {editingPolicy.noticeRules.shortLeaveNoticeDays} calendar days
                        </strong>{" "}
                        notice.
                        <br />
                        Requests for{" "}
                        <strong>
                          more than {editingPolicy.noticeRules.shortLeaveMaxDays} days
                        </strong>{" "}
                        will require{" "}
                        <strong>
                          {editingPolicy.noticeRules.longLeaveNoticeDays} calendar days
                        </strong>{" "}
                        notice.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {editingPolicy.payTiers && (
                <div className="border rounded-md p-4 space-y-4 bg-muted/20">
                  <div>
                    <Label className="text-base font-semibold">Sick Pay Tiers (Art. 82)</Label>
                    <p className="text-sm text-muted-foreground">
                      The percentage of wage paid automatically steps down the longer a sick leave
                      runs across the year.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {editingPolicy.payTiers.map((tier, idx) => (
                      <div key={idx} className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">From Day</Label>
                          <Input
                            type="number"
                            value={tier.fromDay}
                            onChange={(e) => {
                              const payTiers = editingPolicy.payTiers!.map((t, i) =>
                                i === idx ? { ...t, fromDay: Number(e.target.value) } : t,
                              );
                              setEditingPolicy({ ...editingPolicy, payTiers });
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">To Day</Label>
                          <Input
                            type="number"
                            value={tier.toDay}
                            onChange={(e) => {
                              const payTiers = editingPolicy.payTiers!.map((t, i) =>
                                i === idx ? { ...t, toDay: Number(e.target.value) } : t,
                              );
                              setEditingPolicy({ ...editingPolicy, payTiers });
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Pay Percent</Label>
                          <Input
                            type="number"
                            value={tier.payPercentage}
                            onChange={(e) => {
                              const payTiers = editingPolicy.payTiers!.map((t, i) =>
                                i === idx ? { ...t, payPercentage: Number(e.target.value) } : t,
                              );
                              setEditingPolicy({ ...editingPolicy, payTiers });
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPolicy(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
