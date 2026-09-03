import { getApplicationDataServices } from "./application-data.ts";
import { recordAccessDenied } from "./audit-service.ts";
import {
  cleanMandatoryCriteria,
  findMissingMandatoryCriteria,
} from "./job-description-criteria.ts";
import { LocalRepository } from "./repository.ts";
import type { ActorContext, Vacancy, VacancyStatus } from "./types.ts";

const VACANCY_TRANSITIONS: Record<VacancyStatus, VacancyStatus[]> = {
  Draft: ["Pending Approval", "Closed"],
  "Pending Approval": ["Open", "Draft", "Closed"],
  Open: ["Paused", "Closed"],
  Paused: ["Open", "Closed"],
  Closed: ["Archived"],
  Archived: [],
};

// Checked against the actor currently active role, not the full set of roles they have ever
// been granted - a dual-role HR/Employee user who switched to Employee mode for self-service
// must not retain HR-level vacancy control just because HR is still one of their assigned roles.
function hasVacancyManageRole(actorContext: ActorContext): boolean {
  const role = actorContext.actor.activeRole;
  return !!role && (role === "HR" || role === "Super Admin");
}

// A vacancy can be saved as a Draft with almost nothing filled in - that is the point of a
// draft - but publishing it live to candidates is a different guarantee: the posting has to
// actually be complete. This was previously enforced nowhere at all, so an essentially empty
// vacancy could go live.
function assertReadyToPublish(vacancy: Vacancy): void {
  const missing: string[] = [];
  if (!vacancy.title?.trim()) missing.push("title");
  if (!vacancy.department?.trim()) missing.push("department");
  if (!vacancy.location?.trim()) missing.push("location");
  if (!vacancy.position?.trim()) missing.push("position");
  if (!vacancy.employmentType?.trim()) missing.push("employment type");
  if (!vacancy.summary?.trim()) missing.push("summary");
  if (!vacancy.responsibilities || vacancy.responsibilities.length === 0)
    missing.push("at least one responsibility");
  if (!vacancy.requirements || vacancy.requirements.length === 0)
    missing.push("at least one requirement");
  const mandatoryCriteria = cleanMandatoryCriteria(vacancy.mandatoryCriteria ?? []);
  if (mandatoryCriteria.length === 0) {
    missing.push("at least one compulsory criterion");
  } else {
    const missingCriteria = findMissingMandatoryCriteria(
      mandatoryCriteria,
      vacancy.requirements ?? [],
    );
    if (missingCriteria.length > 0) {
      missing.push(
        `these compulsory criteria in the final requirements: ${missingCriteria.join("; ")}`,
      );
    }
  }
  if (!vacancy.headcount || vacancy.headcount < 1) missing.push("a headcount of at least 1");
  if (missing.length > 0) {
    throw new Error(`This vacancy cannot be published yet - it is missing: ${missing.join(", ")}.`);
  }
}

export class VacancyService {
  private vacancyRepo: LocalRepository<Vacancy>;

  constructor() {
    const { storage, audit } = getApplicationDataServices();
    this.vacancyRepo = new LocalRepository<Vacancy>("vacancies", storage, audit, {
      module: "recruitment",
      entityType: "vacancy",
    });
  }

  getVacancyRepository() {
    return this.vacancyRepo;
  }

  async hydrateCompatibilityCache(context?: ActorContext): Promise<void> {
    if (typeof window === "undefined") return;
    const databaseVacancies = context
      ? await (
          await import("../server-functions/vacancy.server.ts")
        ).getRecruitmentVacanciesFn({
          data: {
            actorId: context.actor.userId,
            ...(context.actor.workspaceEmail ? { actorEmail: context.actor.workspaceEmail } : {}),
            activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
          },
        })
      : await fetch("/api/public/vacancies", {
          headers: { accept: "application/json" },
        }).then(async (response) => {
          if (!response.ok) throw new Error("Open roles could not be loaded.");
          return (await response.json()) as Vacancy[];
        });
    const { storage } = getApplicationDataServices();
    const existing = storage.readCollection<Vacancy>("vacancies");
    const employees = storage.readCollection<{ id: string; databaseId?: string }>("employees");
    const projects = storage.readCollection<{ id: string; databaseId?: string }>("projects");
    const employeeIdMap = new Map(
      employees.filter((item) => item.databaseId).map((item) => [item.databaseId!, item.id]),
    );
    const projectIdMap = new Map(
      projects.filter((item) => item.databaseId).map((item) => [item.databaseId!, item.id]),
    );
    const compatible = databaseVacancies.map((vacancy) => {
      const prior = existing.find(
        (item) =>
          item.databaseId === vacancy.id ||
          (item.title.trim().toLowerCase() === vacancy.title.trim().toLowerCase() &&
            !item.databaseId),
      );
      return {
        ...vacancy,
        id: prior?.id ?? vacancy.id,
        databaseId: vacancy.id,
        ...(vacancy.hiringManagerId
          ? {
              hiringManagerId:
                employeeIdMap.get(vacancy.hiringManagerId) ?? vacancy.hiringManagerId,
            }
          : {}),
        ...(vacancy.assignedOwnerId
          ? {
              assignedOwnerId:
                employeeIdMap.get(vacancy.assignedOwnerId) ?? vacancy.assignedOwnerId,
            }
          : {}),
        ...(vacancy.projectId
          ? { projectId: projectIdMap.get(vacancy.projectId) ?? vacancy.projectId }
          : {}),
      };
    });
    storage.writeCollection("vacancies", compatible);
    window.dispatchEvent(new CustomEvent("via_hr:data_changed"));
  }

