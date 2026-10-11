import { SafeForm } from "@/components/ui/safe-form";
import { dependantSchema } from "@/lib/data/dependants";
import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Employee } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import { Edit2, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { changedRecordFields } from "@/lib/data/change-reason-policy";
import { useCurrentUser } from "@/lib/auth";
import { toast } from "sonner";
import { StatusBadge } from "@/components/ui/status-badge";

const personalFormSchema = z.object({
  preferredName: z.string().min(1),
  phone: z.string().optional(),
  whatsappNumber: z.string().trim().max(50).optional(),
  personalEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  address: z.string().optional(),
  homeCountryPhone: z.string().max(50).optional(),
  homeCountryAddress: z.string().max(1000).optional(),
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
  dependants: z.array(dependantSchema).max(20).optional(),
});

function profileFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    preferredName: "preferred name",
    phone: "phone number",
    whatsappNumber: "WhatsApp number",
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
  editRequested = false,
  onEditOpened,
  onOpenDocuments,
}: {
  employee: Employee;
  onChanged?: () => void;
  editRequested?: boolean;
  onEditOpened?: () => void;
  onOpenDocuments?: () => void;
}) {
  const currentUser = useCurrentUser();
  const employeeService = useMemo(() => new EmployeeService(), []);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [, setRefresh] = useState(0);

  const changeRequests = employeeService
    .getProfileChangeRequests(employee.id, currentUser.getActorContext())
    .filter((request) => request.status !== "Pending")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  useEffect(() => {
    if (!editRequested) return;
    setIsEditOpen(true);
    onEditOpened?.();
  }, [editRequested, onEditOpened]);

  const form = useForm<z.infer<typeof personalFormSchema>>({
    resolver: zodResolver(personalFormSchema),
    defaultValues: {
      preferredName: employee.preferredName || "",
      phone: employee.phone || "",
      whatsappNumber: employee.whatsappNumber || "",
      personalEmail: employee.personalEmail || "",
      address: employee.address || "",
      homeCountryPhone: employee.homeCountryPhone || "",
      homeCountryAddress: employee.homeCountryAddress || "",
      dateOfBirth: employee.dateOfBirth || "",
      gender: employee.gender,
      nationality: employee.nationality || "",
      maritalStatus: employee.maritalStatus,
      emergencyContacts: employee.emergencyContacts || [],
      dependants: employee.dependants || [],
    },
  });

  useEffect(() => {
    form.reset({
      preferredName: employee.preferredName || "",
      phone: employee.phone || "",
      whatsappNumber: employee.whatsappNumber || "",
      personalEmail: employee.personalEmail || "",
      address: employee.address || "",
      homeCountryPhone: employee.homeCountryPhone || "",
      homeCountryAddress: employee.homeCountryAddress || "",
      dateOfBirth: employee.dateOfBirth || "",
      gender: employee.gender,
      nationality: employee.nationality || "",
      maritalStatus: employee.maritalStatus,
      emergencyContacts: employee.emergencyContacts || [],
      dependants: employee.dependants || [],
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
      if ((values.whatsappNumber || "") !== (employee.whatsappNumber || ""))
        changes.whatsappNumber = values.whatsappNumber || "";
      if (values.personalEmail !== employee.personalEmail)
        changes.personalEmail = values.personalEmail;
      if (values.address !== employee.address) changes.address = values.address;
      if (values.homeCountryPhone !== employee.homeCountryPhone)
        changes.homeCountryPhone = values.homeCountryPhone;
      if (values.homeCountryAddress !== employee.homeCountryAddress)
        changes.homeCountryAddress = values.homeCountryAddress;
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
      const actualFields = new Set(changedRecordFields({ ...employee }, { ...changes }));
      for (const key of Object.keys(changes) as Array<keyof Employee>) {
        if (!actualFields.has(key)) delete changes[key];
      }
      if (Object.keys(changes).length === 0) throw new Error("No changes were made.");

      await employeeService.updatePersonalRecordAsync(
        employee.id,
        changes,
        "",
        getActorContext("Personal details updated"),
      );
      toast.success("Personal details saved");
      setIsEditOpen(false);
      setRefresh((value) => value + 1);
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit request");
    }
  };

  const canManagePersonalDetails =
    currentUser?.activeRole === "HR" || currentUser?.activeRole === "Super Admin";
  const isSelf = currentUser?.employeeId === employee.id;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Personal Details</CardTitle>
          {(isSelf || canManagePersonalDetails) && (
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" title="Edit Details">
                  <Edit2 className="h-4 w-4" />
                  Edit details
                </Button>
              </DialogTrigger>
              <DialogContent
                aria-describedby="identity-document-help"
                className="max-w-2xl max-h-[90vh] overflow-y-auto"
              >
                <DialogHeader>
                  <DialogTitle>Edit Personal Details</DialogTitle>
                  <DialogDescription id="identity-document-help">
                    Contact changes save immediately. HR confirms identity corrections with your
                    passport or ID in Documents.
                  </DialogDescription>
                  {onOpenDocuments && (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto justify-start p-0"
                      onClick={() => {
                        setIsEditOpen(false);
                        onOpenDocuments();
                      }}
                    >
                      Open documents
                    </Button>
                  )}
                </DialogHeader>
                <Form {...form}>
                  <SafeForm onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4">
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
                              <Input type="tel" autoComplete="tel" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="whatsappNumber"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>WhatsApp number</FormLabel>
                            <FormControl>
                              <Input type="tel" placeholder="Include country code" {...field} />
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
                              <Input
                                type="date"
                                {...field}
                                readOnly
                                aria-describedby="identity-document-help"
                              />
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
                              <Input
                                {...field}
                                readOnly
                                aria-describedby="identity-document-help"
                              />
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
                          <FormLabel>Local residential address</FormLabel>
                          <FormControl>
                            <Textarea {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {(
                      [
                        ["homeCountryPhone", "Home-country phone"],
                        ["homeCountryAddress", "Home-country address"],
                      ] as const
                    ).map(([name, label]) => (
                      <FormField
                        key={name}
                        control={form.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{label}</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
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
                          {(["phone", "nationality", "email"] as const).map((key) => (
                            <FormField
                              key={key}
                              control={form.control}
                              name={`dependants.${index}.${key}`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>
                                    {key === "phone"
                                      ? "Phone (or guardian's phone)"
                                      : key === "nationality"
                                        ? "Nationality"
                                        : "Email (optional)"}
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      value={field.value ?? ""}
                                      type={
                                        key === "email" ? "email" : key === "phone" ? "tel" : "text"
                                      }
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          ))}
                          <FormField
                            control={form.control}
                            name={`dependants.${index}.visaRequired`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Visa required?</FormLabel>
                                <FormControl>
                                  <select
                                    className="h-10 w-full rounded-md border bg-background px-3"
                                    {...field}
                                    value={field.value ?? "Not confirmed"}
                                  >
                                    <option>Not confirmed</option>
                                    <option>Yes</option>
                                    <option>No</option>
                                  </select>
                                </FormControl>
                                <FormMessage />
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

                    <div className="flex justify-end">
                      <Button type="submit">Save changes</Button>
                    </div>
                  </SafeForm>
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
              <div className="text-muted-foreground">WhatsApp number</div>
              <div className="font-medium">{employee.whatsappNumber || "—"}</div>
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
              <div className="mt-3 text-sm text-muted-foreground">Home-country phone</div>
              <div>{employee.homeCountryPhone || "—"}</div>
              <div className="mt-3 text-sm text-muted-foreground">Home-country address</div>
              <div>{employee.homeCountryAddress || "—"}</div>
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
    </div>
  );
}
