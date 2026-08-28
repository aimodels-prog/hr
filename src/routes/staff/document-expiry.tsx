import { useState, useMemo, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
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
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { EmployeeService } from "@/lib/data/employee-service";
import { DocumentService } from "@/lib/data/document-service";
import { DocumentExpiryService } from "@/lib/data/document-expiry-service";
import { getMasterDataRepository } from "@/lib/data/master-data";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertCircle, Clock, ShieldAlert, UserPlus, CheckCircle2 } from "lucide-react";
import type { EmployeeDocument, Employee } from "@/lib/data/types";

export const Route = createFileRoute("/staff/document-expiry")({
  component: DocumentExpiryRoute,
});

const snoozeSchema = z.object({
  snoozedUntil: z.string().min(1),
  snoozeReason: z.string().min(3),
});

const waiveSchema = z.object({
  waiverReason: z.string().min(3),
});

const assignSchema = z.object({
  ownerId: z.string().min(1),
});

function DocumentExpiryRoute() {
  const currentUser = useCurrentUser();

  const employeeService = useMemo(() => new EmployeeService(), []);
  const documentService = useMemo(() => new DocumentService(), []);
  const documentExpiryService = useMemo(() => new DocumentExpiryService(), []);

  // Run the reminder engine when accessing this page
  useEffect(() => {
    if (currentUser) {
      documentExpiryService
        .runReminderEngine({
          actor: {
            userId: currentUser.userId,
            employeeId: currentUser.employeeId,
            displayName: currentUser.displayName,
            roles: currentUser.assignedRoles,
            activeRole: currentUser.activeRole,
          },
          reason: "Background reminder check",
        })
        .catch(console.error);
    }
  }, [currentUser, documentExpiryService]);

  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  const allDocs = useMemo(
    () =>
      documentService
        .getDocuments(currentUser.getActorContext())
        .filter((d) => d.status !== "Replaced" && d.status !== "Rejected" && d.expiryDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUser, documentService, refreshKey],
  );
  const allEmployees = useMemo(
    () => employeeService.getEmployees(currentUser.getActorContext()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employeeService, refreshKey],
  );
  const hrUsers = useMemo(
    () =>
      employeeService.getUsers(currentUser.getActorContext()).filter((u) => u.roles.includes("HR")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employeeService, refreshKey],
  );

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const docsWithMetadata = allDocs
    .map((doc) => {
      const employee = allEmployees.find((e) => e.id === doc.employeeId);
      const exp = new Date(doc.expiryDate!);
      exp.setHours(0, 0, 0, 0);
      const daysRemaining = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      let bucket = "valid";
      if (doc.waiverReason) bucket = "waived";
      else if (daysRemaining < 0) bucket = "expired";
      else if (daysRemaining <= 7) bucket = "1-7";
      else if (daysRemaining <= 30) bucket = "8-30";
      else if (daysRemaining <= 60) bucket = "31-60";
      else if (daysRemaining <= 90) bucket = "61-90";

      return { ...doc, employee, daysRemaining, bucket };
    })
    .filter((d) => d.employee);

  // Stats
  const expiredCount = docsWithMetadata.filter((d) => d.bucket === "expired").length;
  const criticalCount = docsWithMetadata.filter((d) => ["1-7", "8-30"].includes(d.bucket)).length;
  const monitoringCount = docsWithMetadata.filter((d) =>
    ["31-60", "61-90"].includes(d.bucket),
  ).length;
  const validCount = docsWithMetadata.filter((d) => d.bucket === "valid").length;

  const [activeTab, setActiveTab] = useState<string>("expired");
  const filteredDocs = docsWithMetadata.filter((d) => d.bucket === activeTab);

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

  const [actionDocId, setActionDocId] = useState<string | null>(null);

  const snoozeForm = useForm<z.infer<typeof snoozeSchema>>({ resolver: zodResolver(snoozeSchema) });
  const waiveForm = useForm<z.infer<typeof waiveSchema>>({ resolver: zodResolver(waiveSchema) });
  const assignForm = useForm<z.infer<typeof assignSchema>>({ resolver: zodResolver(assignSchema) });

  const onSnooze = (values: z.infer<typeof snoozeSchema>) => {
    try {
      documentExpiryService.snoozeDocument(
        actionDocId!,
        values.snoozedUntil,
        values.snoozeReason,
        getActorContext("Snooze reminder"),
      );
      toast.success("Document reminders snoozed");
      setActionDocId(null);
      refresh();
    } catch (e) {
      toast.error("Failed to snooze");
    }
  };

  const onWaive = (values: z.infer<typeof waiveSchema>) => {
    try {
      documentExpiryService.waiveDocument(
        actionDocId!,
        values.waiverReason,
        getActorContext("Authorized waiver"),
      );
      toast.success("Document requirement removed");
      setActionDocId(null);
      refresh();
    } catch (e) {
      toast.error("Failed to waive");
    }
  };

  const onAssign = (values: z.infer<typeof assignSchema>) => {
    try {
      documentExpiryService.assignOwner(
        actionDocId!,
        values.ownerId,
        getActorContext("Assign owner"),
      );
      toast.success("Owner assigned");
      setActionDocId(null);
      refresh();
    } catch (e) {
      toast.error("Failed to assign");
    }
  };

  return (
    <RequirePermission permission="employee:manage_all" resourceName="Document Expiry Centre">
      <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-10">
        <PageHeader
          title="Document Expiry Centre"
          description="Monitor and track expiring employee documents globally."
        />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-destructive/5 border-destructive/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-destructive flex items-center">
                <AlertCircle className="mr-2 h-4 w-4" /> Expired
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-destructive">{expiredCount}</div>
            </CardContent>
          </Card>
          <Card className="bg-orange-50 border-orange-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-orange-700 flex items-center">
                <ShieldAlert className="mr-2 h-4 w-4" /> Expiring &lt; 30 Days
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-700">{criticalCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                <Clock className="mr-2 h-4 w-4" /> Expiring 30-90 Days
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{monitoringCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                <CheckCircle2 className="mr-2 h-4 w-4" /> Valid (&gt; 90 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{validCount}</div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="expired">Expired ({expiredCount})</TabsTrigger>
            <TabsTrigger value="1-7">1-7 Days</TabsTrigger>
            <TabsTrigger value="8-30">8-30 Days</TabsTrigger>
            <TabsTrigger value="31-60">31-60 Days</TabsTrigger>
            <TabsTrigger value="61-90">61-90 Days</TabsTrigger>
            <TabsTrigger value="valid">Valid</TabsTrigger>
            <TabsTrigger value="waived">Waived</TabsTrigger>
          </TabsList>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Expiry Date</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Assigned Owner</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No documents in this category.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDocs.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <Link
                          to="/staff/employees/$employeeId"
                          params={{ employeeId: doc.employeeId }}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {doc.employee!.preferredName} {doc.employee!.legalName}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {doc.employee!.employeeNumber}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="capitalize font-medium">{doc.type.replace("_", " ")}</div>
                        <div className="text-xs text-muted-foreground">
                          {doc.visibility === "Restricted"
                            ? "***REDACTED***"
                            : doc.documentNumber || "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{doc.employee!.location}</TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(doc.expiryDate!), "MMM d, yyyy")}
                        {doc.snoozedUntil && (
                          <div className="text-xs text-orange-600 mt-1">
                            Snoozed to {format(new Date(doc.snoozedUntil), "MMM d")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`font-bold ${doc.daysRemaining < 0 ? "text-destructive" : doc.daysRemaining <= 30 ? "text-orange-600" : ""}`}
                        >
                          {doc.daysRemaining}
                        </span>
                      </TableCell>
                      <TableCell>
                        {doc.assignedOwnerId ? (
                          hrUsers.find((u) => u.id === doc.assignedOwnerId)?.displayName ||
                          "Unknown"
                        ) : (
                          <span className="text-muted-foreground italic">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Dialog
                          open={actionDocId === doc.id}
                          onOpenChange={(open) => setActionDocId(open ? doc.id : null)}
                        >
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setActionDocId(doc.id)}
                            >
                              Manage
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Manage Expiry Action</DialogTitle>
                            </DialogHeader>
                            <Tabs defaultValue="assign" className="mt-4">
                              <TabsList className="grid grid-cols-3">
                                <TabsTrigger value="assign">Assign</TabsTrigger>
                                <TabsTrigger value="snooze">Snooze</TabsTrigger>
                                <TabsTrigger value="waive">Waive</TabsTrigger>
                              </TabsList>
                              <TabsContent value="assign" className="mt-4">
                                <Form {...assignForm}>
                                  <form
                                    onSubmit={assignForm.handleSubmit(onAssign)}
                                    className="space-y-4"
                                  >
                                    <FormField
                                      control={assignForm.control as any}
                                      name="ownerId"
                                      render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Assign HR Owner</FormLabel>
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
                                              {hrUsers.map((u) => (
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
                                    <Button type="submit">Assign</Button>
                                  </form>
                                </Form>
                              </TabsContent>
                              <TabsContent value="snooze" className="mt-4">
                                <Form {...snoozeForm}>
                                  <form
                                    onSubmit={snoozeForm.handleSubmit(onSnooze)}
                                    className="space-y-4"
                                  >
                                    <FormField
                                      control={snoozeForm.control as any}
                                      name="snoozedUntil"
                                      render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Snooze Reminders Until</FormLabel>
                                          <FormControl>
                                            <Input type="date" {...field} />
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                    <FormField
                                      control={snoozeForm.control as any}
                                      name="snoozeReason"
                                      render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Reason</FormLabel>
                                          <FormControl>
                                            <Input {...field} />
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                    <Button type="submit">Snooze</Button>
                                  </form>
                                </Form>
                              </TabsContent>
                              <TabsContent value="waive" className="mt-4">
                                <Form {...waiveForm}>
                                  <form
                                    onSubmit={waiveForm.handleSubmit(onWaive)}
                                    className="space-y-4"
                                  >
                                    <p className="text-sm text-muted-foreground mb-4">
                                      Waiving a document resolves it permanently without requiring a
                                      replacement upload.
                                    </p>
                                    <FormField
                                      control={waiveForm.control as any}
                                      name="waiverReason"
                                      render={({ field }) => (
                                        <FormItem>
                                          <FormLabel>Authorized Waiver Reason</FormLabel>
                                          <FormControl>
                                            <Input {...field} />
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                    <Button type="submit" variant="destructive">
                                      Record Waiver
                                    </Button>
                                  </form>
                                </Form>
                              </TabsContent>
                            </Tabs>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </Tabs>
      </div>
    </RequirePermission>
  );
}
