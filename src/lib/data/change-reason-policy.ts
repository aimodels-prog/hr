/** Shared UI/server policy. Required decisions must never receive an automatic reason. */
export function changedRecordFields(
  before: Record<string, unknown>,
  changes: Record<string, unknown>,
): string[] {
  return Object.keys(changes).filter(
    (key) =>
      changes[key] !== undefined &&
      JSON.stringify(before[key] === "" ? null : (before[key] ?? null)) !==
        JSON.stringify(changes[key] === "" ? null : (changes[key] ?? null)),
  );
}

export function employmentReasonRequired(
  fields: string[],
  confirmationStatus?: string | null,
): boolean {
  if (fields.includes("salary")) return true;
  const initial = ["Not Submitted", "Pending HR Review", "Changes Requested"].includes(
    confirmationStatus ?? "",
  );
  if (initial) return false;
  return fields.some((field) => !["location", "projectId", "costCentreId"].includes(field));
}

export function personalReasonRequired(fields: string[]): boolean {
  return fields.some(
    (field) =>
      !["preferredName", "phone", "personalEmail", "address", "emergencyContacts"].includes(field),
  );
}

export function trainingReasonRequired(
  course: { cost: number | string; isMandatory: boolean },
  origin: string,
): boolean {
  return !(Number(course.cost) === 0 || (origin === "HR Assignment" && course.isMandatory));
}

export function vacancyReasonRequired(
  current: string,
  next: string,
  hiredCount: number,
  headcount: number,
): boolean {
  return !(
    next === "Pending Approval" ||
    (current === "Pending Approval" && next === "Open") ||
    (current === "Closed" && next === "Archived") ||
    (["Open", "Paused"].includes(current) &&
      next === "Closed" &&
      headcount > 0 &&
      hiredCount >= headcount)
  );
}

export function changeReason(
  reason: string,
  required: boolean,
  fallback: string,
  minimum = 5,
): string {
  const value = reason.trim();
  if (required && value.length < minimum)
    throw new Error(`Give a reason of at least ${minimum} characters for this change.`);
  return value || fallback;
}
