import type { CandidatePreparationRun, CandidateVacancyMatch } from "@/lib/data/types";
import { PRELIMINARY_SCORE_WEIGHTS } from "@/lib/recruitment/preliminary-evidence";

type PreliminaryResult = Pick<
  CandidatePreparationRun | CandidateVacancyMatch,
  | "vacancyRecordVersion"
  | "compulsoryChecks"
  | "matchedSkills"
  | "missingRequiredSkills"
  | "evidence"
  | "warnings"
>;

interface PreliminaryScoreExplanationProps {
  result: PreliminaryResult;
  vacancyTitle: string;
  currentVacancyVersion: number;
}

export function PreliminaryScoreExplanation({
  result,
  vacancyTitle,
  currentVacancyVersion,
}: PreliminaryScoreExplanationProps) {
  const isOutdated = result.vacancyRecordVersion !== currentVacancyVersion;

  return (
    <details className="rounded-lg border bg-muted/20 p-3 text-sm md:col-span-4">
      <summary className="cursor-pointer font-medium text-primary">Why this score?</summary>
      <div className="mt-3 space-y-4 border-t pt-3">
        <p className="text-muted-foreground">
          This preliminary score compares the CV and candidate details with the {vacancyTitle} job
          description. It considers compulsory criteria, minimum experience, required skills and
          overall role relevance. It is a guide for HR, not a verified qualification or hiring
          decision.
        </p>
        <p className="text-muted-foreground">
          Score weighting: compulsory criteria {PRELIMINARY_SCORE_WEIGHTS.compulsoryCriteria}%,
          experience {PRELIMINARY_SCORE_WEIGHTS.experience}%, required skills{" "}
          {PRELIMINARY_SCORE_WEIGHTS.requiredSkills}%, and job-description fit{" "}
          {PRELIMINARY_SCORE_WEIGHTS.roleRelevance}%.
        </p>
        <p className="text-muted-foreground">
          Job-description fit compares the role wording with the candidate information and CV. A
          close match does not prove a licence, degree or other compulsory requirement. Broader
          responsibilities and preferred criteria can inform this fit, but they are not compulsory
          checks.
        </p>
        {isOutdated && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
            The job description has changed since this score was calculated. Prepare the candidate
            again to compare against the current requirements.
          </p>
        )}

        <div>
          <p className="font-medium">Compulsory criteria</p>
          {result.compulsoryChecks.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {result.compulsoryChecks.map((check, index) => (
                <li
                  key={`${check.criterion}-${index}`}
                  className="rounded-md border bg-background p-3"
                >
                  <p className="font-medium">
                    {check.criterion} —{" "}
                    {check.status === "Confirmed" ? "Evidence found" : "HR review needed"}
                  </p>
                  {check.evidence && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                      {check.evidence}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-muted-foreground">
              No compulsory criteria were set for this job.
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border bg-background p-3">
            <p className="font-medium">Required skills found</p>
            <p className="mt-1 text-muted-foreground">
              {result.matchedSkills.length
                ? result.matchedSkills.join(", ")
                : "None confirmed from the CV."}
            </p>
          </div>
          <div className="rounded-md border bg-background p-3">
            <p className="font-medium">Required skills to verify</p>
            <p className="mt-1 text-muted-foreground">
              {result.missingRequiredSkills.length
                ? result.missingRequiredSkills.join(", ")
                : "No required skills are outstanding."}
            </p>
          </div>
        </div>

        {result.evidence.length > 0 && (
          <div>
            <p className="font-medium">How the score was reached</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
              {result.evidence.map((item, index) => (
                <li key={index} className="whitespace-pre-wrap break-words">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.warnings.length > 0 && (
          <div>
            <p className="font-medium">Needs attention</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
              {result.warnings.map((warning, index) => (
                <li key={index} className="whitespace-pre-wrap break-words">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
