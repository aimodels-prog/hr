import { useState, useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Save, ArrowLeft } from "lucide-react";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { EmployeeService } from "@/lib/data/employee-service";
import { OnboardingService } from "@/lib/data/onboarding-service";
import { getMasterDataRepository, getProjectRepository } from "@/lib/data/master-data";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/employees/new")({
  component: NewEmployeeRoute,
});

const formSchema = z.object({
  legalName: z.string().min(2, "Legal name is required"),
  preferredName: z.string().min(2, "Preferred name is required"),
  workEmail: z.string().email("Invalid email address"),
  personalEmail: z.string().email("Invalid email address").optional().or(z.literal("")),
  phone: z.string().optional(),
  employeeNumber: z.string().min(1, "Employee number is required"),
  department: z.string().min(1, "Department is required"),
  position: z.string().min(1, "Position is required"),
  grade: z.string().optional(),
  location: z.string().min(1, "Location is required"),
  projectId: z.string().optional(),
  costCentreId: z.string().optional(),
  employmentType: z.string().min(1, "Employment type is required"),
  startDate: z.string().min(1, "Start date is required"),
  probationEndDate: z.string().optional(),
  lineManagerId: z.string().min(1, "Supervisor is required"),
  status: z.enum(["Onboarding", "Active", "Probation", "Notice", "Inactive", "Archived"]),

  // Personal details
  dateOfBirth: z.string().optional(),
  gender: z.enum(["Male", "Female"]).optional(),
  nationality: z.string().optional(),
  maritalStatus: z.enum(["Single", "Married", "Divorced", "Widowed"]).optional(),

  // Compensation & payroll setup
  baseMonthly: z.string().optional(),
  currency: z.string().optional(),
  housingAllowance: z.string().optional(),
  transportAllowance: z.string().optional(),
  payFrequency: z.enum(["Monthly", "Biweekly", "Weekly"]).optional(),
  weeklyHours: z.string().optional(),
  socialInsuranceNumber: z.string().optional(),
});

