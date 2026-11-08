import type { InterviewEvent } from "./types.ts";

export function isRealGoogleMeetUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "meet.google.com" &&
      !url.pathname.startsWith("/simulated-")
    );
  } catch {
    return false;
  }
}

export function interviewCalendarNeedsRetry(
  interview: Pick<
    InterviewEvent,
    "videoMethod" | "status" | "calendarEventReference" | "meetingJoinUrl"
  >,
): boolean {
  if (interview.videoMethod !== "Google Meet") return false;
  if (interview.status === "Cancelled") return Boolean(interview.calendarEventReference);
  return (
    interview.status === "Scheduled" &&
    (!interview.calendarEventReference ||
      interview.calendarEventReference === "pending" ||
      !isRealGoogleMeetUrl(interview.meetingJoinUrl))
  );
}
