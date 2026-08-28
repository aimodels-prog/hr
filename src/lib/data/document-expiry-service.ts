import { SYSTEM_CONTEXT } from "./types.ts";
import { getApplicationDataServices } from "./application-data.ts";
import { DocumentService } from "./document-service.ts";
import { EmployeeService } from "./employee-service.ts";
import { SettingsService } from "./settings-service.ts";
import type { ActorContext, EmployeeDocument } from "./types.ts";
import { can } from "../auth/permissions.ts";

// Once a document is due or overdue, it must keep generating escalating reminders regardless
// of the organisation's configured advance-notice schedule - that part isn't a matter of
// preference, so it is always appended after the org's own configured (positive, "days before
// expiry") thresholds rather than being configurable itself.
const OVERDUE_THRESHOLDS = [0, -1, -7, -14, -30, -60, -90];
const CRITICAL_DOC_TYPES = [
  "passport",
  "visa",
  "work_permit",
  "national_id",
  "contract",
  "driving_licence",
  "professional_certificate",
];

export class DocumentExpiryService {
  private documentService = new DocumentService();
  private employeeService = new EmployeeService();
  private settingsService = new SettingsService();

  constructor() {}

  async runReminderEngine(actorContext: ActorContext) {
    const { notifications, audit } = getApplicationDataServices();
    const allDocs = this.documentService.getDocumentRepository(SYSTEM_CONTEXT).list();
    // The organisation's own configured advance-notice days (e.g. 90/60/30/14/7/1), not a
    // hardcoded list - HR can tune how much warning employees and HR get before a document
    // expires without a code change.
    const configuredDays = [...new Set(this.settingsService.getAppSettings().documentReminderDays)]
      .filter((day) => Number.isFinite(day) && day > 0)
      .sort((a, b) => b - a);
    const reminderThresholds = [...configuredDays, ...OVERDUE_THRESHOLDS];
    const allEmployees = this.employeeService
      .getEmployeeRepository(SYSTEM_CONTEXT)
      .list({ includeArchived: false });
    const hrUsers = this.employeeService
      .getUserRepository(SYSTEM_CONTEXT)
      .list()
      .filter((u) => u.roles.includes("HR") && u.status === "Active");

    const now = new Date();
    // Normalize to start of day
    now.setHours(0, 0, 0, 0);

    for (const doc of allDocs) {
      if (
        !doc.expiryDate ||
        doc.status === "Replaced" ||
        doc.status === "Rejected" ||
        doc.waiverReason
      ) {
        continue; // Skip docs that don't need reminders
      }

      const expiryDate = new Date(doc.expiryDate);
      expiryDate.setHours(0, 0, 0, 0);

      // Skip if snoozed
      if (doc.snoozedUntil) {
        const snoozeDate = new Date(doc.snoozedUntil);
        if (snoozeDate > now) continue;
      }

      const diffTime = expiryDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Every threshold the document has reached or passed, not just an exact match for today.
      // This app has no server-side cron - the engine only runs when someone opens the Document
      // Expiry Centre page - so a run can easily be skipped on the exact calendar day a threshold
      // is crossed. Using `<=` (instead of `===`) means a missed threshold is caught and notified
      // on the next run rather than being silently skipped forever, and a document that's now very
      // overdue backfills every threshold it missed in one pass. This is safe to do in a burst
      // because each (doc, threshold, recipient) notification is deduplicated below via
      // deduplicationKey, so re-detecting an already-reached threshold on a later run is a no-op -
      // a one-time backfill burst is an acceptable trade-off for a client-side app with no
      // scheduled jobs.
      const reachedThresholds = reminderThresholds.filter((t) => daysRemaining <= t);

      if (reachedThresholds.length > 0) {
        const isCritical = CRITICAL_DOC_TYPES.includes(doc.type);
        const employee = allEmployees.find((e) => e.id === doc.employeeId);
        if (!employee) continue;

        const employeeUser = this.employeeService
          .getUserRepository(SYSTEM_CONTEXT)
          .list()
          .find((u) => u.employeeId === employee.id);
        const managerUser = employee.lineManagerId
          ? this.employeeService
              .getUserRepository(SYSTEM_CONTEXT)
              .list()
              .find((u) => u.employeeId === employee.lineManagerId)
          : null;

        const docTypeName = doc.type.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase());

        // Live status, appended to every notification below regardless of which historical
        // threshold it represents, so a backfilled "90-day" reminder still tells the reader
        // where things actually stand today rather than reading as stale/wrong.
        const currentStatus =
          daysRemaining <= 0
            ? `It is now ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"} past its ${doc.expiryDate} expiry date.`
            : `It currently expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}, on ${doc.expiryDate}.`;

        for (const threshold of reachedThresholds) {
          // Each backfilled notification describes ITS OWN threshold, not the live day count -
          // otherwise a document that's 100 days overdue would generate 13 notifications that
          // all read identically ("expires in -100 days"), which looks like a bug/spam rather
          // than 13 distinct milestones that were missed.
          const isThresholdPast = threshold <= 0;
          const milestoneLabel = isThresholdPast
            ? threshold === 0
              ? "was due to expire"
              : `was ${Math.abs(threshold)} day${Math.abs(threshold) === 1 ? "" : "s"} overdue`
            : `was ${threshold} day${threshold === 1 ? "" : "s"} from expiring`;
          const title = isThresholdPast
            ? `Expired Document: ${docTypeName}`
            : `Expiring Document: ${docTypeName} (${threshold}-day reminder)`;
          const message = `The ${docTypeName} for ${employee.preferredName} ${employee.legalName} ${milestoneLabel}. ${currentStatus}`;
          const priority = isThresholdPast || (isCritical && threshold <= 30) ? "High" : "Normal";

          // Notify Employee
          if (employeeUser) {
            notifications.create(
              {
                recipientUserId: employeeUser.id,
                type: "document_expiry",
                title: `Action Required: Your ${title}`,
                message: `Please upload a replacement. ${message}`,
                priority,
                status: "Unread",
                deduplicationKey: `doc_expiry_${doc.id}_${threshold}days_emp`,
                link: {
                  entityType: "employee",
                  entityId: employee.id,
                  path: `/staff/employees/${employee.id}`,
                },
              },
              actorContext,
            );
          }

          // Notify HR (all HR users)
          for (const hr of hrUsers) {
            notifications.create(
              {
                recipientUserId: hr.id,
                type: "document_expiry",
                title: `${title} - ${employee.preferredName}`,
                message,
                priority,
                status: "Unread",
                deduplicationKey: `doc_expiry_${doc.id}_${threshold}days_hr_${hr.id}`,
                link: {
                  entityType: "document_expiry",
                  entityId: doc.id,
                  path: `/staff/document-expiry`,
                },
              },
              actorContext,
            );
          }

          // Notify Manager if critical and at escalation threshold (30 days or overdue)
          if (isCritical && managerUser && threshold <= 30) {
            notifications.create(
              {
                recipientUserId: managerUser.id,
                type: "document_expiry",
                title: `Escalation: ${title} - ${employee.preferredName}`,
                message: `Action is required to ensure business continuity. ${message}`,
                priority: "Critical",
                status: "Unread",
                deduplicationKey: `doc_expiry_${doc.id}_${threshold}days_mgr_${managerUser.id}`,
                link: {
                  entityType: "employee",
                  entityId: employee.id,
                  path: `/staff/employees/${employee.id}`,
                },
              },
              actorContext,
            );
          }
        }
      }
    }
  }

  // Checked against the actor's currently active role, not the full set of roles they have ever
  // been granted - matches the pattern used by EmployeeService/DocumentService/OnboardingService/
  // OffboardingService, all of which check activeRole rather than the assigned-roles list.
  private requireHr(action: string, docId: string, context: ActorContext): void {
    if (context.actor.activeRole !== "HR" && context.actor.activeRole !== "Super Admin") {
      getApplicationDataServices().audit.record({
        context,
        action: "access-denied",
        module: "document-expiry",
        entityType: "employee-document",
        entityId: docId,
        reason: `${action}: Only HR or Super Admin can manage document expiry tracking.`,
        riskLevel: "High",
      });
      throw new Error("Only HR or Super Admin can manage document expiry tracking.");
    }
  }

  assignOwner(docId: string, ownerId: string, actorContext: ActorContext) {
    this.requireHr("assignOwner", docId, actorContext);
    const hrUsers = this.employeeService
      .getUserRepository(SYSTEM_CONTEXT)
      .list()
      .filter((u) => u.roles.includes("HR") && u.status === "Active");
    if (!hrUsers.some((u) => u.id === ownerId)) {
      throw new Error("Assigned owner must be an active HR user.");
    }
    this.documentService
      .getDocumentRepository(SYSTEM_CONTEXT)
      .update(docId, { assignedOwnerId: ownerId }, actorContext);
  }

  snoozeDocument(
    docId: string,
    snoozeUntilDate: string,
    reason: string,
    actorContext: ActorContext,
  ) {
    this.requireHr("snoozeDocument", docId, actorContext);
    if (Number.isNaN(new Date(snoozeUntilDate).getTime())) {
      throw new Error("Snooze date is not a valid date.");
    }
    if (!reason || reason.trim().length < 5) {
      throw new Error("A reason must be provided to snooze a document.");
    }
    this.documentService.getDocumentRepository(SYSTEM_CONTEXT).update(
      docId,
      {
        snoozedUntil: snoozeUntilDate,
        snoozeReason: reason,
      },
      actorContext,
    );
  }

  waiveDocument(docId: string, reason: string, actorContext: ActorContext) {
    this.requireHr("waiveDocument", docId, actorContext);
    if (!reason || reason.trim().length < 5) {
      throw new Error("A reason must be provided to waive a document.");
    }
    this.documentService.getDocumentRepository(SYSTEM_CONTEXT).update(
      docId,
      {
        waiverReason: reason,
      },
      actorContext,
    );
  }
}
