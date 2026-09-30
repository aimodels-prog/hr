# Searchable people fields

People lookups use `SearchableSelect`; interview panels use `SearchablePeopleList`. Names are searchable without case or accent sensitivity. Work email, employee number or job details are included where the calling screen has those fields. Values remain stable employee/user/candidate IDs, never display names. Search does not fetch or expand access to other records.

## Coverage

- Leave: covering colleague, manual balance adjustment, late sick-leave permission.
- Attendance: terminal identity matching, manual record employee.
- Overtime: employee on whose behalf HR applies.
- Employee records: new employee supervisor, employment-change supervisor.
- Organisation chart: company head, employee being arranged, supervisor.
- Onboarding: employee and HR case owner; template named task owner.
- Offboarding: employee and HR case owner; case task owner; template named task owner.
- Recruitment: vacancy hiring manager; offer approver; hire identity; candidate pool selection; intake duplicate resolution; candidate HR owner; HR owner and recommender filters; both interview-panel lists.
- Training: employee assignment.
- Finance: payslip employee, payroll manual-adjustment employee.
- Projects: project manager.
- Document expiry: responsible HR owner.
- Audit: actor filter.

The shared employee dashboard filter and directory already have text search and remain unchanged. Short fixed choices such as status, yes/no and role are not turned into people lookups. The covering-colleague lookup uses the public directory, excludes self/inactive/archived people and does not expose private HR records; server-side handover eligibility checks remain in force.

## Checks and maintenance

- `tests/search-options.test.ts`: partial and multiword matching, accents, email/number lookup and 150 records.
- `tests/e2e/people-search.spec.ts`: real leave/HR/Finance dialogs, keyboard and phone layout, selection retention, empty results, duplicate display names with distinct IDs, disabled options, clearing and multi-selection across searches.
- The browser fixture under `tests/e2e/fixtures` is loaded only by the browser tests, never by an application route or release entry point.
- New people fields should use these components with an already authorised list. Preserve special choices (unassigned/automatic/none), validation, eligibility and role boundaries. Do not use a full private employee query just to populate a names list.
