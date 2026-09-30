import { z } from "zod";

const days = z
  .array(z.number().int().min(0).max(365))
  .max(12)
  .refine((v) => new Set(v).size === v.length, "Use each reminder day only once.");
const monthDay = z
  .string()
  .regex(/^\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`2025-${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(5, 10) === value;
  }, "Use a valid month and day, for example 04-30.");
export const ReminderRulesSchema = z
  .object({
    travelEnabled: z.boolean(),
    travelAfterHours: z.number().int().min(1).max(720),
    trainingEnabled: z.boolean(),
    trainingExpiryDays: days,
    leaveEnabled: z.boolean(),
    annualEveryMonths: z.number().int().min(1).max(12),
    carryDeadline: monthDay,
    carryExtraDays: days,
    offerEnabled: z.boolean(),
    offerBeforeHours: z.number().int().min(1).max(720),
    missingClockoutEnabled: z.boolean(),
    missingClockoutStart: z.string().regex(/^(0[6-9]|1[01]):[0-5]\d$/),
    missingClockoutEnd: z.string().regex(/^(0[6-9]|1[01]):[0-5]\d$|^12:00$/),
  })
  .strict()
  .refine(
    (v) => v.missingClockoutStart < v.missingClockoutEnd,
    "Morning reminder end must be after its start.",
  );
export type ReminderRules = z.infer<typeof ReminderRulesSchema>;
export const DEFAULT_REMINDER_RULES: ReminderRules = {
  travelEnabled: true,
  travelAfterHours: 48,
  trainingEnabled: true,
  trainingExpiryDays: [60, 30, 14, 7, 0],
  leaveEnabled: true,
  annualEveryMonths: 1,
  carryDeadline: "04-30",
  carryExtraDays: [15, 7, 1],
  offerEnabled: true,
  offerBeforeHours: 48,
  missingClockoutEnabled: true,
  missingClockoutStart: "09:00",
  missingClockoutEnd: "12:00",
};
export function reminderRulesFromSettings(
  settings?: Record<string, unknown> | null,
): ReminderRules {
  return ReminderRulesSchema.parse({
    ...DEFAULT_REMINDER_RULES,
    ...((settings?.["reminderRules"] as object) ?? {}),
  });
}
/** Only the nearest reached warning, not several reminders at once after an outage. */
export function trainingReminderThreshold(remaining: number, configured: number[]) {
  return [...configured].sort((a, b) => a - b).find((day) => remaining <= day);
}
