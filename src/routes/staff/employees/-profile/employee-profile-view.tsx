import { useEffect, useState, useMemo } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  ArrowLeft,
  Edit2,
  Archive,
  RefreshCcw,
  PowerOff,
  Save,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ClipboardCheck,
  Clock3,
  FileText,
  GraduationCap,
  History,
  Laptop,
  Mail,
  MapPin,
  Plane,
  ShieldCheck,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react";
import { useCurrentUser, redactEmployee, isEmployeeInScope } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmployeeService } from "@/lib/data/employee-service";
import { OffboardingService } from "@/lib/data/offboarding-service";
import type { EmployeeSalary } from "@/lib/data/types";
import { getMasterDataRepository, getProjectRepository } from "@/lib/data/master-data";
import { toast } from "sonner";
import { format } from "date-fns";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { OverviewTab } from "./overview-tab";
import { PersonalTab } from "./personal-tab";
import { DocumentsTab } from "./documents-tab";
import { OnboardingOffboardingTab } from "./onboarding-offboarding-tab";
import { LeaveTab } from "./leave-tab";
import { TimesheetsTab } from "./timesheets-tab";
import { AttendanceTab } from "./attendance-tab";
import { TravelTab } from "./travel-tab";
import { PerformanceTab } from "./performance-tab";
import { TrainingTab } from "./training-tab";
import { EquipmentTab } from "./equipment-tab";
import { AuditViewer } from "@/components/audit-viewer";
import { getApplicationDataServices } from "@/lib/data/application-data";
import type { DevPreviewContextValue } from "@/lib/auth";

const editFormSchema = z.object({
  department: z.string().min(1),
  position: z.string().min(1),
  grade: z.string().optional(),
  location: z.string().min(1),
  projectId: z.string().optional(),
  employmentType: z.string().min(1),
  staffEntryType: z.enum(["New Employee", "Existing Employee"]),
  startDate: z.string().min(1, "Start date is required"),
  lineManagerId: z.string().optional(),
  effectiveDate: z.string().min(1, "Effective date is required"),
  reason: z.string().min(5, "A reason must be provided (min 5 chars)"),
});

const salaryFormSchema = z.object({
  baseMonthly: z.string().min(1, "Base monthly salary is required"),
  currency: z.string().min(1, "Currency is required"),
  housingAllowance: z.string().optional(),
  transportAllowance: z.string().optional(),
  payFrequency: z.string().optional(),
  effectiveDate: z.string().min(1, "Effective date is required"),
  reason: z.string().min(5, "A reason must be provided (min 5 chars)"),
});

function ProfileAccessDenied({
  employeeId,
  currentUser,
}: {
  employeeId: string;
  currentUser: DevPreviewContextValue;
}) {
  useEffect(() => {
    getApplicationDataServices().audit.record({
      context: currentUser.getActorContext(),
      action: "access-denied",
      module: "core-hr",
      entityType: "employee",
      entityId: employeeId,
      reason: "Attempted to open an employee profile outside the permitted record scope",
      riskLevel: "High",
    });
  }, [currentUser, employeeId]);

  return (
    <div className="mx-auto max-w-xl p-10 text-center">
      <h2 className="text-lg font-semibold">Access denied</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        You do not have permission to view this employee's profile. Employees can view their own
        record, line managers can view direct reports, and HR can view organisation records.
      </p>
    </div>
  );
}

