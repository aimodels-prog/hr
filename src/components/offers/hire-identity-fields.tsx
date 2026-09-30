import { SearchableSelect } from "@/components/ui/searchable-select";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmployeeService } from "@/lib/data/employee-service";
import { useCurrentUser } from "@/lib/auth";
import type { HireIdentityInput } from "@/lib/recruitment/hire-identity";

export function HireIdentityFields({
  linkedEmployeeId,
  value,
  onChange,
  disabled = false,
}: {
  linkedEmployeeId?: string | undefined;
  value: HireIdentityInput;
  onChange: (value: HireIdentityInput) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const user = useCurrentUser();
  const employees = new EmployeeService().getEmployees(user.getActorContext());
  if (linkedEmployeeId) {
    const employee = employees.find(
      (item) => item.id === linkedEmployeeId || item.databaseId === linkedEmployeeId,
    );
    return (
      <div className="rounded-lg border p-3 text-sm">
        <p className="font-medium">Internal move: {employee?.legalName ?? "Existing employee"}</p>
        <p className="text-muted-foreground">
          Keep the existing profile, email and access. Update employment details separately through
          HR.
        </p>
      </div>
    );
  }
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-lg border p-3">
      <legend className="px-1 font-medium">Employee identity</legend>
      <Label htmlFor={`${id}-employee`}>New hire or existing employee?</Label>
      <SearchableSelect
        disabled={disabled}
        value={value.existingEmployeeId ?? "new"}
        onValueChange={(selected) =>
          onChange(selected === "new" ? {} : { existingEmployeeId: selected })
        }
        id={`${id}-employee`}
        placeholder={"Search person…"}
        options={[
          { value: "new", label: "New employee" },
          ...employees
            .filter((employee) => ["Active", "Probation", "Onboarding"].includes(employee.status))
            .map((employee) => ({
              value: employee.databaseId ?? employee.id,
              label: employee.legalName + " " + "—" + " " + employee.workEmail,
            })),
        ]}
      />
      {!value.existingEmployeeId && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-email`}>Assigned VIA work email</Label>
          <Input
            id={`${id}-email`}
            type="email"
            autoComplete="off"
            value={value.workspaceEmail ?? ""}
            onChange={(event) =>
              onChange({ workspaceEmail: event.target.value, identityConfirmed: false })
            }
          />
        </div>
      )}
      <label className="flex items-start gap-2 text-sm" htmlFor={`${id}-confirm`}>
        <input
          id={`${id}-confirm`}
          type="checkbox"
          checked={value.identityConfirmed ?? false}
          onChange={(event) => onChange({ ...value, identityConfirmed: event.target.checked })}
        />
        {value.existingEmployeeId
          ? "I confirm this candidate is the selected employee."
          : "I confirm this work email has been assigned to this person."}
      </label>
    </fieldset>
  );
}
