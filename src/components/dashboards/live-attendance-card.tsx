import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { getMyLiveAttendanceFn } from "@/lib/server-functions/attendance.server";
import { formatWorkedMinutes, workedMinutes } from "@/lib/data/live-attendance";

export function LiveAttendanceCard() {
  const user = useCurrentUser();
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const query = useQuery({
    queryKey: ["my-live-attendance", user.id, user.workspaceEmail, user.activeRole],
    queryFn: async () => {
      const snapshot = await getMyLiveAttendanceFn({
        data: {
          actor: {
            actorId: user.id,
            ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
            activeRole: user.activeRole,
          },
        },
      });
      return { ...snapshot, receivedAt: performance.now() };
    },
    enabled: typeof window !== "undefined" && Boolean(user.employeeId),
    refetchInterval: 60_000,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const data = query.data;
  // Server time anchors the counter, rather than trusting the computer's clock.
  const elapsed = data ? Math.max(0, performance.now() - data.receivedAt) : 0;
  const stale = elapsed > 120_000;
  const now = data ? Date.parse(data.serverNow) + Math.min(elapsed, 120_000) : 0;
  const record = data?.record ?? null;
  const status =
    record?.clockOutAt && Date.parse(record.clockOutAt) <= now
      ? "Clocked out"
      : record?.clockInAt && Date.parse(record.clockInAt) <= now
        ? "Working"
        : "Not clocked in";
  const clockIn =
    record?.clockInAt && data
      ? new Intl.DateTimeFormat(undefined, {
          timeZone: data.timezone,
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(record.clockInAt))
      : "—";
  if (data && !data.tracked && !record?.clockInAt && !record?.clockOutAt)
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div>
          <p className="font-medium">My timesheet</p>
          <p className="text-sm text-muted-foreground">
            Record your work hours. Biometric attendance is not required.
          </p>
        </div>
        <a
          href="/staff/me/timesheets"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Open timesheet
        </a>
      </section>
    );
  return (
    <section aria-label="Today's attendance" className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock3 className="h-4 w-4 text-primary" />
          Worked today
        </div>
        {data && (
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            {stale ? "Sync delayed" : status}
          </span>
        )}
      </div>
      {!data ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {query.isError ? "Attendance unavailable." : "Checking attendance…"}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <p className="text-3xl font-semibold tabular-nums">
            {formatWorkedMinutes(workedMinutes(record, now))}
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {data.tracked && data.expectedDeparture && (
              <span>
                Expected finish{" "}
                <strong className="ml-1 font-medium text-foreground">
                  {data.expectedDeparture}
                  {data.departureDayOffset ? " next day" : ""}
                </strong>
              </span>
            )}
            <span>
              Clocked in <strong className="ml-1 font-medium text-foreground">{clockIn}</strong>
            </span>
            {data.tracked && (
              <span>
                Today's target{" "}
                <strong className="ml-1 font-medium text-foreground">
                  {formatWorkedMinutes(data.targetMinutes)}
                </strong>
              </span>
            )}
          </div>
        </div>
      )}
      {(query.isError || stale) && (
        <button
          type="button"
          className="mt-2 text-xs text-primary underline"
          onClick={() => void query.refetch()}
        >
          {data ? "Sync delayed — retry" : "Try again"}
        </button>
      )}
      {record && (record.breakStartAt || record.breakMinutes > 0) && (
        <p className="mt-2 text-xs text-muted-foreground">Break time is included.</p>
      )}
    </section>
  );
}
