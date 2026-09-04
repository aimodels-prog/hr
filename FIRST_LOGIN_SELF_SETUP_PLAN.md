# VIA HR first-login and employee self-setup plan

## Outcome

Every person with a verified `@via-int.com` identity can enter VIA HR without waiting for HR to
create a separate account. The VIA email is the visible, permanent staff identifier. PostgreSQL
UUIDs remain internal record keys so historical links are safe if a person's display details
change.

## End-to-end flow

1. The employee signs in through VIA Portal.
2. VIA HR verifies the signed Portal token and normalized VIA email.
3. VIA HR links an existing employee by VIA email, when one already exists.
4. If no employee exists, VIA HR creates one PostgreSQL employee record, one user record, the
   baseline Employee responsibility, a verified identity mapping, a notification and an audit
   event in one database transaction.
5. A temporary “To be confirmed” employment assignment is used only until the employee submits
   their real details. It cannot silently become a permanent business value.
6. The employee sees the setup journey instead of the dashboard while required self-service work
   remains incomplete.
7. The employee states whether they are a new employee or an existing VIA employee and provides
   their legal name, preferred name, VIA start date, department, position, location, employment
   type, supervisor's VIA email and visa requirement.
8. The employee completes personal details, emergency contacts and bank details.
9. The employee uploads the required passport and national-ID records. Visa/work-permit evidence
   is waived when it is not required. A signed contract is added for a new employee.
10. Sensitive financial information is encrypted in PostgreSQL. Documents use encrypted object
    storage and retain their verification/version history.
11. Every submission, waiver, file upload, identity link and later HR correction is audited.
12. When every mandatory employee-owned setup item is complete, the profile is marked Completed,
    normal staff pages become available and current-year leave allowances are prepared
    idempotently.
13. HR and IT can continue their internal onboarding tasks without blocking the employee from
    normal self-service.

## New and existing employee rules

- **New employee:** the applicable leave policy waiting period is calculated from the employee's
  start date. The VIA annual-leave default is three completed months. The policy remains visible
  with its allowance and eligibility rule, but leave cannot be taken before the calculated date.
- **Existing employee:** the original VIA start date is used. A historic start date normally means
  the waiting period has already been satisfied.
- HR can change the employee category, original start date, department, position, location,
  employment type and supervisor later. Changes require an effective date and reason and remain in
  history.
- HR can change the waiting period for any leave policy from Leave Policies. No form or service
  contains a separate fixed three-month decision.
- Minimum-service rules control the date leave may be taken; they do not hide the employee's future
  allowance.

## Supervisor handling

- When the supervisor already exists, the reporting line is linked immediately.
- When the supervisor has not signed in yet, the verified VIA email is held as a pending reporting
  link.
- The link is resolved automatically when that supervisor first signs in.
- An employee cannot select themselves. Leave remains protected until a valid supervisor record is
  available.
- Supervisor responsibilities are still assigned by HR or Super Admin; a Portal role string cannot
  grant HR, Accounts, Line Manager or Super Admin access.

## Failure and recovery behaviour

- A failed first-login transaction does not leave a partial employee, user or checklist.
- Repeated sign-in reuses the same email-linked records and does not duplicate the employee.
- Repeated leave allowance preparation is idempotent and cannot create duplicate annual balances.
- Invalid or unavailable employment choices are rejected by the server.
- A direct leave request is rejected by the server while profile setup is incomplete.
- Suspended, inactive or archived records remain denied even when the Portal identity is valid.
- Missing supervisor links produce a clear action for HR rather than routing approval to the wrong
  person.

## Acceptance checklist

- [x] Unknown verified VIA email creates one Employee account automatically.
- [x] Existing employee is linked by normalized VIA email.
- [x] Unknown Portal roles cannot elevate access.
- [x] First-login setup blocks other staff pages until employee requirements are complete.
- [x] New/existing classification and original start date are captured.
- [x] Department, position, location, employment type and supervisor are captured from managed data.
- [x] Personal, emergency, bank and required document information is collected.
- [x] New employees receive a signed-contract requirement.
- [x] Visa evidence can be marked not applicable.
- [x] Employee completion releases normal self-service independently of internal HR/IT tasks.
- [x] Leave submission is protected at service/database level until setup completion.
- [x] Annual leave waiting period defaults to three months and is editable by HR.
- [x] Existing staff use their original start date and are not given an artificial new-joiner wait.
- [x] Leave allowances become visible and are created without duplication.
- [x] HR can correct staff category, employment data and reporting line with an audit reason.
- [x] Database migration and automated regression coverage are included.
