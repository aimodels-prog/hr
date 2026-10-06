import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DocumentRequirement } from "@/lib/data/document-requirements";
export function RequirementFields({
  requirement,
  answers,
  onChange,
  isHr,
}: {
  requirement: DocumentRequirement;
  answers: Record<string, string>;
  onChange: (answers: Record<string, string>) => void;
  isHr: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {requirement.fields
        .filter((f) => isHr || f.owner !== "HR")
        .map((f) => (
          <div key={f.key} className="space-y-2">
            <Label htmlFor={`doc-${f.key}`}>
              {f.label}
              {f.required ? " *" : ""}
              {f.owner === "HR" ? " (HR)" : ""}
            </Label>
            <Input
              id={`doc-${f.key}`}
              type={f.kind === "date" ? "date" : f.kind === "year" ? "number" : "text"}
              value={answers[f.key] ?? ""}
              maxLength={2000}
              onChange={(e) => onChange({ ...answers, [f.key]: e.target.value })}
            />
          </div>
        ))}
      {!isHr && requirement.fields.some((f) => f.owner === "HR") && (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          HR will complete the official details during review.
        </p>
      )}
    </div>
  );
}
