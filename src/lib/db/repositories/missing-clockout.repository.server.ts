import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";

// Reused at enqueue AND immediately before delivery. All dates use the organisation's zone.
export function missingClockoutCandidates(at = new Date()) {
  return sql`SELECT a.id, a.organisation_id, a.employee_id, a.date, u.id AS user_id
    FROM attendance_records a
    JOIN app_settings s ON s.organisation_id=a.organisation_id
    JOIN attendance_policies p ON p.organisation_id=a.organisation_id
    JOIN users u ON u.employee_id=a.employee_id AND u.organisation_id=a.organisation_id
    WHERE u.status='Active' AND u.archived_at IS NULL AND a.archived_at IS NULL
      AND a.clock_in_at IS NOT NULL AND a.clock_out_at IS NULL
      AND a.status NOT IN ('Correction Pending','On Leave','Holiday','Rest Day')
      AND a.source <> 'Site Visit Auto'
      AND NOT EXISTS (SELECT 1 FROM office_exceptions x WHERE x.organisation_id=a.organisation_id
        AND x.archived_at IS NULL AND a.employee_id=ANY(x.employee_ids) AND a.date BETWEEN x.start_date AND x.end_date)
      AND a.date = (${at.toISOString()}::timestamptz AT TIME ZONE s.timezone)::date - 1
      AND coalesce((s.additional_settings->'reminderRules'->>'missingClockoutEnabled')::boolean,true)
      AND (${at.toISOString()}::timestamptz AT TIME ZONE s.timezone)::time >= coalesce(s.additional_settings->'reminderRules'->>'missingClockoutStart','09:00')::time
      AND (${at.toISOString()}::timestamptz AT TIME ZONE s.timezone)::time < coalesce(s.additional_settings->'reminderRules'->>'missingClockoutEnd','12:00')::time
      AND a.clock_in_at + (p.standard_daily_hours + 3) * interval '1 hour' <= ${at.toISOString()}::timestamptz
      AND (a.expected_clock_out IS NULL OR
        ((a.date + a.expected_clock_out::time +
          CASE WHEN a.expected_clock_out <= a.expected_clock_in THEN interval '1 day' ELSE interval '0 days' END)
          AT TIME ZONE s.timezone) + interval '2 hours' <= ${at.toISOString()}::timestamptz)
      AND NOT EXISTS (SELECT 1 FROM attendance_corrections c WHERE c.attendance_record_id=a.id
        AND c.organisation_id=a.organisation_id AND c.archived_at IS NULL AND c.status IN ('Pending Manager','Pending HR','Approved'))
      AND NOT EXISTS (SELECT 1 FROM site_visit_requests v WHERE v.employee_id=a.employee_id
        AND v.organisation_id=a.organisation_id AND v.archived_at IS NULL AND v.date=a.date
        AND (v.status='Pending HR' OR (v.status='Approved' AND
          (v.date + v.end_time::time) AT TIME ZONE s.timezone > ${at.toISOString()}::timestamptz)))
      AND NOT EXISTS (SELECT 1 FROM travel_requests t WHERE t.employee_id=a.employee_id
        AND t.organisation_id=a.organisation_id AND t.archived_at IS NULL AND t.status='Pre-authorised'
        AND t.start_date<=a.date AND t.end_date>=(${at.toISOString()}::timestamptz AT TIME ZONE s.timezone)::date)
      AND (a.source <> 'Hardware Terminal' OR EXISTS (
        SELECT 1 FROM attendance_punch_events e JOIN attendance_devices d ON d.id=e.device_id
        WHERE e.attendance_record_id=a.id AND e.organisation_id=a.organisation_id
          AND d.organisation_id=a.organisation_id AND d.is_active=true AND d.archived_at IS NULL
          AND d.last_successful_sync_at >= ${at.toISOString()}::timestamptz - interval '1 hour'
      ))`;
}

export async function enqueueMissingClockoutReminders(at = new Date()) {
  const db = getDatabaseClient();
  const rows = await db.execute(sql`INSERT INTO notifications
    (organisation_id,recipient_user_id,type,title,message,priority,deduplication_key,link,created_by,updated_by)
    SELECT c.organisation_id,c.user_id,'attendance.missing_clockout_reminder','Missing clock-out for yesterday',
      'Your clock-in was recorded yesterday, but no clock-out was received. Enter the time you left for HR to confirm.',
      'Normal','attendance-missing-clockout-' || c.id,
      jsonb_build_object('entityType','attendance-record','entityId',c.id,'path','/staff/me/attendance?correct=' || c.date),
      c.user_id,c.user_id FROM (${missingClockoutCandidates(at)}) c
    ON CONFLICT DO NOTHING RETURNING id`);
  return rows.length;
}

export async function missingClockoutEmailDate(notificationId: string) {
  const [row] = await getDatabaseClient().execute(sql`SELECT c.date::text AS date
    FROM (${missingClockoutCandidates()}) c JOIN notifications n ON n.organisation_id=c.organisation_id
      AND n.recipient_user_id=c.user_id AND n.link->>'entityId'=c.id::text
    WHERE n.id=${notificationId}::uuid AND n.archived_at IS NULL`);
  return row ? String(row["date"]) : null;
}
