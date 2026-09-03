import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Employee } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import { Edit2, CheckCircle2, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm, useFieldArray } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { EmployeeService } from "@/lib/data/employee-service";
import { useCurrentUser } from "@/lib/auth";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/status-badge";

const personalFormSchema = z.object({
  preferredName: z.string().min(1),
  phone: z.string().optional(),
  personalEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  address: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(["Male", "Female"]).optional(),
  nationality: z.string().optional(),
  maritalStatus: z.enum(["Single", "Married", "Divorced", "Widowed"]).optional(),
  emergencyContacts: z
    .array(
      z.object({
        name: z.string().min(1),
        relationship: z.string().min(1),
        phone: z.string().min(1),
      }),
    )
    .optional(),
  dependants: z
    .array(
      z.object({
        name: z.string().min(1),
        relationship: z.string().min(1),
        dateOfBirth: z.string().min(1),
      }),
    )
    .optional(),
  changeReason: z.string().optional(),
});

function profileFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    preferredName: "preferred name",
    phone: "phone number",
    personalEmail: "personal email",
    address: "residential address",
    dateOfBirth: "date of birth",
    gender: "gender",
    nationality: "nationality",
    maritalStatus: "marital status",
    emergencyContacts: "emergency contacts",
    dependants: "dependants",
  };
  return labels[field] || field.replace(/([A-Z])/g, " $1").toLowerCase();
}

