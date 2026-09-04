import { useEffect, useRef, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import {
  BriefcaseBusiness,
  CheckCircle2,
  Circle,
  FileUp,
  Landmark,
  User,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { OnboardingService } from "@/lib/data/onboarding-service";
import { LifecycleTaskService } from "@/lib/data/lifecycle-task-service";
import { MasterDataService } from "@/lib/data/master-data";
import type { OnboardingTask } from "@/lib/data/onboarding-types";
import type { DocumentType, Employee, MasterRecord } from "@/lib/data/types";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const employmentSchema = z.object({
  staffEntryType: z.enum(["New Employee", "Existing Employee"]),
  legalName: z.string().trim().min(2, "Your legal name is required"),
  preferredName: z.string().trim().min(1, "Your preferred name is required"),
  startDate: z.string().min(1, "Your VIA start date is required"),
  departmentId: z.string().uuid("Select your department"),
  positionId: z.string().uuid("Select your position"),
  locationId: z.string().uuid("Select your work location"),
  employmentTypeId: z.string().uuid("Select your employment type"),
  lineManagerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter your supervisor's VIA email")
    .refine((value) => value.endsWith("@via-int.com"), "Use a @via-int.com email"),
  visaRequired: z.boolean(),
});

const personalSchema = z.object({
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  gender: z.enum(["Male", "Female"]),
  nationality: z.string().min(1, "Nationality is required"),
  maritalStatus: z.enum(["Single", "Married", "Divorced", "Widowed"]),
  phone: z.string().min(1, "A contact phone number is required"),
  personalEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  address: z.string().min(1, "Residential address is required"),
  emergencyContacts: z
    .array(
      z.object({
        name: z.string().min(1),
        relationship: z.string().min(1),
        phone: z.string().min(1),
      }),
    )
    .min(1, "At least one emergency contact is required"),
  dependants: z
    .array(
      z.object({
        name: z.string().min(1),
        relationship: z.string().min(1),
        dateOfBirth: z.string().min(1),
      }),
    )
    .optional(),
});

const bankSchema = z.object({
  bankName: z.string().min(1, "Bank name is required"),
  accountNumber: z.string().min(1, "Account number is required"),
  iban: z.string().min(1, "IBAN is required"),
  swiftCode: z.string().optional(),
  branch: z.string().optional(),
});

interface Props {
  employeeId: string;
  onAllComplete?: () => void;
  compact?: boolean;
}

export function SelfServiceOnboardingForm({ employeeId, onAllComplete, compact }: Props) {
  const { getActorContext } = useCurrentUser();
  const [empService] = useState(() => new EmployeeService());
  const [obService] = useState(() => new OnboardingService());
  const [taskActions] = useState(() => new LifecycleTaskService());
  const [masterData] = useState(() => new MasterDataService());
  const [, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    const context = getActorContext();
    setLoading(true);
    setLoadError("");
    void Promise.all([
      empService.hydrateCompatibilityCache(context),
      obService.hydrateCompatibilityCache(context),
      masterData.hydrateCompatibilityCache(),
    ])
      .then(() => {
        if (active) setRefreshKey((value) => value + 1);
      })
      .catch((error) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : "Onboarding could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [employeeId, empService, getActorContext, masterData, obService]);

  const employee = empService.getById(employeeId, getActorContext());
  const obCase = obService.getCaseByEmployeeId(employeeId, getActorContext());
  const tasks = obService.getSelfServiceTasks(employeeId, getActorContext());

  const isTaskDone = (t: OnboardingTask) => t.status === "Completed" || t.status === "Waived";
  const doneCount = tasks.filter(isTaskDone).length;
  const allDone = tasks.length > 0 && doneCount === tasks.length;

  const employmentTask = tasks.find((t) => t.selfServiceFormKey === "employment_details");
  const personalTask = tasks.find((t) => t.selfServiceFormKey === "personal_details");
  const bankTask = tasks.find((t) => t.selfServiceFormKey === "bank_details");
  const documentTasks = tasks.filter((t) => t.selfServiceFormKey === "document_upload");

  const refresh = () => setRefreshKey((k) => k + 1);
  const releaseIfEmployeeSetupComplete = (updatedTasks: OnboardingTask[]) => {
    if (!onAllComplete) return;
    const stillOutstanding = updatedTasks.some(
      (item) =>
        item.ownerRole === "Employee" &&
        item.isMandatory &&
        item.status !== "Completed" &&
        item.status !== "Waived",
    );
    if (!stillOutstanding) onAllComplete();
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Loading your onboarding checklist...
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-10 text-center text-destructive">{loadError}</CardContent>
      </Card>
    );
  }

  if (!employee) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          No employee record is linked to this account.
        </CardContent>
      </Card>
    );
  }

  if (!obCase) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <CheckCircle2 className="h-8 w-8 text-muted-foreground/40" />
          <p className="font-medium">Nothing to complete here</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            There is no onboarding checklist on your record. This page only applies to new hires
            still completing their intake. Once that is finished, or if you joined before this
            checklist existed, it stays empty like this.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (obCase.status === "Cancelled") {
    return (
      <Card className="border-rose-200 bg-rose-50/40">
        <CardContent className="py-10 text-center">
          <XCircle className="mx-auto mb-3 h-8 w-8 text-rose-600" />
          <p className="font-medium">This onboarding process was cancelled</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            You cannot submit further onboarding information. Contact HR if you believe this is
            incorrect.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (obCase.status === "Completed") {
    return (
      <Card className="border-emerald-200 bg-emerald-50/40">
        <CardContent className="py-10 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-600" />
          <p className="font-medium">Your onboarding is complete</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Your submitted details and documents are now part of your employee profile. Use My
            Profile when you need to request a future change.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (tasks.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <CheckCircle2 className="h-8 w-8 text-success" />
          <p className="font-medium">Nothing for you to submit</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Your onboarding case has no items assigned to you right now. HR, IT, or your manager may
            still have steps of their own in progress.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={compact ? "space-y-4" : "space-y-6"}>
      <Card
        className={
          allDone ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/50"
        }
      >
        <CardContent className="py-4 flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">
              {allDone
                ? "All required onboarding details submitted"
                : "Complete your onboarding details"}
            </div>
            <div className="text-sm text-muted-foreground">
              {allDone
                ? "Thank you - HR and Finance have what they need to set up your record and payroll."
                : "HR and Finance need the information below before your first pay run and to activate your record."}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-28 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${(doneCount / tasks.length) * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium">
              {doneCount}/{tasks.length}
            </span>
          </div>
        </CardContent>
      </Card>

      {employmentTask && (
        <EmploymentDetailsSection
          employee={employee}
          task={employmentTask}
          done={isTaskDone(employmentTask)}
          departments={masterData.list("departments", false)}
          positions={masterData.list("positions", false)}
          locations={masterData.list("locations", false)}
          employmentTypes={masterData.list("employmentTypes", false)}
          onSubmit={async (details) => {
            try {
              const updated = await obService.submitSelfServiceAsync(
                obCase.id,
                employmentTask.id,
                { kind: "employment_details", details },
                getActorContext(),
              );
              releaseIfEmployeeSetupComplete(updated.tasks);
              toast.success("Employment details saved");
              refresh();
            } catch (error: unknown) {
              toast.error(
                error instanceof Error ? error.message : "Failed to save employment details",
              );
            }
          }}
        />
      )}

      {personalTask && (
        <PersonalDetailsSection
          employee={employee}
          task={personalTask}
          done={isTaskDone(personalTask)}
          onSubmit={async (changes) => {
            try {
              const updated = await obService.submitSelfServiceAsync(
                obCase.id,
                personalTask.id,
                {
                  kind: "personal_details",
                  details: {
                    dateOfBirth: changes.dateOfBirth,
                    gender: changes.gender,
                    nationality: changes.nationality,
                    maritalStatus: changes.maritalStatus,
                    phone: changes.phone,
                    ...(changes.personalEmail ? { personalEmail: changes.personalEmail } : {}),
                    address: changes.address,
                    emergencyContacts: changes.emergencyContacts,
                    ...(changes.dependants ? { dependants: changes.dependants } : {}),
                  },
                },
                getActorContext(),
              );
              releaseIfEmployeeSetupComplete(updated.tasks);
              toast.success("Personal details saved");
              refresh();
            } catch (error: unknown) {
              toast.error(
                error instanceof Error ? error.message : "Failed to save personal details",
              );
            }
          }}
        />
      )}

      {bankTask && (
        <BankDetailsSection
          employee={employee}
          task={bankTask}
          done={isTaskDone(bankTask)}
          onSubmit={async (bankDetails) => {
            try {
              const updated = await obService.submitSelfServiceAsync(
                obCase.id,
                bankTask.id,
                {
                  kind: "bank_details",
                  details: {
                    bankName: bankDetails.bankName,
                    accountNumber: bankDetails.accountNumber,
                    iban: bankDetails.iban,
                    ...(bankDetails.swiftCode ? { swiftCode: bankDetails.swiftCode } : {}),
                    ...(bankDetails.branch ? { branch: bankDetails.branch } : {}),
                  },
                },
                getActorContext(),
              );
              releaseIfEmployeeSetupComplete(updated.tasks);
              toast.success("Bank details saved");
              refresh();
            } catch (error: unknown) {
              toast.error(error instanceof Error ? error.message : "Failed to save bank details");
            }
          }}
        />
      )}

      {documentTasks.map((task) => (
        <DocumentUploadSection
          key={task.id}
          task={task}
          done={isTaskDone(task)}
          onUpload={async (file, metadata) => {
            try {
              if (file.size > MAX_FILE_SIZE) throw new Error("File exceeds the 10 MB limit");
              const updated = await taskActions.completeOnboardingDocumentTask(
                obCase.id,
                task.id,
                employeeId,
                file,
                { type: task.documentType || "other", ...metadata },
                getActorContext(),
              );
              releaseIfEmployeeSetupComplete(updated.tasks);
              toast.success("Document uploaded - pending HR verification");
              refresh();
            } catch (error: unknown) {
              toast.error(error instanceof Error ? error.message : "Upload failed");
            }
          }}
        />
      ))}
    </div>
  );
}

function databaseId(record: MasterRecord): string {
  return record.databaseId ?? record.id;
}

function employeeSelectableRecords(records: MasterRecord[]): MasterRecord[] {
  return records.filter((record) => record.code !== "SELF-SETUP");
}

function selectedMasterId(records: MasterRecord[], name: string): string {
  const record = records.find((item) => item.name === name);
  return record ? databaseId(record) : "";
}

function EmploymentDetailsSection({
  employee,
  task,
  done,
  departments,
  positions,
  locations,
  employmentTypes,
  onSubmit,
}: {
  employee: Employee;
  task: OnboardingTask;
  done: boolean;
  departments: MasterRecord[];
  positions: MasterRecord[];
  locations: MasterRecord[];
  employmentTypes: MasterRecord[];
  onSubmit: (details: z.infer<typeof employmentSchema>) => void;
}) {
  const form = useForm<z.infer<typeof employmentSchema>>({
    resolver: zodResolver(employmentSchema),
    defaultValues: {
      staffEntryType: employee.staffEntryType ?? "Existing Employee",
      legalName: employee.legalName,
      preferredName: employee.preferredName,
      startDate: employee.startDate,
      departmentId: selectedMasterId(departments, employee.department),
      positionId: selectedMasterId(positions, employee.position),
      locationId: selectedMasterId(locations, employee.location),
      employmentTypeId: selectedMasterId(employmentTypes, employee.employmentType),
      lineManagerEmail: employee.proposedLineManagerEmail ?? "",
      visaRequired: true,
    },
  });
  const entryType = form.watch("staffEntryType");

  const selectField = (
    name: "departmentId" | "positionId" | "locationId" | "employmentTypeId",
    label: string,
    records: MasterRecord[],
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label} *</FormLabel>
          <Select value={field.value} onValueChange={field.onChange} disabled={done}>
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {employeeSelectableRecords(records).map((record) => (
                <SelectItem key={databaseId(record)} value={databaseId(record)}>
                  {record.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <SectionShell
      icon={<BriefcaseBusiness className="h-4 w-4" />}
      title={task.title}
      description="Tell us when you joined VIA and where you work. HR will review your selections and can correct them later."
      done={done}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="staffEntryType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Are you joining VIA now or were you already employed? *</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={done}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="New Employee">I am a new employee</SelectItem>
                    <SelectItem value="Existing Employee">I already worked for VIA</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  {entryType === "New Employee"
                    ? "New employees follow the waiting periods in VIA's leave policies. Annual leave is normally available after three completed months, unless HR changes the policy."
                    : "Enter your original VIA joining date. Your service history will be used when checking leave eligibility."}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="legalName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full legal name *</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={done} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="preferredName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Preferred name *</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={done} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="startDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>VIA start date *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} disabled={done} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lineManagerEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Supervisor's VIA email *</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="manager@via-int.com"
                      {...field}
                      disabled={done}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {selectField("departmentId", "Department", departments)}
            {selectField("positionId", "Position", positions)}
            {selectField("locationId", "Work location", locations)}
            {selectField("employmentTypeId", "Employment type", employmentTypes)}
            <FormField
              control={form.control}
              name="visaRequired"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Do you need a visa or work permit record? *</FormLabel>
                  <Select
                    value={field.value ? "yes" : "no"}
                    onValueChange={(value) => field.onChange(value === "yes")}
                    disabled={done}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          {!done && (
            <div className="flex justify-end">
              <Button type="submit">Save & Continue</Button>
            </div>
          )}
        </form>
      </Form>
    </SectionShell>
  );
}

function SectionShell({
  icon,
  title,
  description,
  done,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className={done ? "opacity-80" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
          {done ? (
            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200 ml-auto">
              <CheckCircle2 className="w-3 h-3 mr-1" /> Submitted
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="ml-auto border-amber-200 text-amber-700 bg-amber-50"
            >
              <Circle className="w-3 h-3 mr-1" /> Required
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function PersonalDetailsSection({
  employee,
  task,
  done,
  onSubmit,
}: {
  employee: Employee;
  task: OnboardingTask;
  done: boolean;
  onSubmit: (changes: z.infer<typeof personalSchema>) => void;
}) {
  const form = useForm<z.infer<typeof personalSchema>>({
    resolver: zodResolver(personalSchema) as never,
    defaultValues: {
      dateOfBirth: employee.dateOfBirth || "",
      gender: employee.gender || "Male",
      nationality: employee.nationality || "",
      maritalStatus: employee.maritalStatus || "Single",
      phone: employee.phone || "",
      personalEmail: employee.personalEmail || "",
      address: employee.address || "",
      emergencyContacts: employee.emergencyContacts?.length
        ? employee.emergencyContacts
        : [{ name: "", relationship: "", phone: "" }],
      dependants: employee.dependants || [],
    },
  });

  const {
    fields: ecFields,
    append: appendEc,
    remove: removeEc,
  } = useFieldArray({ control: form.control, name: "emergencyContacts" });
  const {
    fields: depFields,
    append: appendDep,
    remove: removeDep,
  } = useFieldArray({ control: form.control, name: "dependants" });

  return (
    <SectionShell
      icon={<User className="w-4 h-4" />}
      title={task.title}
      description="Personal information used for benefits, statutory registration, and emergency contact."
      done={done}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="dateOfBirth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date of Birth *</FormLabel>
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
                  <FormLabel>Gender *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                  <FormLabel>Nationality *</FormLabel>
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
                  <FormLabel>Marital Status *</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
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
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Personal Phone *</FormLabel>
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
          </div>
          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Residential Address *</FormLabel>
                <FormControl>
                  <Textarea {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Emergency Contacts *</h4>
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
              <div key={item.id} className="grid grid-cols-3 gap-2 items-end">
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
                  {ecFields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeEc(index)}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
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
              <div key={item.id} className="grid grid-cols-3 gap-2 items-end">
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

          <div className="flex justify-end">
            <Button type="submit">{done ? "Update Details" : "Save & Continue"}</Button>
          </div>
        </form>
      </Form>
    </SectionShell>
  );
}

function BankDetailsSection({
  employee,
  task,
  done,
  onSubmit,
}: {
  employee: Employee;
  task: OnboardingTask;
  done: boolean;
  onSubmit: (bankDetails: z.infer<typeof bankSchema>) => void;
}) {
  const form = useForm<z.infer<typeof bankSchema>>({
    resolver: zodResolver(bankSchema),
    defaultValues: {
      bankName: employee.bankDetails?.bankName || "",
      accountNumber: employee.bankDetails?.accountNumber || "",
      iban: employee.bankDetails?.iban || "",
      swiftCode: employee.bankDetails?.swiftCode || "",
      branch: employee.bankDetails?.branch || "",
    },
  });

  return (
    <SectionShell
      icon={<Landmark className="w-4 h-4" />}
      title={task.title}
      description="Used by Finance to set up your salary payment. Visible only to you, Accounts, and Super Admin."
      done={done}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="bankName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bank Name *</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="branch"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Branch</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accountNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account Number *</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="iban"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>IBAN *</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="swiftCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SWIFT / BIC Code</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit">{done ? "Update Bank Details" : "Save & Continue"}</Button>
          </div>
        </form>
      </Form>
    </SectionShell>
  );
}

function DocumentUploadSection({
  task,
  done,
  onUpload,
}: {
  task: OnboardingTask;
  done: boolean;
  onUpload: (
    file: File,
    metadata: {
      documentNumber?: string;
      issueDate?: string;
      expiryDate?: string;
      issuingAuthority?: string;
      notes?: string;
    },
  ) => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentNumber, setDocumentNumber] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [issuingAuthority, setIssuingAuthority] = useState("");
  const [busy, setBusy] = useState(false);
  const documentType: DocumentType = task.documentType || "other";
  const requiresIdentityMetadata = ["passport", "visa", "national_id", "work_permit"].includes(
    documentType,
  );

  if (done) {
    return (
      <SectionShell
        icon={<FileUp className="w-4 h-4" />}
        title={task.title}
        description="Your document has been submitted for HR review. Replacements can be managed from My Profile under Documents."
        done
      >
        <p className="text-sm text-muted-foreground">
          No further action is required here unless HR asks you to provide a replacement.
        </p>
      </SectionShell>
    );
  }

  return (
    <SectionShell
      icon={<FileUp className="w-4 h-4" />}
      title={task.title}
      description="Accepted formats: PDF, JPG and PNG, up to 10 MB. HR will verify the document before your start date."
      done={done}
    >
      <div className="space-y-4">
        {requiresIdentityMetadata && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor={`${task.id}-number`}>
                Document number *
              </label>
              <Input
                id={`${task.id}-number`}
                value={documentNumber}
                onChange={(event) => setDocumentNumber(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor={`${task.id}-authority`}>
                Issuing authority or country *
              </label>
              <Input
                id={`${task.id}-authority`}
                value={issuingAuthority}
                onChange={(event) => setIssuingAuthority(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor={`${task.id}-issue-date`}>
                Issue date *
              </label>
              <Input
                id={`${task.id}-issue-date`}
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor={`${task.id}-expiry-date`}>
                Expiry date *
              </label>
              <Input
                id={`${task.id}-expiry-date`}
                type="date"
                min={issueDate || undefined}
                value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)}
              />
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
            Choose File
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {selectedFile ? selectedFile.name : "No file selected"}
          </span>
          <input
            type="file"
            className="hidden"
            ref={fileInputRef}
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
          />
          <Button
            type="button"
            disabled={
              busy ||
              !selectedFile ||
              (requiresIdentityMetadata &&
                (!documentNumber.trim() || !issuingAuthority.trim() || !issueDate || !expiryDate))
            }
            onClick={async () => {
              if (!selectedFile) return;
              if (issueDate && expiryDate && expiryDate < issueDate) {
                toast.error("Expiry date cannot be before the issue date");
                return;
              }
              setBusy(true);
              try {
                await onUpload(selectedFile, {
                  ...(documentNumber.trim() ? { documentNumber: documentNumber.trim() } : {}),
                  ...(issuingAuthority.trim() ? { issuingAuthority: issuingAuthority.trim() } : {}),
                  ...(issueDate ? { issueDate } : {}),
                  ...(expiryDate ? { expiryDate } : {}),
                });
                setSelectedFile(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Uploading..." : "Upload document"}
          </Button>
        </div>
      </div>
    </SectionShell>
  );
}
