import type { Candidate, CandidateApplication, CandidateScoreRun, Vacancy } from "./types.ts";
import { SYSTEM_ACTOR, type ActorContext } from "./types.ts";
import {
  getIntegrationProviderRegistry,
  IntegrationOperationService,
  type AiProvider,
} from "../integrations/index.ts";

export class LocalScoringService {
  constructor(
    private readonly provider: AiProvider = getIntegrationProviderRegistry().ai,
    private readonly operations: IntegrationOperationService = new IntegrationOperationService(),
  ) {}

  scoreCandidate(
    candidate: Candidate,
    vacancy: Vacancy,
    application?: CandidateApplication,
    context: ActorContext = { actor: SYSTEM_ACTOR },
  ): Omit<
    CandidateScoreRun,
    "id" | "createdAt" | "updatedAt" | "recordVersion" | "createdBy" | "updatedBy"
  > {
    const operation = this.operations.start(
      {
        operationType: "candidate_scoring",
        relatedEntityType: "candidate",
        relatedEntityId: candidate.id,
        providerName: this.provider.metadata.name,
        requestSummary: {
          vacancyId: vacancy.id,
          vacancyVersion: vacancy.recordVersion,
          candidateId: candidate.id,
          applicationId: application?.id ?? null,
        },
      },
      context,
    );
    this.operations.beginAttempt(operation.id, context);

    try {
      const result = this.provider.scoreCandidate(candidate, vacancy, application);
      this.operations.complete(
        operation.id,
        {
          overallScore: result.overallScore,
          modelRulesVersion: result.modelRulesVersion,
          riskCount: result.risks.length,
          missingDataCount: result.missingData.length,
        },
        context,
        { status: this.provider.metadata.mode === "local" ? "Simulated" : "Completed" },
      );
      return result;
    } catch (error) {
      this.operations.fail(operation.id, error, context);
      throw error;
    }
  }
}
