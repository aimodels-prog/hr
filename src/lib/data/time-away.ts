import * as z from "zod";

export const TIME_AWAY_CATEGORIES = ["Medical appointment", "Personal matter", "Other"] as const;
export const TIME_AWAY_TREATMENTS = ["Paid time", "Unpaid time", "Leave"] as const;
export const timeAwayDate = z.string().date();
export const timeAwayInput = z
  .object({
    employeeId: z.string().uuid(),
    date: timeAwayDate,
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    category: z.enum(TIME_AWAY_CATEGORIES),
    note: z.string().trim().max(500).default(""),
  })
  .strict()
  .refine((v) => v.endTime > v.startTime, "Return time must be after departure on the same day.");
export function timeAwayMinutes(start: string, end: string) {
  const minutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
  return minutes(end) - minutes(start);
}
export function canRecordTimeAway(
  role: string,
  actorEmployee: string | undefined,
  target: string,
  manager: string | null,
) {
  return (
    ["HR", "Super Admin"].includes(role) ||
    actorEmployee === target ||
    (role === "Line Manager" && !!actorEmployee && manager === actorEmployee)
  );
}