function NewEmployeeRoute() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();

  // Salary and statutory-registration details are compensation/payroll data - the same
  // Accounts-or-Super-Admin boundary that applies to later employment updates. HR can reach
  // this form (it only requires employee:manage_all), but must not be able to set payroll
  // fields simply by entering them at creation instead of the controlled employment-update path.
  const canSetPayroll = currentUser?.activeRole === "Super Admin";

  const employeeService = useMemo(() => new EmployeeService(), []);
  const onboardingService = useMemo(() => new OnboardingService(), []);

  const departments = useMemo(() => getMasterDataRepository("departments").list(), []);
  const locations = useMemo(() => getMasterDataRepository("locations").list(), []);
  const grades = useMemo(() => getMasterDataRepository("grades").list(), []);
  const positions = useMemo(() => getMasterDataRepository("positions").list(), []);
  const projects = useMemo(() => getProjectRepository().list(), []);
  const costCentres = useMemo(() => getMasterDataRepository("costCentres").list(), []);
  const employmentTypes = useMemo(() => getMasterDataRepository("employmentTypes").list(), []);
  const activeEmployees = useMemo(
    () =>
      employeeService
        .getEmployeeRepository()
        .list()
        .filter((e) => e.status !== "Archived"),
    [employeeService],
  );

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      legalName: "",
      preferredName: "",
      workEmail: "",
      personalEmail: "",
      phone: "",
      employeeNumber: "",
      department: "",
      position: "",
      grade: "",
      location: "",
      projectId: "",
      costCentreId: "",
      employmentType: "",
      startDate: new Date().toISOString().split("T")[0],
      probationEndDate: "",
      lineManagerId: "",
      status: "Onboarding",
      dateOfBirth: "",
      nationality: "",
      baseMonthly: "",
      currency: "OMR",
      housingAllowance: "",
      transportAllowance: "",
      payFrequency: "Monthly",
      weeklyHours: "40",
      socialInsuranceNumber: "",
    } as any,
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      if (!currentUser) throw new Error("No active user context");
      const {
        baseMonthly,
        currency,
        housingAllowance,
        transportAllowance,
        payFrequency,
        dateOfBirth,
        gender,
        nationality,
        maritalStatus,
        personalEmail,
        weeklyHours,
        socialInsuranceNumber,
        costCentreId,
        ...employeeData
      } = values;

      const actorContext = {
        actor: {
          userId: currentUser.userId,
          employeeId: currentUser.employeeId,
          displayName: currentUser.displayName,
          roles: currentUser.assignedRoles,
          activeRole: currentUser.activeRole,
        },
        reason: "New employee onboarding",
      };

      const salary =
        canSetPayroll && baseMonthly
          ? {
              baseMonthly: parseFloat(baseMonthly),
              currency: currency || "OMR",
              ...(housingAllowance ? { housingAllowance: parseFloat(housingAllowance) } : {}),
              ...(transportAllowance
                ? { transportAllowance: parseFloat(transportAllowance) }
                : {}),
              ...(payFrequency ? { payFrequency } : {}),
            }
          : undefined;

      const { employee: createdEmployee } = await employeeService.createEmployee(
        {
          ...employeeData,
          lineManagerId: employeeData.lineManagerId || undefined,
          projectId: employeeData.projectId || undefined,
          costCentreId: costCentreId || undefined,
          grade: employeeData.grade || undefined,
          probationEndDate: employeeData.probationEndDate || undefined,
          personalEmail: personalEmail || undefined,
          dateOfBirth: dateOfBirth || undefined,
          gender: gender || undefined,
          nationality: nationality || undefined,
          maritalStatus: maritalStatus || undefined,
          weeklyHours: weeklyHours ? parseFloat(weeklyHours) : undefined,
          socialInsuranceNumber: canSetPayroll ? socialInsuranceNumber || undefined : undefined,
          salary,
        },
        ["Employee"],
        actorContext,
      );

      // Employees hired through recruitment get their onboarding case from the offer-conversion
      // flow (see conversion-service.ts). A direct hire entered here - a walk-in, a referral, someone
      // brought on straight from an interview with no candidate/offer trail - needs the exact same
      // checklist started for them, or their self-service intake page (and the dashboard onboarding
      // gate) will never have anything to show. Skip it only when HR is entering someone who is
      // already past onboarding, e.g. a rehire or a lateral data-entry case set straight to Active.
      if (values.status === "Onboarding") {
        onboardingService.createCaseForEmployee(createdEmployee.id, actorContext);
      }

      toast.success(
        values.status === "Onboarding"
          ? "Employee created and onboarding checklist started"
          : "Employee added",
      );
      navigate({
        to: "/staff/employees",
        search: { page: 1, q: "", status: "", department: "", location: "" },
      } as any);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create employee");
    }
  };

  return (
    <RequirePermission permission="employee:manage_all" resourceName="Add Employee">
      <div className="flex flex-col gap-6 max-w-[1000px] mx-auto pb-10">
        <PageHeader
          title="Add Employee"
          description="For direct hires - walk-ins, referrals, anyone hired without going through Recruitment. Candidates converted from an accepted offer already get their employee record and onboarding checklist automatically and do not need this form. Setting the initial status to Onboarding starts a real onboarding checklist for this person."
          breadcrumbs={[
            { label: "Core HR" },
            { label: "Directory", href: "/staff/employees" as any },
            { label: "Add Employee" },
          ]}
          actions={
            <Button
              variant="outline"
              onClick={() =>
                navigate({
                  to: "/staff/employees",
                  search: { page: 1, q: "", status: "", department: "", location: "" },
                } as any)
              }
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Directory
            </Button>
          }
        />

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Identity Information</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control as any}
                  name="employeeNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employee Number *</FormLabel>
                      <FormControl>
                        <Input placeholder="EMP-001" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="workEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Workspace Email * (Future Login ID)</FormLabel>
                      <FormControl>
                        <Input placeholder="name@via-hr.com" type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="legalName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Legal Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Full legal name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="preferredName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Preferred Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Preferred/Display name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <Input placeholder="+1 234 567 8900" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="personalEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Personal Email</FormLabel>
                      <FormControl>
                        <Input placeholder="For pre-boarding contact" type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Personal Information</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control as any}
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
                  control={form.control as any}
                  name="gender"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Gender</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Gender" />
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
                  control={form.control as any}
                  name="nationality"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nationality</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Omani, Indian, British" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="maritalStatus"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Marital Status</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Marital Status" />
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Employment Configuration</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control as any}
                  name="department"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Department" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {departments.map((d) => (
                            <SelectItem key={d.id} value={d.name}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Location" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {locations.map((d) => (
                            <SelectItem key={d.id} value={d.name}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="position"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Position *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Position" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {positions.map((d) => (
                            <SelectItem key={d.id} value={d.name}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="grade"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Grade</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Grade (Optional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {grades.map((d) => (
                            <SelectItem key={d.id} value={d.name}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="employmentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employment Type *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {employmentTypes.map((d) => (
                            <SelectItem key={d.id} value={d.name}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="projectId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Assignment</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Project (Optional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {projects.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="probationEndDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Probation End Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="lineManagerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Supervisor *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select supervisor" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {activeEmployees.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.preferredName} ({d.position})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Initial Status *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Onboarding">Onboarding</SelectItem>
                          <SelectItem value="Active">Active</SelectItem>
                          <SelectItem value="Probation">Probation</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="costCentreId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cost Centre</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Cost Centre (Optional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {costCentres.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="weeklyHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weekly Hours (FTE)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="40" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {canSetPayroll && (
            <Card>
              <CardHeader>
                <CardTitle>Compensation & Payroll Setup</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control as any}
                  name="baseMonthly"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Base Monthly Salary</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0.00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <FormControl>
                        <Input placeholder="OMR" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="housingAllowance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Housing Allowance</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0.00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="transportAllowance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Transport Allowance</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0.00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="payFrequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pay Frequency</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value as string}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Frequency" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Monthly">Monthly</SelectItem>
                          <SelectItem value="Biweekly">Biweekly</SelectItem>
                          <SelectItem value="Weekly">Weekly</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control as any}
                  name="socialInsuranceNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Social Insurance Number</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="GOSI / PASI / statutory registration number"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  navigate({
                    to: "/staff/employees",
                    search: { page: 1, q: "", status: "", department: "", location: "" },
                  } as any)
                }
              >
                Cancel
              </Button>
              <Button type="submit">
                <Save className="mr-2 h-4 w-4" /> Add Employee
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </RequirePermission>
  );
}
