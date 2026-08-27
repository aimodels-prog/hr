import type { Candidate, CandidateApplication, InterviewSlot, Vacancy } from "../data/types.ts";
import type {
  AiProvider,
  CalendarAvailabilityRequest,
  CalendarEventRequest,
  CalendarEventResult,
  CalendarProvider,
  CandidateScorePayload,
  EmailDeliveryRequest,
  EmailDeliveryResult,
  EmailProvider,
  GeneratedJobDescription,
  JobFacts,
  MeetingProvider,
  MeetingRequest,
  MeetingResult,
  WorkspaceIdentityProvider,
  WorkspaceIdentityRequest,
  WorkspaceIdentityResult,
} from "./types.ts";

function deterministicReference(prefix: string, value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return `${prefix}-${Math.abs(hash).toString(16)}`;
}

function vacancyVersion(vacancy: Vacancy): string {
  return deterministicReference(
    "v",
    `${vacancy.title}|${vacancy.minimumExperience}|${vacancy.location}|${vacancy.skills.required.join(",")}`,
  );
}

export class LocalAiProvider implements AiProvider {
  readonly metadata = {
    name: "via-local-ai",
    mode: "local" as const,
    capabilities: ["job_description", "candidate_scoring"] as const,
  };

  async generateJobDescription(facts: JobFacts): Promise<GeneratedJobDescription> {
    const summary = `VIA International is hiring a ${facts.title || "[Role]"} to join our ${facts.department || "[Department]"} team in ${facts.location || "[Location]"}. In this ${facts.employmentType || "full-time"} role, you will help deliver operational excellence using the requirements approved by HR. We are looking for someone with ${facts.minimumExperience || "relevant"} experience who can contribute from the start.`;

    const responsibilities = [
      `Lead agreed responsibilities and initiatives within the ${facts.department || "[Department]"} function.`,
      "Collaborate with relevant teams and stakeholders to deliver high-quality outcomes.",
      "Monitor agreed performance measures and support continuous improvement.",
      "Follow VIA policies and applicable external requirements.",
      "Provide clear progress and risk updates to the hiring manager.",
    ];

    const requirements = [
      facts.education || "Bachelor's degree or equivalent relevant experience",
      `${facts.minimumExperience || "Relevant professional"} experience in a similar capacity`,
      ...facts.skills.required.map((skill) => `Strong proficiency in ${skill}`),
      ...facts.mandatoryCriteria,
      ...facts.skills.preferred.map((skill) => `Familiarity with ${skill} is preferred`),
      ...(facts.languages.length > 0
        ? [`Professional proficiency in ${facts.languages.join(" and ")}`]
        : []),
      "Clear communication and stakeholder-management skills",
    ];

    return { summary, responsibilities, requirements };
  }

  scoreCandidate(
    candidate: Candidate,
    vacancy: Vacancy,
    application?: CandidateApplication,
  ): CandidateScorePayload {
    let experienceScore = 0;
    let locationScore = 0;
    let profileScore = 0;
    const strengths: string[] = [];
    const risks: string[] = [];
    const missingData: string[] = [];

    const match = vacancy.minimumExperience?.match(/(\d+)/);
    const requiredYears = match?.[1] ? Number.parseInt(match[1], 10) : 0;
    const actualYears = candidate.yearsOfExperience || 0;
    if (actualYears >= requiredYears) {
      experienceScore = 100;
      strengths.push(
        `Meets the ${requiredYears}-year experience requirement with ${actualYears} recorded years.`,
      );
    } else if (actualYears > 0 && requiredYears > 0) {
      experienceScore = Math.round((actualYears / requiredYears) * 100);
      risks.push(`Has ${actualYears} years against the ${requiredYears}-year requirement.`);
    } else {
      missingData.push("Candidate has no recorded years of experience.");
    }

    if (candidate.location && vacancy.location) {
      const candidateLocation = candidate.location.toLowerCase();
      const vacancyLocation = vacancy.location.toLowerCase();
      if (
        candidateLocation.includes(vacancyLocation) ||
        vacancyLocation.includes(candidateLocation) ||
        vacancyLocation.includes("remote") ||
        vacancyLocation.includes("any")
      ) {
        locationScore = 100;
        strengths.push(`Recorded location aligns with the vacancy (${candidate.location}).`);
      } else {
        locationScore = 30;
        risks.push(`Recorded location ${candidate.location} differs from ${vacancy.location}.`);
      }
    } else {
      missingData.push("Candidate location is not specified.");
    }

    const requiredSkills = vacancy.skills.required.map((skill) => skill.toLowerCase());
    const candidateSkills = (candidate.skills || []).map((skill) => skill.toLowerCase());
    const matchedSkills = requiredSkills.filter((required) =>
      candidateSkills.some(
        (candidateSkill) => candidateSkill.includes(required) || required.includes(candidateSkill),
      ),
    );
    if (requiredSkills.length > 0 && candidateSkills.length > 0) {
      const skillScore = Math.round((matchedSkills.length / requiredSkills.length) * 55);
      profileScore += skillScore;
      if (matchedSkills.length > 0) {
        strengths.push(`CV/profile confirms ${matchedSkills.length} required skill match(es).`);
      }
      const missingSkills = requiredSkills.filter((skill) => !matchedSkills.includes(skill));
      if (missingSkills.length > 0) {
        risks.push(`Required skills not confirmed: ${missingSkills.join(", ")}.`);
      }
    } else if (requiredSkills.length > 0) {
      missingData.push("Confirmed candidate skills are unavailable.");
    } else {
      profileScore += 55;
    }

    if (candidate.currentTitle && vacancy.title) {
      const titleWords = vacancy.title
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 3);
      if (titleWords.some((word) => candidate.currentTitle?.toLowerCase().includes(word))) {
        profileScore += 25;
        strengths.push(`Current title (${candidate.currentTitle}) aligns with the vacancy.`);
      } else {
        profileScore += 8;
      }
    } else {
      missingData.push("Current job title is missing.");
    }

