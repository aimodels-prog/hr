import { SYSTEM_CONTEXT } from "./types.ts";
import { EmployeeService } from "./employee-service.ts";
import { CandidateService } from "./candidate-service.ts";
import { OnboardingService } from "./onboarding-service.ts";
import { LocalRepository } from "./repository.ts";
import { getApplicationDataServices } from "./application-data.ts";
import type { Employee, JobOffer, Vacancy } from "./types.ts";
import type { ActorContext } from "./types.ts";
import {
  assertReusableEmployeeIdentity,
  resolveHireIdentity,
  type HireIdentityInput,
} from "../recruitment/hire-identity.ts";

export class ConversionService {
  private empService = new EmployeeService();
  private candidateService = new CandidateService();
  private offerRepo: LocalRepository<JobOffer>;
  private obService = new OnboardingService();

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.offerRepo = new LocalRepository<JobOffer>("job_offers", storage, audit, {
      module: "recruitment",
      entityType: "offer",
    });
  }

  private nextEmployeeNumber(): string {
    const year = new Date().getFullYear();
    const count = this.empService.getEmployees(SYSTEM_CONTEXT).length + 1;
    return `VIA-${year}-${String(count).padStart(4, "0")}`;
  }

  async convertCandidateToEmployee(
    candidateId: string,
    offerId: string,
    employeeData: Partial<Employee>,
    context: ActorContext,
    hireIdentity?: HireIdentityInput,
  ): Promise<string> {
    if (!["HR", "Super Admin"].includes(context.actor.activeRole ?? ""))
      throw new Error("Only HR or a Super Admin can convert an accepted offer.");
    if (typeof window !== "undefined") {
      const candidate = this.candidateService.getCandidate(candidateId, context);
      if (!candidate) throw new Error("Candidate not found");
      const offer = this.offerRepo.getById(offerId);
      if (!offer) throw new Error("Offer not found");
      if (offer.candidateId !== candidate.id)
        throw new Error("The accepted offer does not belong to this candidate.");
      const { convertAcceptedJobOfferFn } = await import("../server-functions/offer.server.ts");
      const converted = await convertAcceptedJobOfferFn({
        data: {
          actor: {
            actorId: context.actor.userId,
            ...(context.actor.workspaceEmail ? { actorEmail: context.actor.workspaceEmail } : {}),
            activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
          },
          offerId: offer.id,
          ...(hireIdentity ? { hireIdentity } : {}),
        },
      });
      await Promise.all([
        this.candidateService.hydrateCompatibilityCache(context),
        this.empService.hydrateCompatibilityCache(context),
        this.obService.hydrateCompatibilityCache(context),
      ]);
      return converted.employeeId;
    }

    const candidate = this.candidateService.getCandidate(candidateId, context);
    if (!candidate) throw new Error("Candidate not found");

    const offer = this.offerRepo.getById(offerId);
    if (!offer) throw new Error("Offer not found");
    if (offer.candidateId !== candidate.id)
      throw new Error("The accepted offer does not belong to this candidate.");

    if (offer.status !== "Accepted") {
      throw new Error("Offer must be Accepted to convert.");
    }
    if (offer.convertedToEmployeeId) {
      throw new Error(`Offer already converted to employee ID: ${offer.convertedToEmployeeId}`);
    }

    const application = this.candidateService
      .getApplicationRepository()
      .list()
      .find((item) => item.candidateId === candidate.id && item.vacancyId === offer.vacancyId);
    if (
      (application?.source === "Internal Application" ||
        candidate.source === "Internal Application") &&
      !application?.internalApplicantEmployeeId &&
      !candidate.convertedToEmployeeId
    )
      throw new Error(
        "The internal application is missing its employee link. Repair it before continuing.",
      );
    if (
      application?.internalApplicantEmployeeId &&
      candidate.convertedToEmployeeId &&
      application.internalApplicantEmployeeId !== candidate.convertedToEmployeeId
    )
      throw new Error("The application and candidate point to different employees.");
    const identity = resolveHireIdentity(
      hireIdentity,
      application?.internalApplicantEmployeeId ?? candidate.convertedToEmployeeId,
      "via-int.com",
    );
    const allEmployees = this.empService
      .getEmployeeRepository(SYSTEM_CONTEXT)
      .list({ includeArchived: true });
    if (identity.kind === "Existing") {
      const existing = allEmployees.find((item) => item.id === identity.employeeId);
      if (!existing) throw new Error("The selected employee was not found.");
      const accounts = this.empService
        .getUserRepository(SYSTEM_CONTEXT)
        .list({ includeArchived: true })
        .filter((item) => item.employeeId === existing.id);
      if (accounts.length > 1) throw new Error("This employee has conflicting account mappings.");
      assertReusableEmployeeIdentity(existing, accounts[0]);
      this.candidateService
        .getCandidateRepository()
        .update(candidate.id, { stage: "Hired", convertedToEmployeeId: existing.id }, context);
      this.offerRepo.update(offer.id, { convertedToEmployeeId: existing.id }, context);
      this.candidateService.updateApplicationStatus(
        candidate.id,
        offer.vacancyId,
        "Hired",
        context,
      );
      return existing.id;
    }
    const contactEmails = [candidate.email.toLowerCase().trim(), identity.workspaceEmail];
    if (
      allEmployees.some(
        (item) =>
          item.candidateId === candidate.id ||
          [item.workEmail, item.workspaceEmail, item.personalEmail].some(
            (email) => email && contactEmails.includes(email.trim().toLowerCase()),
          ),
      )
    )
      throw new Error(
        "An employee already matches this candidate or email. Select the existing employee record.",
      );

    // Candidate.maritalStatus uses a recruitment-tracker vocabulary that doesn't map 1:1
    // onto the employee-record vocabulary - normalize rather than carry the raw value across.
    const employeeMaritalStatus =
      candidate.maritalStatus === "Married (With Family)"
        ? "Married"
        : candidate.maritalStatus === "Single" || candidate.maritalStatus === "Married"
          ? candidate.maritalStatus
          : undefined;
    const workspaceEmail = identity.workspaceEmail;
    const vacancy = getApplicationDataServices()
      .storage.readCollection<Vacancy>("vacancies")
      .find((item) => item.id === offer.vacancyId);
    const actorIsEmployee = context.actor.employeeId
      ? this.empService.getById(context.actor.employeeId, SYSTEM_CONTEXT)
      : undefined;
    const supervisorId =
      employeeData.lineManagerId || vacancy?.hiringManagerId || actorIsEmployee?.id;
    if (!supervisorId && this.empService.getEmployees(SYSTEM_CONTEXT).length > 0) {
      throw new Error(
        "Assign a supervisor to the vacancy before onboarding the selected candidate.",
      );
    }

    // Construct the new employee
    const { employee: newEmployee } = await this.empService.createEmployee(
      {
        employeeNumber: employeeData.employeeNumber || this.nextEmployeeNumber(),
        legalName: employeeData.legalName || `${candidate.firstName} ${candidate.lastName}`,
        preferredName: employeeData.preferredName || candidate.firstName,
        workEmail: workspaceEmail,
        personalEmail: candidate.email,
        phone: candidate.phone,
        department: employeeData.department || vacancy?.department || "General",
        position: employeeData.position || offer.position,
        grade: employeeData.grade || offer.grade,
        location: employeeData.location || offer.location,
        employmentType: employeeData.employmentType || "Full-time",
        startDate: employeeData.startDate || offer.startDate,
        ...(employeeData.probationEndDate !== undefined
          ? { probationEndDate: employeeData.probationEndDate }
          : {}),
        ...(supervisorId ? { lineManagerId: supervisorId } : {}),
        status: "Onboarding",
        workspaceEmail,
        ...(candidate.nationality !== undefined ? { nationality: candidate.nationality } : {}),
        ...(employeeMaritalStatus !== undefined ? { maritalStatus: employeeMaritalStatus } : {}),
        candidateId: candidate.id,
        offerId: offer.id,
      },
      ["Employee"],
      context,
    );
    const newEmpId = newEmployee.id;

    // The employee record now genuinely exists, so mark the candidate and offer converted
    // immediately - before any of the downstream setup below, which is more likely to fail on
    // edge-case data. If this guard were set later and one of those steps threw, a retry would
    // not see convertedToEmployeeId yet and would call createEmployee again, producing a second
    // employee record for the same candidate. Setting it here first means a retry after a
    // downstream failure cleanly reports "already converted" instead of duplicating the hire.
    this.candidateService
      .getCandidateRepository()
      .update(candidate.id, { stage: "Hired", convertedToEmployeeId: newEmpId }, context);
    this.offerRepo.update(offer.id, { convertedToEmployeeId: newEmpId }, context);
    this.candidateService.updateApplicationStatus(candidate.id, offer.vacancyId, "Hired", context);

    // Initial Employment History
    this.empService.addEmploymentHistory(
      {
        employeeId: newEmpId,
        effectiveDate: employeeData.startDate || offer.startDate,
        field: "Hired",
        oldValue: "Candidate",
        newValue: "Employee",
        reason: "Converted from Accepted Offer",
      },
      context,
    );

    // Initial Onboarding Case & Checklist
    this.obService.createCaseForEmployee(newEmpId, context);

    // Preserve the complete recruitment source chain on both sides of the conversion.
    const recommendations = this.candidateService.linkRecommendationsToEmployee(
      candidate.id,
      newEmpId,
      context,
    );
    this.empService
      .getEmployeeRepository(SYSTEM_CONTEXT)
      .update(
        newEmpId,
        { recommendationIds: recommendations.map((recommendation) => recommendation.id) },
        context,
      );

    return newEmpId;
  }
}
