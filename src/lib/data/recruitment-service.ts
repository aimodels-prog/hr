import { VacancyService } from "./vacancy-service.ts";
import { CandidateService } from "./candidate-service.ts";
import type { Vacancy, Candidate, CandidateApplication } from "./types.ts";

export interface CandidateWithApplications extends Candidate {
  name: string;
  applications: CandidateApplication[];
  score?: number;
}

export class RecruitmentService {
  private vacancyService: VacancyService;
  private candidateService: CandidateService;

  constructor() {
    this.vacancyService = new VacancyService();
    this.candidateService = new CandidateService();
  }

  getVacancies(): Vacancy[] {
    return this.vacancyService.getVacancyRepository().list();
  }

  getCandidates(): CandidateWithApplications[] {
    const candidates = this.candidateService.getCandidateRepository().list();
    const applications = this.candidateService.getApplicationRepository().list();

    return candidates.map((c) => {
      const candidateApps = applications.filter((a) => a.candidateId === c.id);
      return {
        ...c,
        name: `${c.firstName} ${c.lastName}`.trim(),
        applications: candidateApps,
        score: c.aiScoreRange ? parseInt(c.aiScoreRange, 10) || 75 : 75,
      };
    });
  }
}
