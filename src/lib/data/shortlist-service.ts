import { getApplicationDataServices } from "./application-data.ts";
import { recordAccessDenied } from "./audit-service.ts";
import { LocalRepository, type NewRecord } from "./repository.ts";
import type { ActorContext, CandidateScoreRun, ShortlistSnapshot } from "./types.ts";
import { CandidateService } from "./candidate-service.ts";

const MIN_SHORTLIST_SIZE = 1;
const MAX_SHORTLIST_SIZE = 10;
const INELIGIBLE_STAGES = ["Hired", "Offer", "Withdrawn", "Archived"];

function hasShortlistManageRole(actorContext: ActorContext): boolean {
  const role = actorContext.actor.activeRole;
  return !!role && (role === "HR" || role === "Super Admin");
}

function validateOverrideReasons(overrides: ShortlistSnapshot["overrides"] | undefined): void {
  for (const override of overrides || []) {
    if (!override.reason || override.reason.trim().length === 0) {
      throw new Error(
        `An override reason is required for candidate ${override.candidateId} (type ${override.type}).`,
      );
    }
  }
}

function validateShortlistSelection(
  snapshot: Pick<
    ShortlistSnapshot,
    | "targetSize"
    | "rankedCandidateIds"
    | "selectedCandidateIds"
    | "pinnedCandidateIds"
    | "overrides"
  >,
): void {
  if (
    !Number.isInteger(snapshot.targetSize) ||
    snapshot.targetSize < MIN_SHORTLIST_SIZE ||
    snapshot.targetSize > MAX_SHORTLIST_SIZE
  ) {
    throw new Error(
      `The shortlist size must be between ${MIN_SHORTLIST_SIZE} and ${MAX_SHORTLIST_SIZE}.`,
    );
  }
  const selectedIds = new Set(snapshot.selectedCandidateIds);
  if (selectedIds.size !== snapshot.selectedCandidateIds.length) {
    throw new Error("The shortlist contains the same candidate more than once.");
  }
  if (selectedIds.size !== snapshot.targetSize) {
    throw new Error(
      `Select exactly ${snapshot.targetSize} candidate${snapshot.targetSize === 1 ? "" : "s"} before finalising.`,
    );
  }
  for (const candidateId of snapshot.pinnedCandidateIds || []) {
    if (!selectedIds.has(candidateId)) {
      throw new Error(`Pinned candidate ${candidateId} must remain in the shortlist.`);
    }
  }

  const expectedTopIds = new Set(snapshot.rankedCandidateIds.slice(0, snapshot.targetSize));
  const rankedIds = new Set(snapshot.rankedCandidateIds);
  const overrides = new Map(
    (snapshot.overrides || []).map((override) => [
      `${override.candidateId}:${override.type}`,
      override,
    ]),
  );

  for (const candidateId of expectedTopIds) {
    if (!selectedIds.has(candidateId) && !overrides.has(`${candidateId}:excluded_top`)) {
      throw new Error(`Explain why top-ranked candidate ${candidateId} was excluded.`);
    }
  }
  for (const candidateId of selectedIds) {
    if (expectedTopIds.has(candidateId)) continue;
    const requiredType = rankedIds.has(candidateId) ? "included_low" : "included_unscored";
    if (!overrides.has(`${candidateId}:${requiredType}`)) {
      throw new Error(`Explain why candidate ${candidateId} was added outside the top ranking.`);
    }
  }
}

