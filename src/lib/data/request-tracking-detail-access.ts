/** Historical reviewers keep their decision history, not indefinite access to changed records. */
export function reviewedEmployeeCurrentDetailsPolicy(
  table: string,
):
  | { kind: "assigned"; module: "Document" | "Training Certificate" | "Employment Confirmation" }
  | { kind: "omit" }
  | { kind: "normal" } {
  switch (table) {
    case "employee_documents":
      return { kind: "assigned", module: "Document" };
    case "training_records":
      return { kind: "assigned", module: "Training Certificate" };
    case "employees":
      return { kind: "assigned", module: "Employment Confirmation" };
    case "profile_change_requests":
      // These requests do not have an independent reviewer assignment.
      return { kind: "omit" };
    default:
      return { kind: "normal" };
  }
}
