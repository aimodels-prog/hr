export type InterviewRoundMethod = "Phone" | "In-Person" | "Waived" | "Scheduled";

/** One recorded outcome is required before a candidate advances from either shortlist. */
export function validateInterviewRound(
  round: "first" | "second",
  input: { method: InterviewRoundMethod; remark: string; date?: string | undefined },
  latestLocalDay = new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10),
): { method: InterviewRoundMethod; remark: string; date?: string | undefined } {
  const remark = input.remark.trim();
  const minimum = round === "first" ? 5 : 10;
  if (remark.length < minimum || remark.length > 2000)
    throw new Error(`Record a ${round}-round remark (${minimum}–2,000 characters).`);
  if (/\b(?:too old|too young|age|aged|years old|date of birth|dob)\b/i.test(remark))
    throw new Error("Use the job requirements, not a person's age, as the review reason.");
  if (input.method === "Waived" || input.method === "Scheduled")
    return { method: input.method, remark };
  const date = input.date ?? "";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date ||
    date > latestLocalDay
  )
    throw new Error(`Enter a valid ${round}-round conversation date that is not in the future.`);
  return { method: input.method, remark, date };
}
