import type { ActorContext } from "./types.ts";
import type { StaffModule } from "./staff-module-plan.ts";

export async function hydrateStaffModule(
  module: StaffModule,
  actor: ActorContext,
  canCommit: () => boolean,
): Promise<void> {
  if (!canCommit()) return;
  switch (module) {
    case "attendance": {
      const { AttendanceService } = await import("./attendance-service.ts");
      return new AttendanceService().hydrateFromDatabase(actor, canCommit);
    }
    case "lifecycle": {
      const { OnboardingService } = await import("./onboarding-service.ts");
      return new OnboardingService().hydrateCompatibilityCache(actor, canCommit);
    }
    case "leave": {
      const { LeaveService } = await import("./leave-service.ts");
      return new LeaveService().hydrateCompatibilityCache(actor, canCommit);
    }
    case "timesheets": {
      const { TimesheetService } = await import("./timesheet-service.ts");
      return new TimesheetService().hydrateCompatibilityCache(actor, canCommit);
    }
    case "overtime": {
      const { OvertimeService } = await import("./overtime-service.ts");
      return new OvertimeService().hydrateCompatibilityCache(actor, canCommit);
    }
    case "travel": {
      const { TravelService } = await import("./travel-service.ts");
      return new TravelService().hydrateCompatibilityCache(actor, canCommit);
    }
    case "performance": {
      const { PerformanceService } = await import("./performance-service.ts");
      return new PerformanceService().hydrateCompatibilityCache(actor, canCommit);
    }
    case "training": {
      const { TrainingService } = await import("./training-service.ts");
      return new TrainingService().hydrateCompatibilityCache(actor, canCommit);
    }
    case "payroll": {
      const { PayrollService } = await import("./payroll-service.ts");
      return new PayrollService().hydrateCompatibilityCache(actor, canCommit);
    }
    case "vacancies": {
      const { VacancyService } = await import("./vacancy-service.ts");
      const hr = actor.actor.activeRole === "HR" || actor.actor.activeRole === "Super Admin";
      return new VacancyService().hydrateCompatibilityCache(hr ? actor : undefined, canCommit);
    }
    case "recruitment": {
      const { CandidateService } = await import("./candidate-service.ts");
      return new CandidateService().hydrateCompatibilityCache(actor, canCommit);
    }
    case "documents": {
      const { DocumentService } = await import("./document-service.ts");
      return new DocumentService().hydrateCompatibilityCache(actor, canCommit);
    }
  }
}