    if (application?.screeningAnswers.length) {
      profileScore += 20;
      strengths.push("Candidate completed the vacancy screening questions.");
    } else if (vacancy.screeningQuestions?.length) {
      missingData.push("Screening answers are unavailable.");
    } else {
      profileScore += 20;
    }
    profileScore = Math.min(100, profileScore);

    const overallScore = Math.round(
      experienceScore * 0.4 + locationScore * 0.2 + profileScore * 0.4,
    );
    const assessment =
      overallScore >= 80
        ? "Highly competitive against the recorded requirements."
        : overallScore >= 60
          ? "Meets several requirements with gaps requiring HR review."
          : "Falls short of several recorded requirements or has insufficient data.";

    return {
      vacancyId: vacancy.id,
      candidateId: candidate.id,
      timestamp: new Date().toISOString(),
      modelRulesVersion: "local-deterministic-v3",
      vacancyVersion: vacancyVersion(vacancy),
      overallScore,
      categoryScores: {
        Experience: experienceScore,
        Location: locationScore,
        Profile: profileScore,
      },
      strengths,
      risks,
      missingData,
      evidence: `Overall score: ${overallScore}/100. ${assessment}`,
    };
  }
}

export class LocalCalendarProvider implements CalendarProvider {
  readonly metadata = {
    name: "via-local-calendar",
    mode: "local" as const,
    capabilities: ["calendar_availability", "calendar_event"] as const,
  };

  async findAvailability(request: CalendarAvailabilityRequest): Promise<InterviewSlot[]> {
    const start = new Date(request.startDate);
    const today = new Date();
    if (start < today) start.setDate(today.getDate() + 1);

    return [10, 13, 15].flatMap((hour) => {
      const slotStart = new Date(start);
      slotStart.setHours(hour, 0, 0, 0);
      if (slotStart > request.endDate) return [];
      const slotEnd = new Date(slotStart);
      slotEnd.setMinutes(slotEnd.getMinutes() + request.durationMinutes);
      return [
        {
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString(),
          timezone: request.timezone,
        },
      ];
    });
  }

  async createEvent(request: CalendarEventRequest): Promise<CalendarEventResult> {
    return {
      eventReference: deterministicReference(
        "local-event",
        `${request.title}|${request.startTime}|${request.attendeeEmails.join(",")}`,
      ),
      status: "simulated",
    };
  }

  async cancelEvent(_eventReference: string): Promise<{ cancelled: boolean }> {
    return { cancelled: true };
  }
}

export class LocalEmailProvider implements EmailProvider {
  readonly metadata = {
    name: "via-local-email",
    mode: "local" as const,
    capabilities: ["email_delivery"] as const,
  };

  async send(request: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
    return {
      deliveryReference: deterministicReference(
        "local-email",
        `${request.to.join(",")}|${request.subject}|${request.textBody}`,
      ),
      acceptedRecipients: [...request.to],
    };
  }
}

export class LocalMeetingProvider implements MeetingProvider {
  readonly metadata = {
    name: "via-local-meeting",
    mode: "local" as const,
    capabilities: ["meeting_link"] as const,
  };

  async createMeeting(request: MeetingRequest): Promise<MeetingResult> {
    const meetingReference = deterministicReference(
      "local-meeting",
      `${request.title}|${request.startTime}|${request.attendeeEmails.join(",")}`,
    );
    return {
      meetingReference,
      joinUrl: `https://meet.google.com/simulated-${meetingReference.slice(-10)}`,
    };
  }

  async cancelMeeting(_meetingReference: string): Promise<{ cancelled: boolean }> {
    return { cancelled: true };
  }
}

export class LocalWorkspaceIdentityProvider implements WorkspaceIdentityProvider {
  readonly metadata = {
    name: "via-local-workspace",
    mode: "local" as const,
    capabilities: ["workspace_identity"] as const,
  };

  async provisionIdentity(request: WorkspaceIdentityRequest): Promise<WorkspaceIdentityResult> {
    return {
      identityReference: deterministicReference(
        "local-workspace",
        `${request.employeeId}|${request.primaryEmail}`,
      ),
      primaryEmail: request.primaryEmail,
      status: "simulated",
    };
  }
}