export function EmployeeProfileView({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSalaryEditOpen, setIsSalaryEditOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [, setProfileVersion] = useState(0);
  const [employmentReviewNote, setEmploymentReviewNote] = useState("");
  const [employmentDecisionPending, setEmploymentDecisionPending] = useState(false);
  const [statusAction, setStatusAction] = useState<
    "Active" | "Suspended" | "Archived" | "Restore" | null
  >(null);
  const [statusReason, setStatusReason] = useState("");

  // Viewing your own record, regardless of what admin permissions you happen to hold, is a
  // different mode: it is your personal page, not an HR management console, so status-change
  // controls (suspend/archive/restore) never apply here even for an HR user or Super Admin.
  const isSelf = currentUser?.employeeId === employeeId;

  const employeeService = useMemo(() => new EmployeeService(), []);
  const offboardingService = useMemo(() => new OffboardingService(), []);

  const rawEmployee = employeeService.getById(employeeId, currentUser.getActorContext(), {
    includeArchived: true,
  });

  // Personal-life fields that redactEmployee does not cover (it only strips salary, bank
  // details, passport, national id and performance data). A viewer who is only in-scope via
  // directory/line-manager access (not the employee themselves, HR, or Super Admin) should
  // not see date of birth, home address, marital status, dependants, or emergency contacts.
  const isHROrSuperAdmin =
    currentUser?.activeRole === "Super Admin" ||
    currentUser?.activeRole === "HR" ||
    Boolean(currentUser?.permissions.has("employee:manage_all"));

  const employee = rawEmployee
    ? (() => {
        const base = redactEmployee(rawEmployee, currentUser);
        if (isSelf || isHROrSuperAdmin) return base;
        return {
          ...base,
          dateOfBirth: undefined,
          address: undefined,
          maritalStatus: undefined,
          dependants: undefined,
          emergencyContacts: undefined,
        };
      })()
    : rawEmployee;
  const canViewPersonalDetails = isSelf || isHROrSuperAdmin;
  const userMapping = useMemo(
    () =>
      employeeService
        .getUsers(currentUser.getActorContext(), { includeArchived: true })
        .find((u) => u.employeeId === employeeId),
    [currentUser, employeeService, employeeId],
  );
  const history = employeeService
    .getEmploymentHistory(employeeId, currentUser.getActorContext())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const allEmployees = useMemo(
    () =>
      employeeService
        .getEmployees(currentUser.getActorContext())
        .filter((e) => e.status !== "Archived" && e.id !== employeeId),
    [currentUser, employeeService, employeeId],
  );

  const departments = useMemo(() => getMasterDataRepository("departments").list(), []);
  const locations = useMemo(() => getMasterDataRepository("locations").list(), []);
  const grades = useMemo(() => getMasterDataRepository("grades").list(), []);
  const positions = useMemo(() => getMasterDataRepository("positions").list(), []);
  const projects = useMemo(() => getProjectRepository().list(), []);
  const employmentTypes = useMemo(() => getMasterDataRepository("employmentTypes").list(), []);

  const form = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      department: employee?.department || "",
      position: employee?.position || "",
      grade: employee?.grade || "",
      location: employee?.location || "",
      projectId: employee?.projectId || "",
      employmentType: employee?.employmentType || "",
      staffEntryType: employee?.staffEntryType || "Existing Employee",
      startDate: employee?.startDate || "",
      lineManagerId: employee?.lineManagerId || "",
      effectiveDate: new Date().toISOString().slice(0, 10),
      reason: "",
    },
  });

  const salaryForm = useForm<z.infer<typeof salaryFormSchema>>({
    resolver: zodResolver(salaryFormSchema),
    defaultValues: {
      baseMonthly: employee?.salary?.baseMonthly ? String(employee.salary.baseMonthly) : "",
      currency: employee?.salary?.currency || "OMR",
      housingAllowance: employee?.salary?.housingAllowance
        ? String(employee.salary.housingAllowance)
        : "",
      transportAllowance: employee?.salary?.transportAllowance
        ? String(employee.salary.transportAllowance)
        : "",
      payFrequency: employee?.salary?.payFrequency || "Monthly",
      effectiveDate: new Date().toISOString().slice(0, 10),
      reason: "",
    },
  });

  if (!employee) {
    return <div className="p-8 text-center">Employee not found.</div>;
  }

  // Real record-scoping gate: an authenticated user reaching this route only proves they
  // hold employee:view_directory, which every role has. Whether they may see this specific
  // employee's full record depends on isEmployeeInScope (self / direct manager / HR /
  // Super Admin) - anyone else is refused the record outright rather than shown redacted data.
  if (!isEmployeeInScope(rawEmployee, currentUser)) {
    return <ProfileAccessDenied employeeId={employeeId} currentUser={currentUser} />;
  }

  const canViewPayroll = currentUser.permissions.has("payroll:view");
  const visibleHistory = history.filter((record) => record.field !== "salary" || canViewPayroll);
  const canEditEmployment =
    currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";
  const canEditCompensation =
    currentUser.activeRole === "Accounts" || currentUser.activeRole === "Super Admin";
  const canViewAudit = currentUser.permissions.has("system:audit_view");
  const manager = employee.lineManagerId
    ? employeeService
        .getEmployeesWithReportingLine(currentUser.getActorContext())
        .find((item) => item.id === employee.lineManagerId)
    : undefined;
  const initials = (employee.preferredName || employee.legalName)
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

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

  const onEditSubmit = async (values: z.infer<typeof editFormSchema>) => {
    try {
      if (!currentUser) return;
      const { effectiveDate, reason, ...changes } = values;
      await employeeService.updateEmploymentRecordAsync(
        employeeId,
        {
          ...changes,
          lineManagerId:
            changes.lineManagerId === "none" || !changes.lineManagerId
              ? undefined
              : changes.lineManagerId,
          projectId: changes.projectId || undefined,
          grade: changes.grade || undefined,
        },
        effectiveDate,
        reason,
        getActorContext(reason),
      );
      toast.success("Employment details saved");
      setIsEditOpen(false);
      setProfileVersion((value) => value + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update employee");
    }
  };

  const decideEmploymentDetails = async (decision: "Confirmed" | "Changes Requested") => {
    if (!currentUser) return;
    if (decision === "Changes Requested" && employmentReviewNote.trim().length < 3) {
      toast.error("Explain what the employee needs to correct.");
      return;
    }
    setEmploymentDecisionPending(true);
    try {
      const { decideEmploymentDetailsFn } =
        await import("@/lib/server-functions/core-hr-lifecycle.server");
      await decideEmploymentDetailsFn({
        data: {
          actor: {
            actorId: currentUser.userId,
            actorEmail: currentUser.workspaceEmail,
            activeRole: currentUser.activeRole,
          },
          employeeId,
          decision,
          note: employmentReviewNote.trim(),
        },
      });
      await employeeService.hydrateCompatibilityCache(currentUser.getActorContext());
      setEmploymentReviewNote("");
      setProfileVersion((value) => value + 1);
      toast.success(
        decision === "Confirmed"
          ? "Employment details confirmed"
          : "The employee has been asked to update their details",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The decision could not be saved");
    } finally {
      setEmploymentDecisionPending(false);
    }
  };

  const onSalarySubmit = async (values: z.infer<typeof salaryFormSchema>) => {
    try {
      if (!currentUser) return;

      const baseMonthly = parseFloat(values.baseMonthly);
      if (Number.isNaN(baseMonthly) || baseMonthly <= 0) {
        throw new Error("Base monthly salary must be a positive number");
      }
      const housingAllowance =
        values.housingAllowance && values.housingAllowance.trim() !== ""
          ? parseFloat(values.housingAllowance)
          : undefined;
      const transportAllowance =
        values.transportAllowance && values.transportAllowance.trim() !== ""
          ? parseFloat(values.transportAllowance)
          : undefined;
      if (housingAllowance !== undefined && Number.isNaN(housingAllowance)) {
        throw new Error("Housing allowance must be a number");
      }
      if (transportAllowance !== undefined && Number.isNaN(transportAllowance)) {
        throw new Error("Transport allowance must be a number");
      }

      const salary: EmployeeSalary = {
        baseMonthly,
        currency: values.currency,
        ...(housingAllowance !== undefined ? { housingAllowance } : {}),
        ...(transportAllowance !== undefined ? { transportAllowance } : {}),
        ...(values.payFrequency
          ? { payFrequency: values.payFrequency as EmployeeSalary["payFrequency"] }
          : {}),
      };

      await employeeService.updateEmploymentRecordAsync(
        employeeId,
        { salary },
        values.effectiveDate,
        values.reason,
        getActorContext(values.reason),
      );
      toast.success("Salary details saved");
      setIsSalaryEditOpen(false);
      setProfileVersion((value) => value + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update salary");
    }
  };

  const handleStatusChange = async () => {
    if (!currentUser) return;
    if (!statusAction) return;
    try {
      const reason = statusReason.trim();
      if (reason.length < 5) throw new Error("Reason must be at least 5 characters");

      let targetStatus = employee.status;
      if (statusAction === "Active") targetStatus = "Active";
      if (statusAction === "Suspended") targetStatus = "Inactive";
      if (statusAction === "Archived") targetStatus = "Archived";
      if (statusAction === "Restore") {
        targetStatus = employee.terminationDate ? "Inactive" : "Active";
      }

      // Deactivation gate: moving an employee to Inactive or Archived must go through the
      // offboarding clearance process (mandatory tasks + financial + legal clearance) instead
      // of a raw status flip that skips it entirely.
      if (targetStatus === "Inactive" || targetStatus === "Archived") {
        const existingCase = offboardingService.getCaseByEmployeeId(
          employeeId,
          currentUser.getActorContext(),
        );
        const isFinalized = existingCase?.status === "Completed";

        if (existingCase && !isFinalized) {
          throw new Error(
            "An offboarding case is already in progress for this employee. Complete and finalise it from the Employee lifecycle tab (financial + legal clearance) before changing status further.",
          );
        }

        if (!existingCase) {
          // No case exists yet: start one automatically so the clearance gate applies. This
          // moves the employee to "Notice" immediately - finalizeCase (once mandatory tasks
          // and financial/legal clearance are done) is what applies the terminal Inactive
          // status, so we do not also call changeEmployeeStatus here.
          const today = new Date().toISOString().split("T")[0] as string;
          offboardingService.startCase(
            employeeId,
            "Other",
            today,
            today,
            false,
            reason,
            getActorContext(reason),
          );
          toast.success(
            "Offboarding case started. The employee has been moved to Notice status - finalise clearance from the Employee lifecycle tab to complete the change.",
          );
          setStatusAction(null);
          setStatusReason("");
          setProfileVersion((value) => value + 1);
          return;
        }

        // An existing case is already finalized (financial + legal clearance and mandatory
        // tasks complete): the clearance gate has been satisfied, so a direct status change
        // (e.g. Archiving after finalization already set the employee Inactive) is allowed.
      }

      await employeeService.changeEmployeeStatusAsync(
        employeeId,
        targetStatus,
        reason,
        getActorContext(reason),
      );
      toast.success(`Employee status changed to ${targetStatus}`);
      setStatusAction(null);
      setStatusReason("");
      setProfileVersion((value) => value + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  };

  return (
    <div className="mx-auto flex max-w-[1380px] flex-col gap-5 pb-10">
      <div className="flex items-center justify-between gap-4">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
        >
          <Link
            to={isSelf ? "/staff" : "/staff/employees"}
            className="transition-colors hover:text-foreground"
          >
            {isSelf ? "Overview" : "Directory"}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-foreground">{isSelf ? "My profile" : "Employee profile"}</span>
        </nav>
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full text-muted-foreground"
          onClick={() =>
            isSelf
              ? navigate({ to: "/staff" })
              : navigate({
                  to: "/staff/employees",
                  search: {
                    page: 1,
                    q: "",
                    status: "",
                    department: "",
                    location: "",
                    project: "",
                    manager: "",
                    employmentType: "",
                  },
                })
          }
        >
          <ArrowLeft className="h-4 w-4" /> {isSelf ? "Dashboard" : "Directory"}
        </Button>
      </div>

      <section className="relative overflow-hidden rounded-3xl bg-[linear-gradient(120deg,#072f56_0%,#0b568e_72%,#1170a9_100%)] px-6 py-7 text-white shadow-[0_28px_80px_-48px_rgba(4,41,77,.8)] sm:px-8">
        <div className="absolute -right-16 -top-28 h-72 w-72 rounded-full border-[46px] border-white/5" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/12 font-display text-2xl font-bold shadow-inner backdrop-blur-sm">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate font-display text-3xl font-bold tracking-[-0.04em] sm:text-4xl">
                  {employee.legalName}
                </h1>
                <span className="rounded-full border border-emerald-300/25 bg-emerald-300/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-100">
                  {employee.status}
                </span>
              </div>
              <p className="mt-2 text-base font-semibold text-blue-50">{employee.position}</p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-blue-100/78 sm:text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="h-4 w-4" />
                  {employee.department}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" />
                  {employee.location}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-4 w-4" />
                  {employee.workEmail}
                </span>
              </div>
            </div>
          </div>
          <div className="relative flex flex-wrap items-center gap-2 xl:justify-end">
            {employee.candidateId && (
              <Button
                asChild
                variant="outline"
                className="border-white/25 bg-white/8 text-white hover:bg-white/15 hover:text-white"
              >
                <Link
                  to="/staff/candidates/$candidateId"
                  params={{ candidateId: employee.candidateId }}
                >
                  Recruitment profile
                </Link>
              </Button>
            )}
            {!isSelf && canEditEmployment && employee.status === "Notice" && (
              <Button
                variant="outline"
                onClick={() => setActiveTab("onboarding")}
                className="border-white/25 bg-white/8 text-white hover:bg-white/15 hover:text-white"
              >
                <ClipboardCheck /> Open offboarding
              </Button>
            )}
            {!isSelf &&
              canEditEmployment &&
              ["Active", "Probation", "Onboarding"].includes(employee.status) && (
                <Button
                  variant="outline"
                  onClick={() => setStatusAction("Archived")}
                  className="border-rose-200/30 bg-rose-400/10 text-rose-50 hover:bg-rose-400/20 hover:text-white"
                >
                  <Archive /> Start offboarding
                </Button>
              )}
            {!isSelf && canEditEmployment && employee.status === "Inactive" && (
              <Button
                variant="outline"
                onClick={() => setStatusAction("Archived")}
                className="border-rose-200/30 bg-rose-400/10 text-rose-50 hover:bg-rose-400/20 hover:text-white"
              >
                <Archive /> Archive record
              </Button>
            )}
            {!isSelf && canEditEmployment && employee.status === "Archived" && (
              <Button
                variant="outline"
                onClick={() => setStatusAction("Restore")}
                className="border-white/25 bg-white/8 text-white hover:bg-white/15 hover:text-white"
              >
                <RefreshCcw /> Restore
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-sm">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/8 text-primary">
            <BriefcaseBusiness className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Employee number
            </p>
            <p className="mt-0.5 text-sm font-semibold">{employee.employeeNumber}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-sm">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-success/10 text-success">
            <UserRound className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Line manager
            </p>
            <p className="mt-0.5 text-sm font-semibold">
              {manager?.preferredName || "Not assigned"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-sm">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              Portal access
            </p>
            <p className="mt-0.5 text-sm font-semibold">
              {userMapping?.status || "Not configured"}
            </p>
          </div>
        </div>
      </div>

      <Dialog
        open={Boolean(statusAction)}
        onOpenChange={(open) => {
          if (!open) {
            setStatusAction(null);
            setStatusReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {statusAction === "Restore"
                ? "Restore employee"
                : statusAction === "Archived"
                  ? employee.status === "Inactive"
                    ? "Archive employee record"
                    : "Start offboarding"
                  : "Change employee status"}
            </DialogTitle>
            <DialogDescription>
              {statusAction === "Archived" && employee.status !== "Inactive"
                ? "This starts the employee's clearance and handover process. Their record will move to Notice until offboarding is complete."
                : "Give a clear reason for this change. It will be recorded in the employee history."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="employee-status-reason" className="text-sm font-medium">
              Reason
            </label>
            <Textarea
              id="employee-status-reason"
              value={statusReason}
              onChange={(event) => setStatusReason(event.target.value)}
              placeholder="Explain why this status change is needed"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusAction(null)}>
              Cancel
            </Button>
            <Button
              variant={statusAction === "Archived" ? "destructive" : "default"}
              disabled={statusReason.trim().length < 5}
              onClick={handleStatusChange}
            >
              {statusAction === "Archived" && employee.status !== "Inactive"
                ? "Start offboarding"
                : statusAction === "Restore"
                  ? "Restore employee"
                  : statusAction === "Archived"
                    ? "Archive record"
                    : "Confirm change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PageHeader
        className="hidden"
        title={
          isSelf
            ? "My Profile"
            : `${employee.preferredName} ${employee.legalName.split(" ").slice(-1)}`
        }
        description={`${employee.position} • ${employee.department} • ${employee.employeeNumber}`}
        breadcrumbs={
          isSelf
            ? [{ label: "Overview" }, { label: "My Profile" }]
            : [
                { label: "Core HR" },
                { label: "Directory", href: "/staff/employees" },
                { label: "Profile" },
              ]
        }
        actions={
          <div className="flex items-center gap-2">
            {isSelf ? (
              <Button variant="outline" onClick={() => navigate({ to: "/staff" })}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() =>
                  navigate({
                    to: "/staff/employees",
                    search: {
                      page: 1,
                      q: "",
                      status: "",
                      department: "",
                      location: "",
                      project: "",
                      manager: "",
                      employmentType: "",
                    },
                  })
                }
              >
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
            )}

            {!isSelf && canEditEmployment && (
              <>
                {employee.status !== "Archived" ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setStatusAction("Suspended")}
                      className="text-orange-600 hover:text-orange-700"
                    >
                      <PowerOff className="mr-2 h-4 w-4" /> Suspend
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setStatusAction("Archived")}
                      className="text-destructive hover:text-destructive"
                    >
                      <Archive className="mr-2 h-4 w-4" /> Archive
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setStatusAction("Restore")}
                    className="text-emerald-600 hover:text-emerald-700"
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" /> Restore
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />

      <div className="hidden items-center gap-4 px-1">
        <StatusBadge status={employee.status} />
        {userMapping && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            Portal access:{" "}
            <StatusBadge status={userMapping.status === "Active" ? "Active" : "Inactive"} />
          </div>
        )}
        {employee.candidateId && (
          <div className="text-sm text-muted-foreground flex items-center gap-2 border-l pl-4 ml-2">
            Recruitment:{" "}
            <Link
              to="/staff/candidates/$candidateId"
              params={{ candidateId: employee.candidateId }}
              className="text-blue-600 hover:underline"
            >
              View ATS Profile
            </Link>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="hidden overflow-x-auto pb-2 mb-4 scrollbar-thin">
          <TabsList className="w-max inline-flex">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="employment">Employment</TabsTrigger>
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="emergency_contacts">Emergency Contacts</TabsTrigger>
            <TabsTrigger value="dependants">Dependants</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="leave">Leave</TabsTrigger>
            <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
            <TabsTrigger value="attendance">Attendance/Overtime</TabsTrigger>
            <TabsTrigger value="travel">Travel</TabsTrigger>
            <TabsTrigger value="payroll">Payroll Inputs</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="training">Training</TabsTrigger>
            <TabsTrigger value="equipment">Equipment</TabsTrigger>
            <TabsTrigger value="onboarding">Onboarding/Offboarding</TabsTrigger>
            <TabsTrigger value="activity">Job History</TabsTrigger>
            <TabsTrigger value="audit">Audit Log</TabsTrigger>
          </TabsList>
        </div>

        <div className="mb-4 lg:hidden">
          <label
            htmlFor="profile-section"
            className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground"
          >
            Profile section
          </label>
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger id="profile-section" className="h-12 rounded-xl bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overview">Overview</SelectItem>
              <SelectItem value="employment">Employment</SelectItem>
              <SelectItem value="personal">Personal details</SelectItem>
              <SelectItem value="emergency_contacts">Emergency contacts</SelectItem>
              <SelectItem value="dependants">Dependants</SelectItem>
              <SelectItem value="documents">Documents</SelectItem>
              <SelectItem value="leave">Leave</SelectItem>
              <SelectItem value="timesheets">Timesheets</SelectItem>
              <SelectItem value="attendance">Attendance & overtime</SelectItem>
              <SelectItem value="travel">Travel</SelectItem>
              <SelectItem value="performance">Performance</SelectItem>
              <SelectItem value="training">Training & certifications</SelectItem>
              <SelectItem value="equipment">Equipment</SelectItem>
              <SelectItem value="onboarding">Employee lifecycle</SelectItem>
              <SelectItem value="activity">Job history</SelectItem>
              {canViewPayroll && <SelectItem value="payroll">Payroll inputs</SelectItem>}
              {canViewAudit && <SelectItem value="audit">Audit log</SelectItem>}
            </SelectContent>
          </Select>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="sticky top-24 hidden max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-border/80 bg-card p-3 shadow-sm lg:block">
            <p className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Profile
            </p>
            <TabsList className="flex h-auto w-full flex-col gap-1 bg-transparent p-0">
              <TabsTrigger
                value="overview"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <UserRound /> Overview
              </TabsTrigger>
              <TabsTrigger
                value="employment"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <BriefcaseBusiness /> Employment
              </TabsTrigger>
              <TabsTrigger
                value="personal"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <FileText /> Personal details
              </TabsTrigger>
              <TabsTrigger
                value="emergency_contacts"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <Users /> Emergency contacts
              </TabsTrigger>
              <TabsTrigger
                value="dependants"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <Users /> Dependants
              </TabsTrigger>
            </TabsList>
            <div className="my-3 border-t" />
            <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Work & development
            </p>
            <TabsList className="flex h-auto w-full flex-col gap-1 bg-transparent p-0">
              <TabsTrigger
                value="documents"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <FileText /> Documents
              </TabsTrigger>
              <TabsTrigger
                value="leave"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <CalendarDays /> Leave
              </TabsTrigger>
              <TabsTrigger
                value="timesheets"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <ClipboardCheck /> Timesheets
              </TabsTrigger>
              <TabsTrigger
                value="attendance"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <Clock3 /> Attendance & overtime
              </TabsTrigger>
              <TabsTrigger
                value="travel"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <Plane /> Travel
              </TabsTrigger>
              <TabsTrigger
                value="performance"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <TrendingUp /> Performance
              </TabsTrigger>
              <TabsTrigger
                value="training"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <GraduationCap /> Training
              </TabsTrigger>
              <TabsTrigger
                value="equipment"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <Laptop /> Equipment
              </TabsTrigger>
              <TabsTrigger
                value="onboarding"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <ClipboardCheck /> Employee lifecycle
              </TabsTrigger>
            </TabsList>
            <div className="my-3 border-t" />
            <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              History & controls
            </p>
            <TabsList className="flex h-auto w-full flex-col gap-1 bg-transparent p-0">
              <TabsTrigger
                value="activity"
                className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <History /> Job history
              </TabsTrigger>
              {canViewPayroll && (
                <TabsTrigger
                  value="payroll"
                  className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
                >
                  <ShieldCheck /> Payroll inputs
                </TabsTrigger>
              )}
              {canViewAudit && (
                <TabsTrigger
                  value="audit"
                  className="w-full justify-start gap-3 px-3 py-2.5 data-[state=active]:bg-primary/8 data-[state=active]:text-primary data-[state=active]:shadow-none"
                >
                  <ShieldCheck /> Audit log
                </TabsTrigger>
              )}
            </TabsList>
          </aside>

          <div className="min-w-0">
            <TabsContent value="overview" className="space-y-6 mt-0">
              <OverviewTab employee={employee} userMapping={userMapping} />
            </TabsContent>

            <TabsContent value="personal" className="space-y-6 mt-0">
              {!canViewPersonalDetails ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Personal Details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Restricted. Personal details (date of birth, address, marital status,
                      dependants, and emergency contacts) are visible and editable only by the
                      employee themselves, HR, and Super Admin.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <PersonalTab
                  employee={employee}
                  onChanged={() => setProfileVersion((value) => value + 1)}
                />
              )}
            </TabsContent>

            <TabsContent value="employment" className="space-y-6 mt-0">
              {employee.employmentConfirmationStatus && (
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <CardTitle>Employment information review</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Employment dates, assignment and reporting line become confirmed only
                          after HR review.
                        </p>
                      </div>
                      <StatusBadge status={employee.employmentConfirmationStatus} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {employee.proposedEmploymentDetails && (
                      <div className="grid gap-3 rounded-xl border bg-muted/25 p-4 sm:grid-cols-2 lg:grid-cols-3">
                        {[
                          ["Employee type", employee.proposedEmploymentDetails.staffEntryType],
                          ["Start date", employee.proposedEmploymentDetails.startDate],
                          [
                            "Department",
                            departments.find(
                              (item) =>
                                item.id === employee.proposedEmploymentDetails?.departmentId,
                            )?.name ?? "Unavailable",
                          ],
                          [
                            "Position",
                            positions.find(
                              (item) => item.id === employee.proposedEmploymentDetails?.positionId,
                            )?.name ?? "Unavailable",
                          ],
                          [
                            "Location",
                            locations.find(
                              (item) => item.id === employee.proposedEmploymentDetails?.locationId,
                            )?.name ?? "Unavailable",
                          ],
                          [
                            "Employment type",
                            employmentTypes.find(
                              (item) =>
                                item.id === employee.proposedEmploymentDetails?.employmentTypeId,
                            )?.name ?? "Unavailable",
                          ],
                          [
                            "Supervisor",
                            allEmployees.find(
                              (item) =>
                                item.id === employee.proposedEmploymentDetails?.lineManagerId,
                            )?.preferredName ?? employee.proposedEmploymentDetails.lineManagerEmail,
                          ],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <p className="text-xs font-medium text-muted-foreground">{label}</p>
                            <p className="mt-1 text-sm font-semibold">{value}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {employee.employmentReviewNote && (
                      <p className="rounded-lg border bg-muted/40 p-3 text-sm">
                        {employee.employmentReviewNote}
                      </p>
                    )}
                    {canEditEmployment &&
                      employee.employmentConfirmationStatus === "Pending HR Review" && (
                        <div className="space-y-3">
                          <Textarea
                            value={employmentReviewNote}
                            onChange={(event) => setEmploymentReviewNote(event.target.value)}
                            placeholder="Optional confirmation note, or explain what needs correcting"
                            aria-label="Employment review note"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              onClick={() => decideEmploymentDetails("Confirmed")}
                              disabled={employmentDecisionPending}
                            >
                              <ShieldCheck className="h-4 w-4" /> Confirm details
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => decideEmploymentDetails("Changes Requested")}
                              disabled={employmentDecisionPending}
                            >
                              Request changes
                            </Button>
                          </div>
                        </div>
                      )}
                  </CardContent>
                </Card>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Employment Details</CardTitle>
                    {canEditEmployment && employee.status !== "Archived" && (
                      <Dialog
                        open={isEditOpen}
                        onOpenChange={(open) => {
                          setIsEditOpen(open);
                          if (open) {
                            form.reset({
                              department: employee.department,
                              position: employee.position,
                              grade: employee.grade || "",
                              location: employee.location,
                              projectId: employee.projectId || "",
                              employmentType: employee.employmentType,
                              staffEntryType: employee.staffEntryType || "Existing Employee",
                              startDate: employee.startDate,
                              lineManagerId: employee.lineManagerId || "",
                              effectiveDate: new Date().toISOString().slice(0, 10),
                              reason: "",
                            });
                          }
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Update Employment Records</DialogTitle>
                            <DialogDescription>
                              Every change requires an effective date and reason for the audit log.
                            </DialogDescription>
                          </DialogHeader>
                          <Form {...form}>
                            <form
                              onSubmit={form.handleSubmit(onEditSubmit)}
                              className="space-y-4 pt-4"
                            >
                              <div className="grid grid-cols-2 gap-4">
                                <FormField
                                  control={form.control}
                                  name="department"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Department</FormLabel>
                                      <Select
                                        onValueChange={field.onChange}
                                        defaultValue={field.value as string}
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue />
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
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name="position"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Position</FormLabel>
                                      <Select
                                        onValueChange={field.onChange}
                                        defaultValue={field.value as string}
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue />
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
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name="grade"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Grade</FormLabel>
                                      <Select
                                        onValueChange={field.onChange}
                                        defaultValue={field.value as string}
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue placeholder="None" />
                                          </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                          <SelectItem value="none">None</SelectItem>
                                          {grades.map((d) => (
                                            <SelectItem key={d.id} value={d.name}>
                                              {d.name}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name="location"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Location</FormLabel>
                                      <Select
                                        onValueChange={field.onChange}
                                        defaultValue={field.value as string}
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue />
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
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name="employmentType"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Employment Type</FormLabel>
                                      <Select
                                        onValueChange={field.onChange}
                                        defaultValue={field.value as string}
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue />
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
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name="staffEntryType"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Staff Category</FormLabel>
                                      <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue />
                                          </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                          <SelectItem value="New Employee">New employee</SelectItem>
                                          <SelectItem value="Existing Employee">
                                            Existing employee
                                          </SelectItem>
                                        </SelectContent>
                                      </Select>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name="startDate"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>VIA Start Date</FormLabel>
                                      <FormControl>
                                        <Input type="date" {...field} />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name="lineManagerId"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Supervisor</FormLabel>
                                      <Select
                                        onValueChange={field.onChange}
                                        defaultValue={field.value as string}
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue placeholder="None" />
                                          </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                          <SelectItem value="none">None</SelectItem>
                                          {allEmployees.map((d) => (
                                            <SelectItem key={d.id} value={d.id}>
                                              {d.preferredName} ({d.position})
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name="projectId"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Project</FormLabel>
                                      <Select
                                        onValueChange={field.onChange}
                                        defaultValue={field.value as string}
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue placeholder="None" />
                                          </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                          <SelectItem value="none">None</SelectItem>
                                          {projects.map((d) => (
                                            <SelectItem key={d.id} value={d.id}>
                                              {d.name}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </FormItem>
                                  )}
                                />
                              </div>

                              <div className="pt-4 border-t">
                                <FormField
                                  control={form.control}
                                  name="effectiveDate"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Effective Date *</FormLabel>
                                      <FormControl>
                                        <Input type="date" {...field} />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={form.control}
                                  name="reason"
                                  render={({ field }) => (
                                    <FormItem className="mt-4">
                                      <FormLabel>Reason for Change *</FormLabel>
                                      <FormControl>
                                        <Textarea
                                          placeholder="e.g. Annual promotion, Department restructure"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>

                              <DialogFooter>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => setIsEditOpen(false)}
                                >
                                  Cancel
                                </Button>
                                <Button type="submit">Save Changes</Button>
                              </DialogFooter>
                            </form>
                          </Form>
                        </DialogContent>
                      </Dialog>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">Department</div>
                        <div className="font-medium">{employee.department}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Position</div>
                        <div className="font-medium">{employee.position}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Grade</div>
                        <div className="font-medium">{employee.grade || "-"}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Location</div>
                        <div className="font-medium">{employee.location}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Employment Type</div>
                        <div className="font-medium">{employee.employmentType}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Start Date</div>
                        <div className="font-medium">{employee.startDate}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Staff Category</div>
                        <div className="font-medium">
                          {employee.staffEntryType || "Not recorded"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Supervisor</div>
                        <div className="font-medium">
                          {employee.lineManagerId ? manager?.preferredName || "Unknown" : "None"}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Identity</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">Legal Name</div>
                        <div className="font-medium">{employee.legalName}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Employee Number</div>
                        <div className="font-medium">{employee.employeeNumber}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Work Email</div>
                        <div className="font-medium">{employee.workEmail}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Phone</div>
                        <div className="font-medium">{employee.phone || "-"}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {canViewPayroll && employee.status !== "Archived" && (
                  <Card className="md:col-span-2">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle>Compensation</CardTitle>
                      <Dialog
                        open={isSalaryEditOpen}
                        onOpenChange={(open) => {
                          setIsSalaryEditOpen(open);
                          if (open) {
                            salaryForm.reset({
                              baseMonthly: employee.salary?.baseMonthly
                                ? String(employee.salary.baseMonthly)
                                : "",
                              currency: employee.salary?.currency || "OMR",
                              housingAllowance: employee.salary?.housingAllowance
                                ? String(employee.salary.housingAllowance)
                                : "",
                              transportAllowance: employee.salary?.transportAllowance
                                ? String(employee.salary.transportAllowance)
                                : "",
                              payFrequency: employee.salary?.payFrequency || "Monthly",
                              effectiveDate: new Date().toISOString().slice(0, 10),
                              reason: "",
                            });
                          }
                        }}
                      >
                        {canEditCompensation && (
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                        )}
                        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Update Salary</DialogTitle>
                            <DialogDescription>
                              Every change requires an effective date and reason for the audit log.
                            </DialogDescription>
                          </DialogHeader>
                          <Form {...salaryForm}>
                            <form
                              onSubmit={salaryForm.handleSubmit(onSalarySubmit)}
                              className="space-y-4 pt-4"
                            >
                              <div className="grid grid-cols-2 gap-4">
                                <FormField
                                  control={salaryForm.control}
                                  name="baseMonthly"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Base Monthly Salary *</FormLabel>
                                      <FormControl>
                                        <Input type="number" step="0.01" min="0" {...field} />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={salaryForm.control}
                                  name="currency"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Currency *</FormLabel>
                                      <FormControl>
                                        <Input placeholder="OMR" {...field} />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={salaryForm.control}
                                  name="housingAllowance"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Housing Allowance</FormLabel>
                                      <FormControl>
                                        <Input type="number" step="0.01" min="0" {...field} />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={salaryForm.control}
                                  name="transportAllowance"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Transport Allowance</FormLabel>
                                      <FormControl>
                                        <Input type="number" step="0.01" min="0" {...field} />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={salaryForm.control}
                                  name="payFrequency"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Pay Frequency</FormLabel>
                                      <Select
                                        onValueChange={field.onChange}
                                        defaultValue={field.value as string}
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue />
                                          </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                          <SelectItem value="Monthly">Monthly</SelectItem>
                                          <SelectItem value="Biweekly">Biweekly</SelectItem>
                                          <SelectItem value="Weekly">Weekly</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </FormItem>
                                  )}
                                />
                              </div>

                              <div className="pt-4 border-t">
                                <FormField
                                  control={salaryForm.control}
                                  name="effectiveDate"
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel>Effective Date *</FormLabel>
                                      <FormControl>
                                        <Input type="date" {...field} />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                  control={salaryForm.control}
                                  name="reason"
                                  render={({ field }) => (
                                    <FormItem className="mt-4">
                                      <FormLabel>Reason for Change *</FormLabel>
                                      <FormControl>
                                        <Textarea
                                          placeholder="e.g. Annual increment, Promotion, Market adjustment"
                                          {...field}
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>

                              <DialogFooter>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => setIsSalaryEditOpen(false)}
                                >
                                  Cancel
                                </Button>
                                <Button type="submit">Save Changes</Button>
                              </DialogFooter>
                            </form>
                          </Form>
                        </DialogContent>
                      </Dialog>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-muted-foreground">Base Monthly Salary</div>
                          <div className="font-medium">
                            {employee.salary
                              ? `${employee.salary.baseMonthly.toLocaleString()} ${employee.salary.currency}`
                              : "Restricted"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Pay Frequency</div>
                          <div className="font-medium">{employee.salary?.payFrequency || "-"}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            <TabsContent value="documents" className="mt-0">
              <DocumentsTab employeeId={employeeId} />
            </TabsContent>

            <TabsContent value="leave" className="mt-0">
              <LeaveTab employeeId={employeeId} />
            </TabsContent>

            <TabsContent value="timesheets" className="mt-0">
              <TimesheetsTab employeeId={employeeId} />
            </TabsContent>

            <TabsContent value="attendance" className="mt-0">
              <AttendanceTab employeeId={employeeId} />
            </TabsContent>

            <TabsContent value="travel" className="mt-0">
              <TravelTab employeeId={employeeId} />
            </TabsContent>

            <TabsContent value="performance" className="mt-0">
              <PerformanceTab employeeId={employeeId} />
            </TabsContent>

            <TabsContent value="training" className="mt-0">
              <TrainingTab employeeId={employeeId} />
            </TabsContent>

            <TabsContent value="equipment" className="mt-0">
              <EquipmentTab employeeId={employeeId} />
            </TabsContent>

            <TabsContent value="emergency_contacts" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Emergency Contacts</CardTitle>
                </CardHeader>
                <CardContent>
                  {!canViewPersonalDetails ? (
                    <p className="text-sm text-muted-foreground">
                      Restricted. Emergency contact details are visible only to the employee
                      themselves, HR, and Super Admin.
                    </p>
                  ) : (employee?.emergencyContacts?.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No emergency contacts on record. Add these from the Personal tab.
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {employee!.emergencyContacts!.map((c, i) => (
                        <div key={i} className="border rounded-md p-3 text-sm">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-muted-foreground">{c.relationship}</div>
                          <div>{c.phone}</div>
                          {c.email && <div className="text-muted-foreground">{c.email}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="dependants" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Dependants</CardTitle>
                </CardHeader>
                <CardContent>
                  {!canViewPersonalDetails ? (
                    <p className="text-sm text-muted-foreground">
                      Restricted. Dependant details are visible only to the employee themselves, HR,
                      and Super Admin.
                    </p>
                  ) : (employee?.dependants?.length ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No dependants on record. Add these from the Personal tab.
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {employee!.dependants!.map((d, i) => (
                        <div key={i} className="border rounded-md p-3 text-sm">
                          <div className="font-medium">{d.name}</div>
                          <div className="text-muted-foreground">{d.relationship}</div>
                          <div>{d.dateOfBirth}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {canViewPayroll && (
              <TabsContent value="payroll" className="mt-0">
                <Card>
                  <CardHeader>
                    <CardTitle>Compensation & Payroll</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {employee?.salary ||
                    employee?.bankDetails ||
                    employee?.socialInsuranceNumber ? (
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-muted-foreground">Base Monthly Salary</div>
                          <div className="font-medium">
                            {employee.salary
                              ? `${employee.salary.baseMonthly.toLocaleString()} ${employee.salary.currency}`
                              : "Restricted"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Pay Frequency</div>
                          <div className="font-medium">{employee.salary?.payFrequency || "-"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Housing Allowance</div>
                          <div className="font-medium">
                            {employee.salary?.housingAllowance?.toLocaleString() ?? "-"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Transport Allowance</div>
                          <div className="font-medium">
                            {employee.salary?.transportAllowance?.toLocaleString() ?? "-"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Weekly Hours (FTE)</div>
                          <div className="font-medium">{employee.weeklyHours ?? "-"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Social Insurance Number</div>
                          <div className="font-medium">{employee.socialInsuranceNumber || "-"}</div>
                        </div>
                        <div className="col-span-2 border-t pt-4">
                          <div className="text-muted-foreground mb-2 font-medium">Bank Details</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Bank Name</div>
                          <div className="font-medium">
                            {employee.bankDetails?.bankName || "Restricted"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Branch</div>
                          <div className="font-medium">{employee.bankDetails?.branch || "-"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">IBAN</div>
                          <div className="font-medium font-mono text-xs">
                            {employee.bankDetails?.iban || "Restricted"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Account Number</div>
                          <div className="font-medium font-mono text-xs">
                            {employee.bankDetails?.accountNumber || "Restricted"}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No compensation data on record, or you don't have permission to view it.
                        Salary and bank details are visible only to the employee themselves,
                        Accounts, and Super Admin.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            <TabsContent value="onboarding" className="mt-0">
              <OnboardingOffboardingTab employeeId={employeeId} />
            </TabsContent>

            <TabsContent value="activity" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Employment History</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Effective Date</TableHead>
                        <TableHead>Field Changed</TableHead>
                        <TableHead>Previous Value</TableHead>
                        <TableHead>New Value</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Recorded</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleHistory.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            No historical changes recorded.
                          </TableCell>
                        </TableRow>
                      ) : (
                        visibleHistory.map((record) => (
                          <TableRow key={record.id}>
                            <TableCell className="font-medium">
                              {format(new Date(record.effectiveDate), "MMM d, yyyy")}
                            </TableCell>
                            <TableCell className="capitalize">
                              {record.field.replace(/([A-Z])/g, " $1").trim()}
                            </TableCell>
                            <TableCell className="text-muted-foreground line-through decoration-muted-foreground/30">
                              {record.oldValue || "-"}
                            </TableCell>
                            <TableCell>{record.newValue || "-"}</TableCell>
                            <TableCell className="text-sm">{record.reason}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {format(new Date(record.createdAt), "MMM d, yyyy HH:mm")}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {canViewAudit && (
              <TabsContent value="audit" className="mt-0 min-h-[500px]">
                <AuditViewer
                  entityId={rawEmployee?.databaseId ?? employeeId}
                  entityType="employee"
                />
              </TabsContent>
            )}
          </div>
        </div>
      </Tabs>
    </div>
  );
}