export function PersonalTab({
  employee,
  onChanged,
}: {
  employee: Employee;
  onChanged?: () => void;
}) {
  const currentUser = useCurrentUser();
  const employeeService = useMemo(() => new EmployeeService(), []);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [, setRefresh] = useState(0);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const changeRequests = employeeService
    .getProfileChangeRequests(employee.id, currentUser.getActorContext())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pendingRequests = changeRequests.filter((request) => request.status === "Pending");
  const hasPending = pendingRequests.length > 0;

  const form = useForm<z.infer<typeof personalFormSchema>>({
    resolver: zodResolver(personalFormSchema),
    defaultValues: {
      preferredName: employee.preferredName || "",
      phone: employee.phone || "",
      personalEmail: employee.personalEmail || "",
      address: employee.address || "",
      dateOfBirth: employee.dateOfBirth || "",
      gender: employee.gender,
      nationality: employee.nationality || "",
      maritalStatus: employee.maritalStatus,
      emergencyContacts: employee.emergencyContacts || [],
      dependants: employee.dependants || [],
      changeReason: "",
    },
  });

  useEffect(() => {
    form.reset({
      preferredName: employee.preferredName || "",
      phone: employee.phone || "",
      personalEmail: employee.personalEmail || "",
      address: employee.address || "",
      dateOfBirth: employee.dateOfBirth || "",
      gender: employee.gender,
      nationality: employee.nationality || "",
      maritalStatus: employee.maritalStatus,
      emergencyContacts: employee.emergencyContacts || [],
      dependants: employee.dependants || [],
      changeReason: "",
    });
  }, [employee, form]);

  const {
    fields: ecFields,
    append: appendEc,
    remove: removeEc,
  } = useFieldArray({
    control: form.control,
    name: "emergencyContacts",
  });

  const {
    fields: depFields,
    append: appendDep,
    remove: removeDep,
  } = useFieldArray({
    control: form.control,
    name: "dependants",
  });

  const getActorContext = (reason: string) => ({
    actor: {
      userId: currentUser!.userId,
      employeeId: currentUser!.employeeId,
      displayName: currentUser!.displayName,
      roles: currentUser!.assignedRoles,
      activeRole: currentUser!.activeRole,
    },
    reason,
  });

  const onSubmit = async (values: z.infer<typeof personalFormSchema>) => {
    try {
      if (!currentUser) return;

      const changes: Partial<Employee> = {};
      if (values.preferredName !== employee.preferredName)
        changes.preferredName = values.preferredName;
      if (values.phone !== employee.phone) changes.phone = values.phone;
      if (values.personalEmail !== employee.personalEmail)
        changes.personalEmail = values.personalEmail;
      if (values.address !== employee.address) changes.address = values.address;
      if (values.dateOfBirth !== employee.dateOfBirth) changes.dateOfBirth = values.dateOfBirth;
      if (values.gender !== employee.gender) changes.gender = values.gender;
      if (values.nationality !== employee.nationality) changes.nationality = values.nationality;
      if (values.maritalStatus !== employee.maritalStatus)
        changes.maritalStatus = values.maritalStatus;
      if (
        JSON.stringify(values.emergencyContacts || []) !==
        JSON.stringify(employee.emergencyContacts || [])
      ) {
        changes.emergencyContacts = values.emergencyContacts;
      }
      if (JSON.stringify(values.dependants || []) !== JSON.stringify(employee.dependants || [])) {
        changes.dependants = values.dependants;
      }
      if (Object.keys(changes).length === 0) throw new Error("No changes were made.");

      if (isSelf) {
        await employeeService.requestProfileChangeAsync(
          employee.id,
          changes,
          getActorContext("Self-service profile update"),
        );
        toast.success("Profile changes sent to HR for review");
      } else {
        await employeeService.updatePersonalRecordAsync(
          employee.id,
          changes,
          values.changeReason || "",
          getActorContext(values.changeReason || "Personal record corrected by HR"),
        );
        toast.success("Personal details saved");
      }
      setIsEditOpen(false);
      setRefresh((value) => value + 1);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit request");
    }
  };

  const handleApprove = async (requestId: string) => {
    try {
      await employeeService.decideProfileChangeAsync(
        requestId,
        "Approved",
        "Verified and approved",
        getActorContext("Approval"),
      );
      toast.success("Changes approved");
      setRefresh((value) => value + 1);
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve changes");
    }
  };

  const handleReject = async () => {
    if (!rejectingId) return;
    try {
      await employeeService.decideProfileChangeAsync(
        rejectingId,
        "Rejected",
        rejectionReason,
        getActorContext(rejectionReason),
      );
      toast.success("Changes rejected");
      setRejectingId(null);
      setRejectionReason("");
      setRefresh((value) => value + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reject changes");
    }
  };

  const canApprove = currentUser?.activeRole === "HR" || currentUser?.activeRole === "Super Admin";
  const isSelf = currentUser?.employeeId === employee.id;

  return (
    <div className="space-y-6">
      {hasPending && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader>
            <CardTitle className="text-orange-800 text-base">
              Pending Verification Requests
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingRequests.map((req) => (
              <div
                key={req.id}
                className="p-4 bg-white rounded-md border flex items-center justify-between"
              >
                <div>
                  <div className="text-sm font-medium mb-1">Requested by {req.requestedBy}</div>
                  <div className="text-xs text-muted-foreground break-all">
                    {Object.keys(req.changes).map(profileFieldLabel).join(", ")}.
                  </div>
                </div>
                {canApprove && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-emerald-600"
                      onClick={() => handleApprove(req.id)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() => setRejectingId(req.id)}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Personal Details</CardTitle>
          {(isSelf || canApprove) && (
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={hasPending}
                  title={hasPending ? "Cannot edit while changes are pending" : "Edit Details"}
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Edit Personal Details</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="preferredName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Preferred Name *</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Personal Phone</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="personalEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Personal Email</FormLabel>
                            <FormControl>
                              <Input type="email" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="dateOfBirth"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Date of Birth</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="gender"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Gender</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value ?? ""}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="Male">Male</SelectItem>
                                <SelectItem value="Female">Female</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="nationality"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nationality</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="maritalStatus"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Marital Status</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value ?? ""}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="Single">Single</SelectItem>
                                <SelectItem value="Married">Married</SelectItem>
                                <SelectItem value="Divorced">Divorced</SelectItem>
                                <SelectItem value="Widowed">Widowed</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Residential Address</FormLabel>
                          <FormControl>
                            <Textarea {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium">Emergency Contacts</h4>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => appendEc({ name: "", relationship: "", phone: "" })}
                        >
                          Add Contact
                        </Button>
                      </div>
                      {ecFields.map((item, index) => (
                        <div key={item.id} className="grid gap-2 sm:grid-cols-3 sm:items-end">
                          <FormField
                            control={form.control}
                            name={`emergencyContacts.${index}.name`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Name</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`emergencyContacts.${index}.relationship`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Relation</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <div className="flex items-center gap-2">
                            <FormField
                              control={form.control}
                              name={`emergencyContacts.${index}.phone`}
                              render={({ field }) => (
                                <FormItem className="flex-1">
                                  <FormLabel>Phone</FormLabel>
                                  <FormControl>
                                    <Input {...field} />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeEc(index)}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium">Dependants</h4>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => appendDep({ name: "", relationship: "", dateOfBirth: "" })}
                        >
                          Add Dependant
                        </Button>
                      </div>
                      {depFields.map((item, index) => (
                        <div key={item.id} className="grid gap-2 sm:grid-cols-3 sm:items-end">
                          <FormField
                            control={form.control}
                            name={`dependants.${index}.name`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Name</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`dependants.${index}.relationship`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Relation</FormLabel>
                                <FormControl>
                                  <Input {...field} />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <div className="flex items-center gap-2">
                            <FormField
                              control={form.control}
                              name={`dependants.${index}.dateOfBirth`}
                              render={({ field }) => (
                                <FormItem className="flex-1">
                                  <FormLabel>DOB</FormLabel>
                                  <FormControl>
                                    <Input type="date" {...field} />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeDep(index)}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {!isSelf && (
                      <FormField
                        control={form.control}
                        name="changeReason"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Reason for change *</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="For example: Corrected after checking the employee's documents"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    <div className="flex justify-end">
                      <Button type="submit">
                        {isSelf ? "Send to HR for review" : "Save changes"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Preferred Name</div>
              <div className="font-medium">{employee.preferredName}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Phone Number</div>
              <div className="font-medium">{employee.phone || "-"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Personal Email</div>
              <div className="font-medium">{employee.personalEmail || "-"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Date of Birth</div>
              <div className="font-medium">{employee.dateOfBirth || "-"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Gender</div>
              <div className="font-medium">{employee.gender || "-"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Nationality</div>
              <div className="font-medium">{employee.nationality || "-"}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Marital Status</div>
              <div className="font-medium">{employee.maritalStatus || "-"}</div>
            </div>
            <div className="col-span-2">
              <div className="text-muted-foreground">Residential Address</div>
              <div className="font-medium">{employee.address || "-"}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {changeRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Profile Update History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {changeRequests.slice(0, 8).map((request) => (
              <div
                key={request.id}
                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {Object.keys(request.changes).map(profileFieldLabel).join(", ")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Sent {new Date(request.createdAt).toLocaleDateString()}
                    {request.reviewNotes ? ` · ${request.reviewNotes}` : ""}
                  </p>
                </div>
                <StatusBadge status={request.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={Boolean(rejectingId)}
        onOpenChange={(open) => {
          if (!open) {
            setRejectingId(null);
            setRejectionReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject profile changes</DialogTitle>
            <DialogDescription>
              Explain what the employee should correct before submitting again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="profile-rejection-reason" className="text-sm font-medium">
              Reason
            </label>
            <Textarea
              id="profile-rejection-reason"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Give a clear reason for the employee"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rejectionReason.trim().length < 3}
              onClick={handleReject}
            >
              Reject changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
