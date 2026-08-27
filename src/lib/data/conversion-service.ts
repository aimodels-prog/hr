import { EmployeeService } from "./employee-service.ts";
import { CandidateService } from "./candidate-service.ts";
import { OnboardingService } from "./onboarding-service.ts";
import { LocalRepository } from "./repository.ts";
import { getApplicationDataServices } from "./application-data.ts";
import type { Employee, JobOffer, Vacancy } from "./types.ts";
import type { ActorContext } from "./types.ts";

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
    const count = this.empService.getEmployees().length + 1;
    return `VIA-${year}-${String(count).padStart(4, "0")}`;
  }

  private availableWorkspaceEmail(firstName: string, lastName: string): string {
    const base =
      `${firstName}.${lastName}`
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9.]/g, "")
        .replace(/\.+/g, ".")
        .replace(/^\.|\.$/g, "") || "new.employee";
    const used = new Set(
      this.empService
        .getUserRepository()
        .list({ includeArchived: true })
        .map((user) => user.workspaceEmail.toLowerCase()),
    );
    let suffix = 0;
    let email = `${base}@via.example`;
    while (used.has(email)) {
      suffix += 1;
      email = `${base}${suffix}@via.example`;
    }
    return email;
  }

  async convertCandidateToEmployee(
    candidateId: string,
    offerId: string,
    employeeData: Partial<Employee>,
    context: ActorContext,
  ): Promise<string> {
    const candidate = this.candidateService.getCandidate(candidateId, context);
    if (!candidate) throw new Error("Candidate not found");

    if (candidate.convertedToEmployeeId) {
      throw new Error(
        `Candidate already converted to employee ID: ${candidate.convertedToEmployeeId}`,
      );
    }

    const offer = this.offerRepo.getById(offerId);
    if (!offer) throw new Error("Offer not found");

    if (offer.status !== "Accepted") {
      throw new Error("Offer must be Accepted to convert.");
    }
    if (offer.convertedToEmployeeId) {
      throw new Error(`Offer already converted to employee ID: ${offer.convertedToEmployeeId}`);
    }

    // Check for obvious duplicates via EmployeeService (soft block, but here we can enforce or bypass based on context. In real world, we'd return a warning first. Our UI will warn first, so if it reaches here, HR acknowledged it).

    // Candidate.maritalStatus uses a recruitment-tracker vocabulary that doesn't map 1:1
    // onto the employee-record vocabulary - normalize rather than carry the raw value across.
    const employeeMaritalStatus =
      candidate.maritalStatus === "Married (With Family)"
        ? "Married"
        : candidate.maritalStatus === "Single" || candidate.maritalStatus === "Married"
          ? candidate.maritalStatus
          : undefined;
    const workspaceEmail =
      employeeData.workspaceEmail ||
      employeeData.workEmail ||
      this.availableWorkspaceEmail(candidate.firstName, candidate.lastName);
    const vacancy = getApplicationDataServices()
      .storage.readCollection<Vacancy>("vacancies")
      .find((item) => item.id === offer.vacancyId);
    const actorIsEmployee = context.actor.employeeId
      ? this.empService.getById(context.actor.employeeId)
      : undefined;
    const supervisorId =
      employeeData.lineManagerId || vacancy?.hiringManagerId || actorIsEmployee?.id;
    if (!supervisorId && this.empService.getEmployees().length > 0) {
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
      .getEmployeeRepository()
      .update(
        newEmpId,
        { recommendationIds: recommendations.map((recommendation) => recommendation.id) },
        context,
      );

    return newEmpId;
  }
}
