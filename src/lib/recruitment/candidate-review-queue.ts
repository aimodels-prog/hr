/** Keeps one vacancy's review list together while HR opens candidates one after another. */
export interface CandidateReviewQueue {
  vacancyId: string;
  candidateIds: string[];
  tab: "pipeline" | "applications";
  applicationSearch: string;
  applicationSource: string;
  applicationView: string;
  applicationSort: string;
  pipelineView: "all" | "shortlisted" | "interview";
  pipelineSearch: string;
  scrollY: number;
  listScrollTop: number;
}

const key = (vacancyId: string) => `via-hr-candidate-review:${vacancyId}`;

export function saveCandidateReviewQueue(queue: CandidateReviewQueue): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key(queue.vacancyId), JSON.stringify(queue));
  } catch {
    // Navigation remains usable when browser storage is unavailable.
  }
}

export function readCandidateReviewQueue(vacancyId: string): CandidateReviewQueue | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(key(vacancyId));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<CandidateReviewQueue>;
    if (
      parsed.vacancyId !== vacancyId ||
      !Array.isArray(parsed.candidateIds) ||
      parsed.candidateIds.length > 5000 ||
      !parsed.candidateIds.every((id) => typeof id === "string") ||
      !["pipeline", "applications"].includes(parsed.tab ?? "")
    )
      return null;
    return {
      vacancyId,
      candidateIds: [...new Set(parsed.candidateIds)],
      tab: parsed.tab!,
      applicationSearch:
        typeof parsed.applicationSearch === "string" ? parsed.applicationSearch : "",
      applicationSource:
        typeof parsed.applicationSource === "string" ? parsed.applicationSource : "all",
      applicationView: typeof parsed.applicationView === "string" ? parsed.applicationView : "all",
      applicationSort:
        typeof parsed.applicationSort === "string" ? parsed.applicationSort : "newest",
      pipelineView: ["all", "shortlisted", "interview"].includes(parsed.pipelineView ?? "")
        ? parsed.pipelineView!
        : "all",
      pipelineSearch: typeof parsed.pipelineSearch === "string" ? parsed.pipelineSearch : "",
      scrollY: typeof parsed.scrollY === "number" ? parsed.scrollY : 0,
      listScrollTop: typeof parsed.listScrollTop === "number" ? parsed.listScrollTop : 0,
    };
  } catch {
    return null;
  }
}
