import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/lib/auth";
import {
  getAttendanceTrackingFn,
  saveAttendanceTrackingFn,
} from "@/lib/server-functions/attendance.server";
import { getMasterDataRepository } from "@/lib/data/master-data";
import { EmployeeService } from "@/lib/data/employee-service";
import { AttendanceService } from "@/lib/data/attendance-service";
import { SettingsService } from "@/lib/data/settings-service";
import { employmentCalendarDate } from "@/lib/data/employment-change-policy";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { trackingAssignment, type AttendanceTrackingMode } from "@/lib/data/attendance-tracking";

export function AttendanceTrackingSettings({ employeeId }: { employeeId?: string }) {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const allowed = ["HR", "Super Admin"].includes(user.activeRole);
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const query = useQuery({
    queryKey: ["attendance-tracking", user.id, user.activeRole],
    queryFn: () => getAttendanceTrackingFn({ data: actor }),
    enabled: allowed,
  });
  const [office, setOffice] = useState("");
  const [mode, setMode] = useState<AttendanceTrackingMode | null>(null);
  const today = employmentCalendarDate(new SettingsService().getAppSettingsSync().timezone);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const employee = employeeId
    ? new EmployeeService().getById(employeeId, user.getActorContext())
    : undefined;
  const databaseId = employee?.databaseId ?? employeeId;
  const policy = query.data;
  if (!allowed) return null;
  const locations = getMasterDataRepository("locations")
    .list()
    .filter((item) => item.isActive);
  const currentMode =
    policy && databaseId
      ? (trackingAssignment(policy, databaseId, today)?.mode ?? "Not required")
      : null;
  const save = async () => {
    setBusy(true);
    try {
      await saveAttendanceTrackingFn({
        data: {
          actor,
          effectiveFrom: date,
          revision: policy?.revision ?? 0,
          ...(employeeId && databaseId
            ? { employeeId: databaseId, mode: mode ?? currentMode ?? "Not required" }
            : { headOfficeLocationId: office }),
        },
      });
      await new AttendanceService().hydrateFromDatabase(user.getActorContext());
      await queryClient.invalidateQueries({ queryKey: ["attendance-tracking"] });
      await queryClient.invalidateQueries({ queryKey: ["workforce-analytics"] });
      await queryClient.invalidateQueries({ queryKey: ["my-live-attendance"] });
      user.refreshRecords();
      toast.success("Attendance eligibility saved. Timesheets and leave are unchanged.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save attendance eligibility.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-4"
      aria-label="Attendance eligibility"
    >
      <h3 className="font-semibold">
        {employeeId ? "Attendance tracking" : "Head Office attendance"}
      </h3>
      <p className="text-sm text-muted-foreground">
        Timesheets and leave remain available to everyone.
      </p>
      {query.isPending ? (
        <p className="text-sm">Loading settings…</p>
      ) : query.isError ? (
        <Button variant="outline" onClick={() => void query.refetch()}>
          Retry settings
        </Button>
      ) : (
        <>
          {employeeId ? (
            policy ? (
              <>
                <p className="text-sm">Current: {currentMode}</p>
                <select
                  aria-label="Attendance tracking mode"
                  className="h-11 w-full rounded-md border bg-background px-3"
                  value={mode ?? currentMode ?? "Not required"}
                  onChange={(event) => setMode(event.target.value as AttendanceTrackingMode)}
                >
                  <option>Not required</option>
                  <option>Head Office biometric</option>
                </select>
              </>
            ) : (
              <p className="text-sm">First select Head Office in Attendance → Office Setup.</p>
            )
          ) : policy ? (
            <p className="text-sm">
              Head Office:{" "}
              {locations.find(
                (item) => (item.databaseId ?? item.id) === policy.headOfficeLocationId,
              )?.name ?? "Configured"}{" "}
              · Effective {policy.effectiveFrom}
            </p>
          ) : (
            <>
              <p className="text-sm">
                Select the location using the machine. Staff elsewhere will not receive
                missing-punch or absence warnings.
              </p>
              <select
                aria-label="Head Office location"
                className="h-11 w-full rounded-md border bg-background px-3"
                value={office}
                onChange={(event) => setOffice(event.target.value)}
              >
                <option value="">Select Head Office</option>
                {locations.map((item) => (
                  <option key={item.id} value={item.databaseId ?? item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {(employeeId ? Boolean(policy) : !policy) && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                Effective from
                <input
                  type="date"
                  className="mt-1 block h-11 rounded-md border bg-background px-3"
                  min={today}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <Button disabled={busy || (!employeeId && !office)} onClick={() => void save()}>
                {busy ? "Saving…" : "Save attendance settings"}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
