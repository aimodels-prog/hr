import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getTodayAttendanceOverviewFn,
  sendAttendanceFollowUpFn,
} from "@/lib/server-functions/attendance-overview.server";
import { ATTENDANCE_FOLLOW_UP_MESSAGE } from "@/lib/data/attendance-follow-up";

type Row = Awaited<ReturnType<typeof getTodayAttendanceOverviewFn>>["rows"][number];

export function HrAttendanceToday() {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const query = useQuery({
    queryKey: ["hr-attendance-today", user.id, user.activeRole],
    queryFn: () => getTodayAttendanceOverviewFn({ data: { actor } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const [ask, setAsk] = useState<Row | null>(null);
  const [sending, setSending] = useState(false);
  const rows = query.data?.rows ?? [];
  const followUps = rows.filter((row) => row.needsFollowUp && !row.followUpState);
  const send = async () => {
    if (!ask || sending) return;
    setSending(true);
    try {
      const result = await sendAttendanceFollowUpFn({
        data: { actor, employeeId: ask.employeeId },
      });
      if (result.sent) toast.success(`Email sent to ${ask.name}.`);
      else toast.info("The attendance record changed. No email was sent.");
      setAsk(null);
      await queryClient.invalidateQueries({ queryKey: ["hr-attendance-today"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The email could not be confirmed.");
      await query.refetch();
    } finally {
      setSending(false);
    }
  };
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-lg">Head Office attendance today</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {query.data
              ? `${query.data.date} · ${rows.filter((row) => row.clockIn).length} clocked in · ${followUps.length} need a check`
              : "Checking today's records…"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
            aria-label="Refresh attendance"
            disabled={query.isFetching}
          >
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/staff/attendance" search={{ date: query.data?.date }}>
              Full attendance
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {query.isError && (
          <p role="alert" className="text-sm text-destructive">
            Today's attendance could not be loaded. Try Refresh.
          </p>
        )}
        {query.data && !query.data.afterCutoff && (
          <p className="mb-3 text-xs text-muted-foreground">
            HR follow-up becomes available at {query.data.followUpTime} for staff with no recorded
            clock-in or request.
          </p>
        )}
        {query.data && !query.data.emailConnected && (
          <p className="mb-3 text-xs text-muted-foreground">
            Connect HR email before sending attendance follow-ups.
          </p>
        )}
        {query.data && (
          <div className="max-h-[29rem] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Today</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Out</TableHead>
                  <TableHead>Day total</TableHead>
                  <TableHead>Approved activity</TableHead>
                  <TableHead className="text-right">HR action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.employeeId}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          row.clockIn
                            ? "border-blue-300 bg-blue-50 text-blue-800"
                            : row.status === "Not clocked in"
                              ? "border-amber-300 bg-amber-50 text-amber-900"
                              : ""
                        }
                      >
                        {row.clockIn ? (
                          <CheckCircle2
                            className="mr-1 h-3.5 w-3.5"
                            aria-label="Clock-in recorded"
                          />
                        ) : row.status === "Not clocked in" ? (
                          <CircleDashed className="mr-1 h-3.5 w-3.5" />
                        ) : null}
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{row.clockIn ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{row.clockOut ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">
                      {row.dayCredit.creditedHours ? `${row.dayCredit.creditedHours}h` : "—"}
                      {row.dayCredit.complete && (
                        <span className="block text-xs text-emerald-700">Complete</span>
                      )}
                      {row.dayCredit.approvedActivityHours > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {row.dayCredit.officeWorkHours}h work +{" "}
                          {row.dayCredit.approvedActivityHours}h approved
                          {row.dayCredit.policyTopupHours > 0 &&
                            ` + ${row.dayCredit.policyTopupHours}h standard-day credit`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.activities.map((activity) => (
                        <a
                          key={activity.path}
                          href={activity.path}
                          className="block text-primary hover:underline"
                        >
                          {activity.label}
                        </a>
                      ))}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.followUpState ? (
                        <span className="text-xs text-muted-foreground">
                          {row.followUpState === "Sent"
                            ? "Email sent"
                            : row.followUpState === "Blocked" || row.followUpState === "Failed"
                              ? "Email not sent · check connection"
                              : row.followUpState === "Skipped"
                                ? "No email needed"
                                : "Check email delivery"}
                        </span>
                      ) : (
                        row.needsFollowUp &&
                        user.activeRole === "HR" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!query.data.emailConnected}
                            onClick={() => setAsk(row)}
                          >
                            <Mail className="mr-1 h-3.5 w-3.5" /> Ask
                          </Button>
                        )
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      <Dialog open={Boolean(ask)} onOpenChange={(open) => !open && setAsk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask {ask?.name} about today</DialogTitle>
            <DialogDescription>
              HR will send one email. The app checks today's record again before sending.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            <p className="mb-2 font-medium">Subject: Please confirm your attendance today</p>
            <p>{ATTENDANCE_FOLLOW_UP_MESSAGE}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsk(null)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={sending}>
              Send email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
