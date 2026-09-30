# Dashboard chart verification

## Coverage

HR: attendance trend, annual leave usage/carryover, pending decisions, document expiry,
recruitment pipeline and workforce distribution (department and office).
Employee: completed worked hours versus expected hours and annual leave balance.
HR's selected-employee view must agree with that employee's personal figures.

The September 2026 audit corrected two defects:

- Actual completed and incomplete attendance was excluded from trend counts when tracking
  was unconfigured, not required, or the day had no scheduled hours. Evidence now remains
  visible; missing attendance is inferred only for required days.
- The expected-hours line used today's tracking flag instead of the reporting period.
  Historical expected hours now remain visible after a tracking assignment changes.

An empty attendance period now has an explicit empty state. The recorded-hours panel
retains the same first position as the worked-versus-expected panel.

## Evidence and repeatable checks

- `tests/workforce-analytics.test.ts`: closed/open punches, missing tracking, holidays,
  leave, service dates, tracking effective dates and completed-day boundaries.
- `tests/dashboard-priorities.test.ts`: leave-year boundaries, half days, holiday exclusions
  and non-overlapping expiry buckets.
- `tests/attendance-database.test.ts`: real PostgreSQL regression, employee/HR agreement,
  leave values, employee filters and role restrictions.
- `tests/e2e/dashboard-charts.spec.ts`: all displayed chart tables compared with their
  server results, both periods, both workforce groupings, personal privacy and mobile layout.
- `scripts/verify-dashboard-charts.ts [organisation UUID]`: read-only reconciliation against
  independent SQL totals for completed attendance/hours, headcount, distribution, recruitment,
  annual leave remaining, approval decisions and expiry buckets. Compares every current
  employee's self/HR views for both periods. Prints aggregate data only. Run with the server's
  database environment. A UUID is required if multiple active organisations exist.
- The PostgreSQL CI job runs the reconciliation before repository tests alter staging fixtures.

## Meaning and limits

- Attendance trends cover the previous 7 or 30 **completed** calendar days, not today.
  Today's attendance and the personal live-hours counter are separate.
- Expected hours require configured attendance tracking. No tracking does not erase actual
  punches and does not imply absence. Incomplete punches do not count as completed hours.
- Hours are attendance records, not approved timesheets or approved overtime.
- Expectations use the current working calendar, holidays and daily-hours policy; this is
  not a versioned historical payroll calculation.
- Leave uses the configured entitlement year, not the attendance filter. Used/booked days
  are calculated from approved leave dates; remaining is the saved balance. Carryover is
  an estimate within remaining, not additional entitlement.
- Approvals count decisions in leave, overtime, travel, training and visits—not every task
  in the application. A travel request may require multiple decisions.
- Recruitment counts applications for open vacancies, not unique candidates.
- Workforce distribution counts current employees. Document expiry covers current verified
  employee documents and published company documents, not pending/unverified uploads.
- Automated verification establishes tested behaviour, not a guarantee that all future
  user-entered data or external integrations will always be correct.
