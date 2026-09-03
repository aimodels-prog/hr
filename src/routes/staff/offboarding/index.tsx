import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { OffboardingService } from "@/lib/data/offboarding-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { format } from "date-fns";
import { ArrowRight, AlertTriangle, DoorOpen, UserMinus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import type { OffboardingReasonCategory } from "@/lib/data/offboarding-types";

export const Route = createFileRoute("/staff/offboarding/")({
  component: OffboardingDashboard,
});

const REASON_CATEGORIES: OffboardingReasonCategory[] = [
  "Resignation",
  "Termination",
  "Contract End",
  "Retirement",
  "Transfer",
  "Other",
];

const startCaseSchema = z.object({
  employeeId: z.string().min(1, "Select an employee"),
  templateId: z.string().min(1, "Select an offboarding template"),
  assignedHRId: z.string().min(1, "Select the HR case owner"),
  reasonCategory: z.enum([
    "Resignation",
    "Termination",
    "Contract End",
    "Retirement",
    "Transfer",
    "Other",
  ]),
  noticeDate: z.string().min(1, "Notice date is required"),
  lastWorkingDate: z.string().min(1, "Last working date is required"),
  rehireEligible: z.boolean(),
  confidentialityLevel: z.enum(["Standard", "Restricted"]),
  confidentialNotes: z.string().optional(),
});

function OffboardingDashboard() {
  const currentUser = useCurrentUser();
  const [obService] = useState(() => new OffboardingService());
  const [empService] = useState(() => new EmployeeService());
  const [isStartOpen, setIsStartOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [, setRefresh] = useState(0);
  const actorContext = useMemo(() => currentUser.getActorContext(), [currentUser]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void Promise.all([
      empService.hydrateCompatibilityCache(actorContext),
      obService.hydrateCompatibilityCache(actorContext),
    ])
      .then(() => {
        if (active) setRefresh((value) => value + 1);
      })
      .catch((error) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : "Offboarding could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [actorContext, empService, obService]);
  const cases = obService.getCasesForContext(currentUser.getActorContext());
  const activeCases = cases.filter((c) => c.status !== "Completed" && c.status !== "Cancelled");
  const employees = empService.getEmployees(currentUser.getActorContext());
  const eligibleEmployees = employees.filter(
    (e) =>
      e.status !== "Archived" &&
      e.status !== "Inactive" &&
      !cases.some(
        (c) => c.employeeId === e.id && c.status !== "Completed" && c.status !== "Cancelled",
      ),
  );
  const templates = obService.getTemplates(currentUser.getActorContext()).filter((t) => t.isActive);
  const hrOwners = empService
    .getUsers(currentUser.getActorContext())
    .filter((u) => u.status === "Active" && u.roles.includes("HR"));

  const form = useForm<z.infer<typeof startCaseSchema>>({
    resolver: zodResolver(startCaseSchema),
    defaultValues: {
      employeeId: "",
      templateId: "",
      assignedHRId: "",
      reasonCategory: "Resignation",
      noticeDate: "",
      lastWorkingDate: "",
      rehireEligible: true,
      confidentialityLevel: "Standard",
      confidentialNotes: "",
    },
  });

  const onStartCase = async (values: z.infer<typeof startCaseSchema>) => {
    try {
      await obService.startCaseAsync(
        values.employeeId,
        values.reasonCategory,
        values.noticeDate,
        values.lastWorkingDate,
        values.rehireEligible,
        values.confidentialNotes || undefined,
        currentUser.getActorContext(),
        {
          templateId: values.templateId,
          assignedHRId: values.assignedHRId,
          confidentialityLevel: values.confidentialityLevel,
        },
      );
      toast.success("Offboarding case started");
      setIsStartOpen(false);
      form.reset();
      setRefresh((r) => r + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start offboarding");
    }
  };

  return (
    <RequirePermission permission="offboarding:manage_all" resourceName="Offboarding">
      <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-10">
        <PageHeader
          title="Offboarding"
          description="Manage departing-employee clearance cases end to end."
          actions={
            <Dialog open={isStartOpen} onOpenChange={setIsStartOpen}>
              <DialogTrigger asChild>
                <Button>
                  <UserMinus className="w-4 h-4 mr-2" /> Start Offboarding
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Start Offboarding Case</DialogTitle>
                  <DialogDescription>
                    This immediately moves the employee to Notice status.
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onStartCase)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="employeeId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Employee</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select an employee" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {eligibleEmployees.map((e) => (
                                <SelectItem key={e.id} value={e.id}>
                                  {e.preferredName} — {e.position}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="templateId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Offboarding Template</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a template" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {templates.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="assignedHRId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>HR Case Owner</FormLabel>
                          <Select
                            onValueChange={(value) =>
                              field.onChange(value === "automatic" ? "" : value)
                            }
                            value={field.value || "automatic"}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="automatic">Assign automatically</SelectItem>
                              {hrOwners.map((u) => (
                                <SelectItem key={u.id} value={u.id}>
                                  {u.displayName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="reasonCategory"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Reason Category</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {REASON_CATEGORIES.map((r) => (
                                <SelectItem key={r} value={r}>
                                  {r}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="noticeDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Notice Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="lastWorkingDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Last Working Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="confidentialityLevel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confidentiality Level</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Standard">
                                Standard - visible to any HR user
                              </SelectItem>
                              <SelectItem value="Restricted">
                                Restricted - notes visible to Super Admin only
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="confidentialNotes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confidential Notes (HR only)</FormLabel>
                          <FormControl>
                            <Textarea {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="rehireEligible"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2 space-y-0">
                          <FormControl>
                            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                          <FormLabel className="!mt-0">Eligible for rehire</FormLabel>
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button type="submit">Start Case</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          }
        />
        {loading && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Loading offboarding records...
            </CardContent>
          </Card>
        )}
        {loadError && (
          <Card className="border-destructive/40">
            <CardContent className="p-6 text-sm text-destructive">{loadError}</CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl">{activeCases.length}</CardTitle>
              <CardDescription>Active Cases</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl">
                {cases.filter((c) => c.status === "Completed").length}
              </CardTitle>
              <CardDescription>Completed</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl text-rose-600">
                {
                  activeCases.filter((c) =>
                    c.tasks.some(
                      (t) =>
                        new Date(t.dueDate) < new Date() &&
                        t.status !== "Completed" &&
                        t.status !== "Waived",
                    ),
                  ).length
                }
              </CardTitle>
              <CardDescription>Cases with Overdue Tasks</CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Active Offboarding Cases</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Last Working Date</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeCases.map((c) => {
                  const emp = employees.find((e) => e.id === c.employeeId);
                  if (!emp) return null;
                  const overdueTasks = c.tasks.filter(
                    (t) =>
                      new Date(t.dueDate) < new Date() &&
                      t.status !== "Completed" &&
                      t.status !== "Waived",
                  );

                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{emp.legalName}</div>
                        <div className="text-xs text-muted-foreground">
                          {emp.employeeNumber} &middot; {emp.position}
                        </div>
                      </TableCell>
                      <TableCell>{c.reasonCategory}</TableCell>
                      <TableCell>{format(new Date(c.lastWorkingDate), "MMM d, yyyy")}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${c.progressPercentage}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {c.progressPercentage}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Badge
                            variant="outline"
                            className="border-amber-200 text-amber-700 bg-amber-50"
                          >
                            {c.status}
                          </Badge>
                          {overdueTasks.length > 0 && (
                            <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100 border-rose-200">
                              <AlertTriangle className="w-3 h-3 mr-1" /> {overdueTasks.length}{" "}
                              Overdue
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" asChild>
                          <Link to="/staff/offboarding/$caseId" params={{ caseId: c.id }}>
                            Open Case <ArrowRight className="w-4 h-4 ml-2" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {activeCases.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                      <DoorOpen className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                      No active offboarding cases.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </RequirePermission>
  );
}
