export function isHrOwnedSetupTask(task: {
  selfServiceFormKey?: string | null;
  documentType?: string | null;
}) {
  return (
    task.selfServiceFormKey === "employment_details" ||
    task.documentType === "visa" ||
    task.documentType === "work_permit"
  );
}

export function canSeeEmploymentDetails(status: string | undefined, role: string) {
  return role === "HR" || role === "Super Admin" || status === "Confirmed";
}

export function assertHrDocumentWrite(type: string, role: string) {
  if ((type === "visa" || type === "work_permit") && role !== "HR" && role !== "Super Admin")
    throw new Error("Only HR can upload or change visa and work-permit documents.");
}
