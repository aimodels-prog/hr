export interface HireIdentityInput {
  existingEmployeeId?: string | undefined;
  workspaceEmail?: string | undefined;
  identityConfirmed?: boolean | undefined;
}

/** Names and candidate contact addresses must never be used to invent a login identity. */
export function resolveHireIdentity(
  input: HireIdentityInput | undefined,
  linkedEmployeeId: string | null | undefined,
  allowedDomain: string,
): { kind: "Existing"; employeeId: string } | { kind: "New"; workspaceEmail: string } {
  if (linkedEmployeeId) {
    if (
      (input?.existingEmployeeId && input.existingEmployeeId !== linkedEmployeeId) ||
      input?.workspaceEmail?.trim()
    )
      throw new Error("This internal applicant must keep their existing employee identity.");
    return { kind: "Existing", employeeId: linkedEmployeeId };
  }
  if (!input?.identityConfirmed)
    throw new Error(
      "Confirm the existing employee or the assigned VIA work email before continuing.",
    );
  if (input.existingEmployeeId) {
    if (input.workspaceEmail?.trim())
      throw new Error("Choose an existing employee or a new work email, not both.");
    return { kind: "Existing", employeeId: input.existingEmployeeId };
  }
  const email = input.workspaceEmail?.trim().toLowerCase() ?? "";
  const domain = allowedDomain.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || domain.includes(".."))
    throw new Error("The allowed VIA email domain is not configured correctly.");
  const parts = email.split("@");
  if (
    parts.length !== 2 ||
    parts[1] !== domain ||
    !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i.test(parts[0] ?? "")
  )
    throw new Error(
      `Enter the assigned work email at ${domain}; a personal email cannot be used for VIA access.`,
    );
  return { kind: "New", workspaceEmail: email };
}

export function assertReusableEmployeeIdentity(
  employee: {
    status: string;
    archivedAt?: unknown;
    workspaceEmail?: string | null;
    workEmail: string;
  },
  account: { status: string; archivedAt?: unknown; workspaceEmail: string } | undefined,
): void {
  if (employee.archivedAt || !["Active", "Probation", "Onboarding"].includes(employee.status))
    throw new Error(
      "This employee is not available for an internal move. Resolve their employment status first.",
    );
  if (!account || account.archivedAt || account.status !== "Active")
    throw new Error(
      "The existing employee needs an active linked VIA account. No new account has been created.",
    );
  const email = account.workspaceEmail.trim().toLowerCase();
  if (
    employee.workEmail.trim().toLowerCase() !== email ||
    (employee.workspaceEmail && employee.workspaceEmail.trim().toLowerCase() !== email)
  )
    throw new Error(
      "The employee and account email identities disagree. HR must resolve this before linking the offer.",
    );
}
