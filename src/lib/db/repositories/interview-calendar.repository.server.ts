import "@tanstack/react-start/server-only";

import { and, eq, sql } from "drizzle-orm";
import { getDatabaseClient } from "../client.ts";
import { decryptSensitiveJson } from "../encryption.server.ts";
import { googleCalendarConnections } from "../schema/google-calendar.ts";
import { users } from "../schema/employee.ts";
import { candidates, interviewPanelists, interviews, vacancies } from "../schema/recruitment.ts";
import {
  calendarAccessToken,
  googleCalendarConfig,
  synchroniseCalendarInterview,
} from "../../integrations/google-calendar.server.ts";
import type { InterviewSlot } from "../../data/types.ts";

export async function assertInterviewCalendarConnected(organisationId: string): Promise<void> {
  googleCalendarConfig();
  const [connection] = await getDatabaseClient()
    .select({ organisationId: googleCalendarConnections.organisationId })
    .from(googleCalendarConnections)
    .where(eq(googleCalendarConnections.organisationId, organisationId))
    .limit(1);
  if (!connection)
    throw new Error("Connect the HR Google Calendar before creating a Google Meet interview.");
}

/** Google owns invitations. A deterministic event ID makes retries safe after uncertain responses. */
export async function synchroniseInterviewCalendarInDatabase(
  organisationId: string,
  interviewId: string,
): Promise<void> {
  await getDatabaseClient().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`interview-calendar:${organisationId}:${interviewId}`}))`,
    );
    const [interview] = await tx
      .select()
      .from(interviews)
      .where(and(eq(interviews.organisationId, organisationId), eq(interviews.id, interviewId)))
      .for("update")
      .limit(1);
    if (!interview) throw new Error("Interview not found.");
    if (interview.videoMethod !== "Google Meet") return;
    if (interview.status !== "Scheduled" && interview.status !== "Cancelled") return;
    const [connection] = await tx
      .select()
      .from(googleCalendarConnections)
      .where(eq(googleCalendarConnections.organisationId, organisationId))
      .limit(1);
    if (!connection) throw new Error("Reconnect the HR Google Calendar to finish this booking.");
    const accessToken = await calendarAccessToken(
      decryptSensitiveJson<string>(connection.refreshTokenEncrypted),
    );
    const cancelled = interview.status === "Cancelled";
    const slot = interview.confirmedSlot as InterviewSlot | null;
    if (!cancelled && !slot) throw new Error("A confirmed interview time is required.");
    const [candidate] = await tx
      .select({
        firstName: candidates.firstName,
        lastName: candidates.lastName,
        email: candidates.email,
      })
      .from(candidates)
      .where(
        and(
          eq(candidates.organisationId, organisationId),
          eq(candidates.id, interview.candidateId),
        ),
      )
      .limit(1);
    const [vacancy] = interview.vacancyId
      ? await tx
          .select({ title: vacancies.title })
          .from(vacancies)
          .where(
            and(
              eq(vacancies.organisationId, organisationId),
              eq(vacancies.id, interview.vacancyId),
            ),
          )
          .limit(1)
      : [];
    if (!candidate || !candidate.email?.trim())
      throw new Error("The candidate needs an email address before invitations can be sent.");
    const panel = await tx
      .select({ email: users.workspaceEmail })
      .from(interviewPanelists)
      .innerJoin(users, eq(users.id, interviewPanelists.userId))
      .where(
        and(
          eq(interviewPanelists.organisationId, organisationId),
          eq(interviewPanelists.interviewId, interviewId),
        ),
      );
    if (!panel.length || panel.some((person) => !person.email?.trim()))
      throw new Error("Every interviewer needs a work email address.");
    const result = await synchroniseCalendarInterview(accessToken, {
      organisationId,
      interviewId,
      title: `${interview.stageName}: ${candidate.firstName} ${candidate.lastName}${vacancy ? ` — ${vacancy.title}` : ""}`,
      attendeeEmails: [candidate.email, ...panel.map((person) => person.email)],
      startTime: slot?.startTime ?? new Date().toISOString(),
      endTime: slot?.endTime ?? new Date().toISOString(),
      timezone: slot?.timezone ?? "UTC",
      cancelled,
    });
    await tx
      .update(interviews)
      .set({
        calendarEventReference: cancelled ? null : result.id,
        meetingReference: cancelled ? null : result.id,
        meetingJoinUrl: result.meetUrl,
        updatedAt: new Date(),
        recordVersion: sql`${interviews.recordVersion} + 1`,
      })
      .where(eq(interviews.id, interviewId));
  });
}