  private actorServerData(context: ActorContext) {
    const users = getApplicationDataServices().storage.readCollection<{
      id: string;
      workspaceEmail: string;
    }>("users");
    const actorEmail =
      context.actor.workspaceEmail ??
      users.find((user) => user.id === context.actor.userId)?.workspaceEmail;
    return {
      actorId: context.actor.userId,
      ...(actorEmail ? { actorEmail } : {}),
      activeRole: context.actor.activeRole ?? context.actor.roles[0] ?? "Employee",
    };
  }

  private resolveDatabaseRelation(collection: "employees" | "projects", id?: string) {
    if (!id) return undefined;
    const record = getApplicationDataServices()
      .storage.readCollection<{ id: string; databaseId?: string }>(collection)
      .find((item) => item.id === id || item.databaseId === id);
    return record?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
  }

  async saveDraftAsync(data: Partial<Vacancy>, context: ActorContext): Promise<Vacancy> {
    if (typeof window === "undefined") return this.saveDraft(data, context);
    const { saveVacancyDraftFn } = await import("../server-functions/vacancy.server.ts");
    const existing = data.id ? this.vacancyRepo.getById(data.id) : null;
    const databaseId =
      existing?.databaseId ?? (data.id && /^[0-9a-f-]{36}$/i.test(data.id) ? data.id : undefined);
    const hiringManagerId = this.resolveDatabaseRelation("employees", data.hiringManagerId);
    const assignedOwnerId = this.resolveDatabaseRelation("employees", data.assignedOwnerId);
    const projectId = this.resolveDatabaseRelation("projects", data.projectId);
    const id = await saveVacancyDraftFn({
      data: {
        actor: this.actorServerData(context),
        vacancy: {
          ...(databaseId ? { id: databaseId } : {}),
          title: data.title ?? "",
          department: data.department ?? "",
          location: data.location ?? "",
          position: data.position ?? "",
          grade: data.grade ?? "",
          employmentType: data.employmentType ?? "",
          ...(hiringManagerId ? { hiringManagerId } : {}),
          ...(assignedOwnerId ? { assignedOwnerId } : {}),
          ...(projectId ? { projectId } : {}),
          ...(data.targetStartDate ? { targetStartDate: data.targetStartDate } : {}),
          summary: data.summary ?? "",
          responsibilities: data.responsibilities ?? [],
          requirements: data.requirements ?? [],
          headcount: data.headcount ?? 1,
          ...(data.salaryRange ? { salaryRange: data.salaryRange } : {}),
          hiringReason: data.hiringReason ?? "",
          education: data.education ?? "",
          minimumExperience: data.minimumExperience ?? "",
          skills: data.skills ?? { required: [], preferred: [] },
          certifications: data.certifications ?? [],
          languages: data.languages ?? [],
          mandatoryCriteria: data.mandatoryCriteria ?? [],
          notes: data.notes ?? "",
          screeningQuestions: data.screeningQuestions ?? [],
        },
      },
    });
    await this.hydrateCompatibilityCache(context);
    const saved = this.vacancyRepo
      .list({ includeArchived: true })
      .find((item) => item.databaseId === id);
    if (!saved) throw new Error("The saved vacancy could not be reloaded.");
    return saved;
  }

  async transitionStatusAsync(
    id: string,
    newStatus: VacancyStatus,
    reason: string,
    context: ActorContext,
  ): Promise<void> {
    if (typeof window === "undefined") {
      this.transitionStatus(id, newStatus, reason, context);
      return;
    }
    const vacancy = this.vacancyRepo.getById(id, { includeArchived: true });
    const databaseId = vacancy?.databaseId ?? (/^[0-9a-f-]{36}$/i.test(id) ? id : undefined);
    if (!databaseId) throw new Error("This vacancy is not linked to PostgreSQL.");
    const { transitionVacancyFn } = await import("../server-functions/vacancy.server.ts");
    await transitionVacancyFn({
      data: {
        actor: this.actorServerData(context),
        vacancyId: databaseId,
        status: newStatus,
        reason,
      },
    });
    await this.hydrateCompatibilityCache(context);
  }

