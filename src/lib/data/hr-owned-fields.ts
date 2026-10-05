export function isHrOwnedSetupTask(task: {
  selfServiceFormKey?: string | null;
  documentType?: string | null;
}) {
  return task.selfServiceFormKey === "employment_details" || task.documentType === "work_permit";
}

export function canSeeEmploymentDetails(status: string | undefined, role: string) {
  return role === "HR" || role === "Super Admin" || status === "Confirmed";
}

export function assertHrDocumentWrite(type: string, role: string) {
  if (
    ["work_permit", "insurance_benefits"].includes(type) &&
    role !== "HR" &&
    role !== "Super Admin"
  )
    throw new Error("Only HR can upload work permits and Tables of Benefits.");
}
