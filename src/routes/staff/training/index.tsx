import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { BookOpen, CalendarDays, CheckCircle2, FileText, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { MasterDataService } from "@/lib/data/master-data";
import { TrainingService } from "@/lib/data/training-service";
import { ROLE_VALUES } from "@/lib/data/types";
import type {
  TrainingCourse,
  TrainingEnrollment,
  TrainingRequest,
} from "@/lib/data/training-types";

export const Route = createFileRoute("/staff/training/")({ component: StaffTrainingRoute });

type CourseForm = {
  id?: string;
  code: string;
  title: string;
  description: string;
  provider: string;
  category: string;
  deliveryType: TrainingCourse["deliveryType"];
  durationHours: string;
  cost: string;
  currency: string;
  validityMonths: string;
  renewalIntervalMonths: string;
  requiredRoles: string;
  requiredLocations: string;
  requiredProjects: string;
  isMandatory: boolean;
  isActive: boolean;
};

const emptyCourse = (): CourseForm => ({
  code: "",
  title: "",
  description: "",
  provider: "",
  category: "",
  deliveryType: "Classroom",
  durationHours: "8",
  cost: "0",
  currency: "AED",
  validityMonths: "",
  renewalIntervalMonths: "",
  requiredRoles: "",
  requiredLocations: "",
  requiredProjects: "",
  isMandatory: false,
  isActive: true,
});

function StaffTrainingRoute() {
  const currentUser = useCurrentUser();
  const context = currentUser.getActorContext();
  const isHr = currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";
  const service = useMemo(() => new TrainingService(), []);
  const employeeService = useMemo(() => new EmployeeService(), []);
  const masterDataService = useMemo(() => new MasterDataService(), []);
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [courseDialog, setCourseDialog] = useState(false);
  const [courseForm, setCourseForm] = useState<CourseForm>(emptyCourse);
  const [assignment, setAssignment] = useState({ employeeId: "", courseId: "", reason: "" });
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [decision, setDecision] = useState<{
    request: TrainingRequest;
    value: "Approve" | "Reject";
  } | null>(null);
  const [decisionComment, setDecisionComment] = useState("");
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionForm, setSessionForm] = useState({
    courseId: "",
    title: "",
    startAt: "",
    endAt: "",
    location: "",
    facilitator: "",
    capacity: "12",
  });
  const [schedule, setSchedule] = useState<TrainingEnrollment | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [completion, setCompletion] = useState<TrainingEnrollment | null>(null);
  const [completionForm, setCompletionForm] = useState({
    result: "",
    completionDate: new Date().toISOString().slice(0, 10),
    actualCost: "0",
  });
  const [reasonAction, setReasonAction] = useState<{
    kind:
      "No Show" | "Cancel Enrollment" | "Reject Certificate" | "Cancel Session" | "Archive Course";
    id: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  void version;

  const courses = service.getCourses(context, { includeInactive: isHr });
  const requests = service.getRequests(context);
  const enrollments = service.getEnrollments(context);
  const sessions = service.getSessions(context);
  const records = service.getTeamRecords(context);
  const employees = employeeService.getEmployees(context);
  const locations = masterDataService.list("locations", false).filter((item) => item.isActive);
  const projects = masterDataService.listProjects(false).filter((item) => item.isActive);
  const selectedValues = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const toggleCourseScope = (
    field: "requiredRoles" | "requiredLocations" | "requiredProjects",
    value: string,
    checked: boolean,
  ) => {
    const current = selectedValues(courseForm[field]);
    const next = checked
      ? [...new Set([...current, value])]
      : current.filter((item) => item !== value);
    setCourseForm({ ...courseForm, [field]: next.join(", ") });
  };
  const employeeName = (id: string) =>
    employees.find((item) => item.id === id)?.preferredName ||
    employees.find((item) => item.id === id)?.legalName ||
    "Employee";
  const courseName = (id: string) =>
    courses.find((item) => item.id === id)?.title || "Training course";
  const refresh = () => setVersion((value) => value + 1);
  const run = async (action: () => unknown | Promise<unknown>, success: string) => {
    try {
      await action();
      refresh();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The action could not be completed.");
      return false;
    }
  };
  const visibleEmployees = isHr
    ? employees.filter((item) => !["Inactive", "Archived"].includes(item.status))
    : employees.filter((item) => item.lineManagerId === currentUser.employeeId);
  const filteredRecords = records.filter((record) =>
    `${employeeName(record.employeeId)} ${record.title} ${record.provider}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const pendingRequests = requests.filter((request) =>
    isHr ? request.status === "Pending HR" : request.status === "Pending Supervisor",
  );

  const openCourse = (course?: TrainingCourse) => {
    setCourseForm(
      course
        ? {
            id: course.id,
            code: course.code,
            title: course.title,
            description: course.description,
            provider: course.provider,
            category: course.category,
            deliveryType: course.deliveryType,
            durationHours: String(course.durationHours),
            cost: String(course.cost),
            currency: course.currency,
            validityMonths: course.validityMonths ? String(course.validityMonths) : "",
            renewalIntervalMonths: course.renewalIntervalMonths
              ? String(course.renewalIntervalMonths)
              : "",
            requiredRoles: course.requiredRoles.join(", "),
            requiredLocations: course.requiredLocations.join(", "),
            requiredProjects: course.requiredProjects.join(", "),
            isMandatory: course.isMandatory,
            isActive: course.isActive,
          }
        : emptyCourse(),
    );
    setCourseDialog(true);
  };
  const saveCourse = async () => {
    const split = (value: string) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const ok = await run(
      () =>
        service.saveCourseAsync(
          {
            ...(courseForm.id ? { id: courseForm.id } : {}),
            code: courseForm.code,
            title: courseForm.title,
            description: courseForm.description,
            provider: courseForm.provider,
            category: courseForm.category,
            deliveryType: courseForm.deliveryType,
            durationHours: Number(courseForm.durationHours),
            cost: Number(courseForm.cost),
            currency: courseForm.currency,
            ...(courseForm.validityMonths
              ? { validityMonths: Number(courseForm.validityMonths) }
              : {}),
            ...(courseForm.renewalIntervalMonths
              ? { renewalIntervalMonths: Number(courseForm.renewalIntervalMonths) }
              : {}),
            requiredRoles: split(courseForm.requiredRoles),
            requiredLocations: split(courseForm.requiredLocations),
            requiredProjects: split(courseForm.requiredProjects),
            isMandatory: courseForm.isMandatory,
            isActive: courseForm.isActive,
          },
          context,
        ),
      courseForm.id ? "Course updated" : "Course added",
    );
    if (ok) setCourseDialog(false);
  };
  const decide = async () => {
    if (!decision) return;
    const ok = await run(
      () =>
        service.decideRequestAsync(decision.request.id, decision.value, decisionComment, context),
      decision.value === "Approve" ? "Training request approved" : "Training request declined",
    );
    if (ok) {
      setDecision(null);
      setDecisionComment("");
    }
  };
  const viewCertificate = async (id: string) => {
    try {
      const file = await service.getCertificateFile(id, {
        ...context,
        reason: "Viewed a training certificate",
      });
      const url = URL.createObjectURL(file.blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The certificate could not be opened.");
    }
  };

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 pb-10">
      <PageHeader
        title={isHr ? "Learning & Development" : "Team Training"}
        description={
          isHr
            ? "Manage courses, approvals, sessions, completion and employee certifications."
            : "Review training for your direct reports and recommend the right development opportunities."
        }
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Metric
          label="Active courses"
          value={courses.filter((item) => item.isActive).length}
          icon={<BookOpen className="h-5 w-5" />}
        />
        <Metric
          label="Decisions due"
          value={pendingRequests.length}
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <Metric
          label="In progress"
          value={
            enrollments.filter(
              (item) => !["Completed", "Cancelled", "No Show"].includes(item.status),
            ).length
          }
          icon={<Users className="h-5 w-5" />}
        />
        <Metric
          label="Upcoming sessions"
          value={sessions.filter((item) => item.status === "Scheduled").length}
          icon={<CalendarDays className="h-5 w-5" />}
        />
      </div>
      <Tabs defaultValue="requests">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl bg-muted/60 p-1">
          <TabsTrigger value="requests">Requests & assignments</TabsTrigger>
          <TabsTrigger value="plan">Training plan</TabsTrigger>
          {isHr && <TabsTrigger value="courses">Course catalogue</TabsTrigger>}
          {isHr && <TabsTrigger value="sessions">Sessions</TabsTrigger>}
          <TabsTrigger value="records">Certificates</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-6 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setAssignmentOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Assign training
            </Button>
          </div>
          <DataCard title="Requests requiring a decision">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRequests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell className="font-medium">
                      {employeeName(request.employeeId)}
                    </TableCell>
                    <TableCell>{courseName(request.courseId)}</TableCell>
                    <TableCell>{request.origin}</TableCell>
                    <TableCell className="max-w-xs">{request.reason}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{request.status}</Badge>
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDecision({ request, value: "Reject" });
                          setDecisionComment("");
                        }}
                      >
                        Decline
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setDecision({ request, value: "Approve" });
                          setDecisionComment("");
                        }}
                      >
                        Approve
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {pendingRequests.length === 0 && (
                  <EmptyRow columns={6} text="No training requests need your attention." />
                )}
              </TableBody>
            </Table>
          </DataCard>
          <DataCard title="Request history">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Latest note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>{employeeName(request.employeeId)}</TableCell>
                    <TableCell>{courseName(request.courseId)}</TableCell>
                    <TableCell>{request.origin}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{request.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {request.rejectionReason ||
                        request.hrComment ||
                        request.supervisorComment ||
                        request.reason}
                    </TableCell>
                  </TableRow>
                ))}
                {requests.length === 0 && (
                  <EmptyRow columns={5} text="No training requests have been submitted." />
                )}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        <TabsContent value="plan" className="mt-6">
          <DataCard title="Employee training plan">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Session</TableHead>
                  {isHr && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.map((item) => {
                  const session = sessions.find((entry) => entry.id === item.sessionId);
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{employeeName(item.employeeId)}</TableCell>
                      <TableCell>{courseName(item.courseId)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {session
                          ? `${session.title} · ${new Date(session.startAt).toLocaleDateString()}`
                          : "Not scheduled"}
                      </TableCell>
                      {isHr && (
                        <TableCell className="space-x-2 text-right">
                          {item.status === "Assigned" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSchedule(item);
                                setSessionId("");
                              }}
                            >
                              Schedule
                            </Button>
                          )}
                          {item.status === "Scheduled" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  run(
                                    () =>
                                      service.recordAttendanceAsync(
                                        item.id,
                                        true,
                                        "Attendance confirmed",
                                        context,
                                      ),
                                    "Attendance confirmed",
                                  )
                                }
                              >
                                Attended
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setReasonAction({ kind: "No Show", id: item.id });
                                  setReason("");
                                }}
                              >
                                No show
                              </Button>
                            </>
                          )}
                          {item.status === "Attended" && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setCompletion(item);
                                setCompletionForm({
                                  result: "Completed",
                                  completionDate: new Date().toISOString().slice(0, 10),
                                  actualCost: String(
                                    courses.find((course) => course.id === item.courseId)?.cost ??
                                      0,
                                  ),
                                });
                              }}
                            >
                              Complete
                            </Button>
                          )}
                          {!["Completed", "Cancelled", "No Show"].includes(item.status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setReasonAction({ kind: "Cancel Enrollment", id: item.id });
                                setReason("");
                              }}
                            >
                              Cancel
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {enrollments.length === 0 && (
                  <EmptyRow columns={isHr ? 5 : 4} text="No employees have training assigned." />
                )}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>

        {isHr && (
          <TabsContent value="courses" className="mt-6 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => openCourse()}>
                <Plus className="mr-2 h-4 w-4" /> Add course
              </Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {courses.map((course) => (
                <Card key={course.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{course.title}</CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {course.code} · {course.provider}
                        </p>
                      </div>
                      <Badge variant={course.isActive ? "secondary" : "outline"}>
                        {course.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm">{course.description}</p>
                    <p className="text-sm text-muted-foreground">
                      {course.category} · {course.deliveryType} · {course.durationHours} hours ·{" "}
                      {course.currency} {course.cost.toLocaleString()}
                    </p>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => openCourse(course)}>
                        Edit course
                      </Button>
                      {course.archivedAt ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            void run(
                              () => service.restoreCourseAsync(course.id, context),
                              "Course restored",
                            )
                          }
                        >
                          Restore
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setReasonAction({ kind: "Archive Course", id: course.id });
                            setReason("");
                          }}
                        >
                          Archive
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        )}

        {isHr && (
          <TabsContent value="sessions" className="mt-6 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setSessionOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Schedule session
              </Button>
            </div>
            <DataCard title="Scheduled training">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Session</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Date and time</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Facilitator</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium">{session.title}</TableCell>
                      <TableCell>{courseName(session.courseId)}</TableCell>
                      <TableCell>{new Date(session.startAt).toLocaleString()}</TableCell>
                      <TableCell>{session.location}</TableCell>
                      <TableCell>{session.facilitator}</TableCell>
                      <TableCell>
                        {
                          enrollments.filter(
                            (item) => item.sessionId === session.id && item.status !== "Cancelled",
                          ).length
                        }
                        /{session.capacity}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{session.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {session.status === "Scheduled" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReasonAction({ kind: "Cancel Session", id: session.id });
                              setReason("");
                            }}
                          >
                            Cancel session
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {sessions.length === 0 && (
                    <EmptyRow columns={8} text="No training sessions are scheduled." />
                  )}
                </TableBody>
              </Table>
            </DataCard>
          </TabsContent>
        )}

        <TabsContent value="records" className="mt-6 space-y-4">
          <div className="relative ml-auto w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employee or course"
            />
          </div>
          <DataCard title="Training and certification records">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Training</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Valid until</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">{employeeName(record.employeeId)}</TableCell>
                    <TableCell>{record.title}</TableCell>
                    <TableCell>{record.provider}</TableCell>
                    <TableCell>{record.completionDate}</TableCell>
                    <TableCell>{record.expiryDate || "Does not expire"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {record.hrVerified
                          ? "Verified"
                          : record.rejectedAt
                            ? "Needs correction"
                            : "Awaiting HR"}
                      </Badge>
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      {record.certificateFileId && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void viewCertificate(record.id)}
                        >
                          <FileText className="mr-2 h-4 w-4" />
                          View
                        </Button>
                      )}
                      {isHr && record.certificateFileId && !record.hrVerified && (
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              run(
                                () =>
                                  service.decideRecordAsync(
                                    record.id,
                                    "Verify",
                                    "Certificate checked against the uploaded evidence",
                                    context,
                                  ),
                                "Certificate verified",
                              )
                            }
                          >
                            Verify
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setReasonAction({ kind: "Reject Certificate", id: record.id });
                              setReason("");
                            }}
                          >
                            Return
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRecords.length === 0 && (
                  <EmptyRow columns={7} text="No training records match this view." />
                )}
              </TableBody>
            </Table>
          </DataCard>
        </TabsContent>
      </Tabs>

      <Dialog open={assignmentOpen} onOpenChange={setAssignmentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign training</DialogTitle>
            <DialogDescription>Add a course to an employee's development plan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Employee">
              <Select
                value={assignment.employeeId}
                onValueChange={(value) => setAssignment({ ...assignment, employeeId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {visibleEmployees.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.preferredName || item.legalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Course">
              <Select
                value={assignment.courseId}
                onValueChange={(value) => setAssignment({ ...assignment, courseId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select course" />
                </SelectTrigger>
                <SelectContent>
                  {courses
                    .filter((item) => item.isActive)
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.title}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Why this training is needed">
              <Textarea
                value={assignment.reason}
                onChange={(event) => setAssignment({ ...assignment, reason: event.target.value })}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignmentOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const ok = await run(
                  () =>
                    service.assignCourseAsync(
                      assignment.employeeId,
                      assignment.courseId,
                      assignment.reason,
                      context,
                    ),
                  "Training assigned",
                );
                if (ok) {
                  setAssignmentOpen(false);
                  setAssignment({ employeeId: "", courseId: "", reason: "" });
                }
              }}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(decision)} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision?.value} training request</DialogTitle>
            <DialogDescription>
              Record a clear reason for the employee and the audit history.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={decisionComment}
            onChange={(event) => setDecisionComment(event.target.value)}
            placeholder="Decision reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button onClick={decide}>{decision?.value}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={courseDialog} onOpenChange={setCourseDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{courseForm.id ? "Edit course" : "Add course"}</DialogTitle>
            <DialogDescription>
              Maintain the course, cost, validity and employee groups it applies to.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Course code">
              <Input
                value={courseForm.code}
                onChange={(event) => setCourseForm({ ...courseForm, code: event.target.value })}
              />
            </Field>
            <Field label="Course title">
              <Input
                value={courseForm.title}
                onChange={(event) => setCourseForm({ ...courseForm, title: event.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <Textarea
                  value={courseForm.description}
                  onChange={(event) =>
                    setCourseForm({ ...courseForm, description: event.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Provider">
              <Input
                value={courseForm.provider}
                onChange={(event) => setCourseForm({ ...courseForm, provider: event.target.value })}
              />
            </Field>
            <Field label="Category">
              <Input
                value={courseForm.category}
                onChange={(event) => setCourseForm({ ...courseForm, category: event.target.value })}
              />
            </Field>
            <Field label="Delivery">
              <Select
                value={courseForm.deliveryType}
                onValueChange={(value: TrainingCourse["deliveryType"]) =>
                  setCourseForm({ ...courseForm, deliveryType: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Classroom", "Virtual", "Blended", "Self-paced"].map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Duration (hours)">
              <Input
                type="number"
                min="0.5"
                step="0.5"
                value={courseForm.durationHours}
                onChange={(event) =>
                  setCourseForm({ ...courseForm, durationHours: event.target.value })
                }
              />
            </Field>
            <Field label="Cost">
              <Input
                type="number"
                min="0"
                value={courseForm.cost}
                onChange={(event) => setCourseForm({ ...courseForm, cost: event.target.value })}
              />
            </Field>
            <Field label="Currency">
              <Input
                maxLength={3}
                value={courseForm.currency}
                onChange={(event) => setCourseForm({ ...courseForm, currency: event.target.value })}
              />
            </Field>
            <Field label="Certificate valid for (months)">
              <Input
                type="number"
                min="1"
                value={courseForm.validityMonths}
                onChange={(event) =>
                  setCourseForm({ ...courseForm, validityMonths: event.target.value })
                }
              />
            </Field>
            <Field label="Renew every (months)">
              <Input
                type="number"
                min="1"
                value={courseForm.renewalIntervalMonths}
                onChange={(event) =>
                  setCourseForm({ ...courseForm, renewalIntervalMonths: event.target.value })
                }
              />
            </Field>
            <Field label="Who must complete this course">
              <div className="grid gap-2 rounded-lg border p-3">
                {ROLE_VALUES.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedValues(courseForm.requiredRoles).includes(role)}
                      onCheckedChange={(checked) =>
                        toggleCourseScope("requiredRoles", role, Boolean(checked))
                      }
                    />
                    {role}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Applicable offices">
              <div className="grid max-h-40 gap-2 overflow-y-auto rounded-lg border p-3">
                {locations.length ? (
                  locations.map((location) => (
                    <label key={location.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedValues(courseForm.requiredLocations).includes(location.id)}
                        onCheckedChange={(checked) =>
                          toggleCourseScope("requiredLocations", location.id, Boolean(checked))
                        }
                      />
                      {location.name}
                    </label>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    No active offices available.
                  </span>
                )}
              </div>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Applicable projects">
                <div className="grid max-h-40 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
                  {projects.length ? (
                    projects.map((project) => (
                      <label key={project.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selectedValues(courseForm.requiredProjects).includes(project.id)}
                          onCheckedChange={(checked) =>
                            toggleCourseScope("requiredProjects", project.id, Boolean(checked))
                          }
                        />
                        {project.name}
                      </label>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      No active projects available.
                    </span>
                  )}
                </div>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={courseForm.isMandatory}
                onCheckedChange={(value) =>
                  setCourseForm({ ...courseForm, isMandatory: Boolean(value) })
                }
              />
              Mandatory training
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={courseForm.isActive}
                onCheckedChange={(value) =>
                  setCourseForm({ ...courseForm, isActive: Boolean(value) })
                }
              />
              Available for assignment
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCourseDialog(false)}>
              Cancel
            </Button>
            <Button onClick={saveCourse}>Save course</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sessionOpen} onOpenChange={setSessionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule training session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Course">
              <Select
                value={sessionForm.courseId}
                onValueChange={(value) => setSessionForm({ ...sessionForm, courseId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select course" />
                </SelectTrigger>
                <SelectContent>
                  {courses
                    .filter((item) => item.isActive)
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.title}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Session title">
              <Input
                value={sessionForm.title}
                onChange={(event) => setSessionForm({ ...sessionForm, title: event.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts">
                <Input
                  type="datetime-local"
                  value={sessionForm.startAt}
                  onChange={(event) =>
                    setSessionForm({ ...sessionForm, startAt: event.target.value })
                  }
                />
              </Field>
              <Field label="Ends">
                <Input
                  type="datetime-local"
                  value={sessionForm.endAt}
                  onChange={(event) =>
                    setSessionForm({ ...sessionForm, endAt: event.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="Location or meeting link">
              <Input
                value={sessionForm.location}
                onChange={(event) =>
                  setSessionForm({ ...sessionForm, location: event.target.value })
                }
              />
            </Field>
            <Field label="Facilitator">
              <Input
                value={sessionForm.facilitator}
                onChange={(event) =>
                  setSessionForm({ ...sessionForm, facilitator: event.target.value })
                }
              />
            </Field>
            <Field label="Capacity">
              <Input
                type="number"
                min="1"
                value={sessionForm.capacity}
                onChange={(event) =>
                  setSessionForm({ ...sessionForm, capacity: event.target.value })
                }
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSessionOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const ok = await run(
                  () =>
                    service.saveSessionAsync(
                      {
                        courseId: sessionForm.courseId,
                        title: sessionForm.title,
                        startAt: sessionForm.startAt,
                        endAt: sessionForm.endAt,
                        location: sessionForm.location,
                        facilitator: sessionForm.facilitator,
                        capacity: Number(sessionForm.capacity),
                        status: "Scheduled",
                      },
                      context,
                    ),
                  "Training session scheduled",
                );
                if (ok) {
                  setSessionOpen(false);
                  setSessionForm({
                    courseId: "",
                    title: "",
                    startAt: "",
                    endAt: "",
                    location: "",
                    facilitator: "",
                    capacity: "12",
                  });
                }
              }}
            >
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(schedule)} onOpenChange={(open) => !open && setSchedule(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a training session</DialogTitle>
          </DialogHeader>
          <Select value={sessionId} onValueChange={setSessionId}>
            <SelectTrigger>
              <SelectValue placeholder="Select session" />
            </SelectTrigger>
            <SelectContent>
              {sessions
                .filter(
                  (item) => item.courseId === schedule?.courseId && item.status === "Scheduled",
                )
                .map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.title} · {new Date(item.startAt).toLocaleString()}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSchedule(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!schedule) return;
                const ok = await run(
                  () => service.scheduleEnrollmentAsync(schedule.id, sessionId, context),
                  "Employee scheduled",
                );
                if (ok) setSchedule(null);
              }}
            >
              Confirm session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(completion)} onOpenChange={(open) => !open && setCompletion(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete training record</DialogTitle>
            <DialogDescription>
              Record the result and actual cost. The employee's training history will be updated.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Result">
              <Input
                value={completionForm.result}
                onChange={(event) =>
                  setCompletionForm({ ...completionForm, result: event.target.value })
                }
              />
            </Field>
            <Field label="Completion date">
              <Input
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={completionForm.completionDate}
                onChange={(event) =>
                  setCompletionForm({ ...completionForm, completionDate: event.target.value })
                }
              />
            </Field>
            <Field label="Actual cost">
              <Input
                type="number"
                min="0"
                value={completionForm.actualCost}
                onChange={(event) =>
                  setCompletionForm({ ...completionForm, actualCost: event.target.value })
                }
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompletion(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!completion) return;
                const ok = await run(
                  () =>
                    service.completeEnrollmentAsync(
                      completion.id,
                      completionForm.result,
                      completionForm.completionDate,
                      Number(completionForm.actualCost),
                      context,
                    ),
                  "Training completed",
                );
                if (ok) setCompletion(null);
              }}
            >
              Complete training
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reasonAction)} onOpenChange={(open) => !open && setReasonAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reasonAction?.kind}</DialogTitle>
            <DialogDescription>
              Record the reason so the employee and HR history are clear.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonAction(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!reasonAction) return;
                const ok = await run(
                  () =>
                    reasonAction.kind === "No Show"
                      ? service.recordAttendanceAsync(reasonAction.id, false, reason, context)
                      : reasonAction.kind === "Cancel Enrollment"
                        ? service.cancelEnrollmentAsync(reasonAction.id, reason, context)
                        : reasonAction.kind === "Cancel Session"
                          ? service.cancelSessionAsync(reasonAction.id, reason, context)
                          : reasonAction.kind === "Archive Course"
                            ? service.archiveCourseAsync(reasonAction.id, reason, context)
                            : service.decideRecordAsync(reasonAction.id, "Reject", reason, context),
                  "Record updated",
                );
                if (ok) setReasonAction(null);
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <div className="rounded-xl bg-primary/10 p-3 text-primary">{icon}</div>
      </CardContent>
    </Card>
  );
}
function DataCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">{children}</CardContent>
    </Card>
  );
}
function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={columns} className="py-10 text-center text-muted-foreground">
        {text}
      </TableCell>
    </TableRow>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="flex flex-col gap-2">
      <span>{label}</span>
      {children}
    </Label>
  );
}
