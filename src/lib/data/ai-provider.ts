import { SYSTEM_ACTOR, type ActorContext } from "./types.ts";
import {
  getIntegrationProviderRegistry,
  IntegrationOperationService,
  type GeneratedJobDescription,
  type IntegrationProviderRegistry,
  type JobFacts,
} from "../integrations/index.ts";
import {
  cleanMandatoryCriteria,
  ensureMandatoryCriteria,
  findMissingMandatoryCriteria,
} from "./job-description-criteria.ts";

export type { GeneratedJobDescription, JobFacts } from "../integrations/types.ts";

export interface GenerateJobDescriptionOptions {
  context?: ActorContext;
  relatedEntityType?: string;
  relatedEntityId?: string;
  providers?: IntegrationProviderRegistry;
  operations?: IntegrationOperationService;
}

export async function generateDraftJobDescription(
  facts: JobFacts,
  options: GenerateJobDescriptionOptions = {},
): Promise<GeneratedJobDescription> {
  const mandatoryCriteria = cleanMandatoryCriteria(facts.mandatoryCriteria);
  const providers = options.providers ?? getIntegrationProviderRegistry();
  const operations = options.operations ?? new IntegrationOperationService();
  const context = options.context ?? { actor: SYSTEM_ACTOR };
  const operation = operations.start(
    {
      operationType: "job_description",
      relatedEntityType: options.relatedEntityType ?? "vacancy-draft",
      relatedEntityId: options.relatedEntityId ?? "new-vacancy",
      providerName: providers.ai.metadata.name,
      requestSummary: {
        title: facts.title,
        department: facts.department,
        location: facts.location,
        employmentType: facts.employmentType,
        requiredSkillsCount: facts.skills.required.length,
        preferredSkillsCount: facts.skills.preferred.length,
        mandatoryCriteriaCount: mandatoryCriteria.length,
      },
    },
    context,
  );
  operations.beginAttempt(operation.id, context);

  try {
    if (mandatoryCriteria.length === 0) {
      throw new Error("Add at least one compulsory criterion before generating the description.");
    }
    const result = await providers.ai.generateJobDescription({
      ...facts,
      mandatoryCriteria,
    });
    const missingFromProvider = findMissingMandatoryCriteria(
      mandatoryCriteria,
      result.requirements,
    );
    const protectedResult = {
      ...result,
      requirements: ensureMandatoryCriteria(result.requirements, mandatoryCriteria),
    };
    operations.complete(
      operation.id,
      {
        summaryGenerated: protectedResult.summary.length > 0,
        responsibilityCount: protectedResult.responsibilities.length,
        requirementCount: protectedResult.requirements.length,
        protectedCriteriaCount: mandatoryCriteria.length,
        criteriaRestoredCount: missingFromProvider.length,
      },
      context,
      { status: providers.ai.metadata.mode === "local" ? "Simulated" : "Completed" },
    );
    return protectedResult;
  } catch (error) {
    operations.fail(operation.id, error, context);
    throw error;
  }
}