export class ShortlistService {
  private shortlistRepo: LocalRepository<ShortlistSnapshot>;
  private candidateService: CandidateService;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.shortlistRepo = new LocalRepository<ShortlistSnapshot>(
      "shortlist_snapshots",
      storage,
      audit,
      { module: "recruitment", entityType: "shortlist" },
    );
    this.candidateService = new CandidateService();
  }

  getShortlistRepository() {
    return this.shortlistRepo;
  }

  getDraftForVacancy(vacancyId: string): ShortlistSnapshot | undefined {
    return this.shortlistRepo.list().find((s) => s.vacancyId === vacancyId && s.status === "Draft");
  }

  getFinalizedForVacancy(vacancyId: string): ShortlistSnapshot | undefined {
    // Return the most recent finalized snapshot
    const finalized = this.shortlistRepo
      .list()
      .filter((s) => s.vacancyId === vacancyId && s.status === "Finalized");
    return finalized.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
  }

  saveDraft(payload: NewRecord<ShortlistSnapshot>, context: ActorContext): ShortlistSnapshot {
    if (!hasShortlistManageRole(context)) {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "shortlist",
        entityId: payload.vacancyId,
        action: "shortlist_save_denied",
        context,
      });
      throw new Error("Unauthorized to manage shortlists.");
    }
    validateOverrideReasons(payload.overrides);
    if (
      !Number.isInteger(payload.targetSize) ||
      payload.targetSize < MIN_SHORTLIST_SIZE ||
      payload.targetSize > MAX_SHORTLIST_SIZE
    ) {
      throw new Error(
        `The shortlist size must be between ${MIN_SHORTLIST_SIZE} and ${MAX_SHORTLIST_SIZE}.`,
      );
    }

    const existing = this.getDraftForVacancy(payload.vacancyId);
    if (existing) {
      return this.shortlistRepo.update(existing.id, payload, context);
    } else {
      return this.shortlistRepo.create(payload, context);
    }
  }

  finalizeShortlist(
    snapshotId: string,
    unselectedAction: "On Hold" | "Not Selected",
    context: ActorContext,
  ): ShortlistSnapshot {
    if (!hasShortlistManageRole(context)) {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "shortlist",
        entityId: snapshotId,
        action: "shortlist_finalize_denied",
        context,
      });
      throw new Error("Unauthorized to finalize shortlists.");
    }

    const snapshot = this.shortlistRepo.getById(snapshotId);
    if (!snapshot) throw new Error("Shortlist snapshot not found");
    if (snapshot.status === "Finalized") throw new Error("Shortlist already finalized");

    validateOverrideReasons(snapshot.overrides);
    validateShortlistSelection(snapshot);

    const candidateRepoForEligibility = this.candidateService.getCandidateRepository();
    for (const candidateId of snapshot.selectedCandidateIds) {
      const candidate = candidateRepoForEligibility.getById(candidateId);
      if (!candidate) {
        throw new Error(`Selected candidate ${candidateId} no longer exists.`);
      }
      if (INELIGIBLE_STAGES.includes(candidate.stage)) {
        throw new Error(
          `Candidate ${candidate.firstName} ${candidate.lastName} cannot be shortlisted - they are already in the ${candidate.stage} stage.`,
        );
      }
    }

    // Get all candidates associated with this vacancy to process them
    // Actually we only need to process the ones that are active and applied/scored
    // A simpler way: we have `selectedCandidateIds`.
    const selectedIds = new Set(snapshot.selectedCandidateIds);

    // We also need the full list of candidates that were considered for this vacancy
    // For this mock, we'll update the selected to "Shortlisted"
    // and any other candidate who applied to this vacancy to `unselectedAction` if they are in an active pre-shortlist stage
    const candidateRepo = this.candidateService.getCandidateRepository();
    const applications = getApplicationDataServices().storage.readCollection<{
      vacancyId: string;
      candidateId: string;
    }>("applications");

    const vacancyApplicants = applications
      .filter((application) => application.vacancyId === snapshot.vacancyId)
      .map((application) => application.candidateId);

    // Also include candidates that have a score run for this vacancy
    const scoreRepo =
      getApplicationDataServices().storage.readCollection<CandidateScoreRun>("candidate_scores");
    const vacancyScored = scoreRepo
      .filter((score) => score.vacancyId === snapshot.vacancyId)
      .map((score) => score.candidateId);

    const consideredIds = new Set([...vacancyApplicants, ...vacancyScored]);

    for (const id of consideredIds) {
      const candidate = candidateRepo.getById(id);
      if (!candidate) continue;

      // We don't touch Hired, Offer, Withdrawn, Archived
      if (["Hired", "Offer", "Withdrawn", "Archived"].includes(candidate.stage)) continue;

      if (selectedIds.has(id)) {
        candidateRepo.update(candidate.id, { stage: "Shortlisted" }, context);
        this.candidateService.updateApplicationStatus(
          candidate.id,
          snapshot.vacancyId,
          "Shortlisted",
          context,
        );
      } else {
        // Demote unselected
        if (
          candidate.stage === "Applied" ||
          candidate.stage === "Screened" ||
          candidate.stage === "Sourced"
        ) {
          candidateRepo.update(candidate.id, { stage: unselectedAction }, context);
          this.candidateService.updateApplicationStatus(
            candidate.id,
            snapshot.vacancyId,
            unselectedAction === "On Hold" ? "On Hold" : "Rejected",
            context,
          );
        }
      }
    }

    return this.shortlistRepo.update(
      snapshot.id,
      {
        status: "Finalized",
        unselectedAction,
      },
      context,
    );
  }
}
