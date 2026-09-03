# VIA HR data retention and disposal policy

This policy must be approved by VIA's authorised privacy and legal owners before production data is imported. Local law, an employment claim, an investigation or a contractual obligation may require a longer period than the operational defaults below.

## Record classes

| Record class                                              | Working rule                                                                        | End-of-period action                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Active employee file, payroll and statutory evidence      | Retain throughout employment and the legally approved period after departure        | Restrict access, then archive or delete as approved            |
| Recruitment application and CV                            | Retain for the active recruitment decision and approved future-consideration period | Anonymise analytics and delete identifying documents           |
| Unsuccessful candidate marked Do Not Contact              | Stop contact immediately; retain only the minimum suppression record                | Delete CV and non-essential personal information               |
| Leave, attendance, timesheet, overtime and travel records | Retain for the approved employment, payroll and audit period                        | Archive, then delete when no hold applies                      |
| Performance, disciplinary and confidential HR records     | Retain only for the approved purpose and period with restricted access              | Secure deletion; do not retain in general reports              |
| Audit history                                             | Retain for the approved security and accountability period                          | Archive immutably, then delete only with written authorisation |
| Encrypted backups                                         | 35 days by default, unless the approved recovery policy says otherwise              | Automated off-server deletion after a successful newer backup  |

## Required controls

- A legal hold overrides automated archival, anonymisation and deletion.
- Every disposal batch must have an authorised owner, reason, scope preview and reconciliation report.
- Files and their PostgreSQL metadata must be disposed of together; orphan cleanup must never delete a referenced object.
- Production deletion must be performed by a server worker, be idempotent and create an immutable audit event without copying sensitive field values into the audit record.
- Database backups and object backups are encrypted with a dedicated versioned keyring. Previous keys remain available until every backup using them has expired.
- Backups must be stored outside the Contabo VPS and restored into an isolated environment on a scheduled basis.
- The browser application cannot import, restore or reset the production database.

The Module 15 worker will execute approved scheduled retention jobs. Until that worker is enabled, retention actions are administrative and must follow a reviewed preview-and-approval process.
