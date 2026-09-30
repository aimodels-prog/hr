-- Materialise the existing bootstrap defaults only where no saved policy exists.
-- Existing HR customisations and attendance records are never overwritten.
INSERT INTO attendance_policies
  (organisation_id,standard_daily_hours,expected_clock_in,expected_clock_out,
   default_break_minutes,break_start,late_grace_minutes,maximum_location_accuracy_meters,
   sign_out_reminder_offsets_minutes,created_by,updated_by)
SELECT organisation_id,standard_daily_hours,'08:30','17:30',60,'13:00',5,100,
       ARRAY[0,15,30],created_by,updated_by FROM app_settings
ON CONFLICT (organisation_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO timesheet_settings
  (organisation_id,weekly_period_start_day,standard_daily_hours,submission_deadline_days,
   overtime_threshold_weekly,payroll_lock_behaviour,attendance_variance_tolerance_hours,
   created_by,updated_by)
SELECT organisation_id,COALESCE(working_days[1],1),standard_daily_hours,2,
       standard_weekly_hours,'Manual by HR',0.25,created_by,updated_by FROM app_settings
ON CONFLICT (organisation_id) DO NOTHING;