  private transitionStatus(
    id: string,
    newStatus: VacancyStatus,
    reason: string,
    actorContext: ActorContext,
  ) {
    if (!hasVacancyManageRole(actorContext)) {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "vacancy",
        entityId: id,
        action: "vacancy_status_change_denied",
        context: actorContext,
      });
      throw new Error("Unauthorized to change vacancy status");
    }

    const vacancy = this.vacancyRepo.getById(id);
    if (!vacancy) throw new Error("Vacancy not found");
    if (!VACANCY_TRANSITIONS[vacancy.status].includes(newStatus)) {
      throw new Error(`Vacancy cannot move from ${vacancy.status} to ${newStatus}.`);
    }
    if (newStatus === "Open") {
      assertReadyToPublish(vacancy);
    }

    this.vacancyRepo.update(
      id,
      { status: newStatus },
      {
        actor: actorContext.actor,
        reason,
      },
    );
  }

  saveDraft(data: Partial<Vacancy>, context: ActorContext): Vacancy {
    if (!hasVacancyManageRole(context)) {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "vacancy",
        entityId: data.id ?? "new",
        action: "vacancy_save_denied",
        context,
      });
      throw new Error("Unauthorized");
    }

    const draftData = {
      ...data,
      ...(data.mandatoryCriteria
        ? { mandatoryCriteria: cleanMandatoryCriteria(data.mandatoryCriteria) }
        : {}),
      status: "Draft" as VacancyStatus,
      applicantCount: 0,
    } as Omit<
      Vacancy,
      "id" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "recordVersion"
    >;

    if (data.id) {
      const existing = this.vacancyRepo.getById(data.id);
      if (!existing) throw new Error("Vacancy not found");
      if (existing.status !== "Draft") throw new Error("Only draft vacancies can be edited.");
      this.vacancyRepo.update(data.id, draftData, {
        actor: context.actor,
        reason: context.reason || "Draft updated",
      });
      return this.vacancyRepo.getById(data.id)!;
    } else {
      return this.vacancyRepo.create(draftData, context);
    }
  }

  submitForApproval(id: string, context: ActorContext) {
    this.transitionStatus(id, "Pending Approval", "Submitted for approval", context);
  }

  publishVacancy(id: string, context: ActorContext) {
    this.transitionStatus(id, "Open", context.reason || "Vacancy published", context);
  }

  pauseVacancy(id: string, reason: string, context: ActorContext) {
    this.transitionStatus(id, "Paused", reason, context);
  }

  reopenVacancy(id: string, context: ActorContext) {
    this.transitionStatus(id, "Open", "Vacancy reopened", context);
  }

  closeVacancy(id: string, reason: string, context: ActorContext) {
    this.transitionStatus(id, "Closed", reason, context);
  }

  archiveVacancy(id: string, reason: string, context: ActorContext) {
    this.transitionStatus(id, "Archived", reason, context);
  }

  duplicateVacancy(id: string, context: ActorContext) {
    if (!hasVacancyManageRole(context)) {
      recordAccessDenied(getApplicationDataServices().audit, {
        module: "recruitment",
        entityType: "vacancy",
        entityId: id,
        action: "vacancy_duplicate_denied",
        context,
      });
      throw new Error("Unauthorized");
    }
    const vacancy = this.vacancyRepo.getById(id);
    if (!vacancy) throw new Error("Vacancy not found");

    const newVacancy = this.vacancyRepo.create(
      {
        title: `${vacancy.title} (Copy)`,
        department: vacancy.department,
        location: vacancy.location,
        position: vacancy.position,
        grade: vacancy.grade,
        employmentType: vacancy.employmentType,
        hiringManagerId: vacancy.hiringManagerId,
        projectId: vacancy.projectId,
        targetStartDate: vacancy.targetStartDate,
        assignedOwnerId: vacancy.assignedOwnerId,
        status: "Draft",
        summary: vacancy.summary,
        responsibilities: [...vacancy.responsibilities],
        requirements: [...vacancy.requirements],
        applicantCount: 0,
        headcount: vacancy.headcount || 1,
        hiringReason: vacancy.hiringReason || "Expansion",
        education: vacancy.education || "",
        minimumExperience: vacancy.minimumExperience || "",
        skills: vacancy.skills
          ? { required: [...vacancy.skills.required], preferred: [...vacancy.skills.preferred] }
          : { required: [], preferred: [] },
        certifications: vacancy.certifications ? [...vacancy.certifications] : [],
        languages: vacancy.languages ? [...vacancy.languages] : [],
        mandatoryCriteria: [...(vacancy.mandatoryCriteria ?? [])],
        notes: vacancy.notes || "",
        screeningQuestions: vacancy.screeningQuestions ? [...vacancy.screeningQuestions] : [],
        salaryRange: vacancy.salaryRange ? { ...vacancy.salaryRange } : undefined,
      },
      context,
    );

    return newVacancy;
  }

  async duplicateVacancyAsync(id: string, context: ActorContext): Promise<Vacancy> {
    if (typeof window === "undefined") return this.duplicateVacancy(id, context);
    const vacancy = this.vacancyRepo.getById(id);
    if (!vacancy) throw new Error("Vacancy not found");
    const { id: _id, databaseId: _databaseId, ...copy } = vacancy;
    return this.saveDraftAsync(
      {
        ...copy,
        title: `${vacancy.title} (Copy)`,
        applicantCount: 0,
        status: "Draft",
      },
      { ...context, reason: context.reason || "Vacancy duplicated" },
    );
  }
}
