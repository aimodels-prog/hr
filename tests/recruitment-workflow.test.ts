import assert from "node:assert/strict";
import test from "node:test";

import { configureApplicationDataServices } from "../src/lib/data/application-data.ts";
import { AuditService } from "../src/lib/data/audit-service.ts";
import { CandidateService } from "../src/lib/data/candidate-service.ts";
import { CandidatePoolService } from "../src/lib/data/candidate-pool-service.ts";
import { CandidatePreparationService } from "../src/lib/data/candidate-preparation-service.ts";
import { InterviewService } from "../src/lib/data/interview-service.ts";
import { LocalRepository } from "../src/lib/data/repository.ts";
import { ScorecardService } from "../src/lib/data/scorecard-service.ts";
import { OfferService } from "../src/lib/data/offer-service.ts";
import { VacancyService } from "../src/lib/data/vacancy-service.ts";
import { ShortlistService } from "../src/lib/data/shortlist-service.ts";
import { ImportService } from "../src/lib/data/import-service.ts";
import { NotificationService } from "../src/lib/data/notification-service.ts";
import { MemoryStorageDriver } from "../src/lib/data/storage-driver.ts";
import { VersionedStorageService } from "../src/lib/data/storage.ts";
import type { ActorContext, HiringDecisionSnapshot, Vacancy } from "../src/lib/data/types.ts";
import { getSupportedCvMimeType } from "../src/lib/data/cv-file-validation.ts";
import {
  configureIntegrationProviders,
  resetIntegrationProviders,
} from "../src/lib/integrations/index.ts";

const hr: ActorContext = {
  actor: {
    userId: "user-hr-recruitment-test",
    employeeId: "employee-hr-recruitment-test",
    displayName: "Recruitment HR",
    activeRole: "HR",
    roles: ["HR"],
  },
};

const employee: ActorContext = {
  actor: {
    userId: "employee-recruitment-test",
    employeeId: "employee-recruitment-test",
    displayName: "Employee Viewer",
    activeRole: "Employee",
    roles: ["Employee"],
  },
};

test("CV validation accepts PDF, DOC and DOCX by extension when browser MIME is empty", () => {
  assert.equal(getSupportedCvMimeType({ name: "candidate.pdf", type: "" }), "application/pdf");
  assert.equal(getSupportedCvMimeType({ name: "candidate.doc", type: "" }), "application/msword");
  assert.equal(
    getSupportedCvMimeType({ name: "candidate.DOCX", type: "" }),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(getSupportedCvMimeType({ name: "candidate.exe", type: "" }), null);
});

function harness() {
  const storage = new VersionedStorageService(new MemoryStorageDriver());
  storage.initialize();
  const masterRecord = (id: string, name: string) => ({
    id,
    name,
    isActive: true,
    orderIndex: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "SYSTEM",
    updatedAt: "2026-08-01T00:00:00.000Z",
    updatedBy: "SYSTEM",
    recordVersion: 1,
  });
  storage.writeCollection(
    "departments",
    ["Operations", "Commercial"].map((name, index) =>
      masterRecord(`test-department-${index + 1}`, name),
    ),
  );
  storage.writeCollection(
    "positions",
    [
      "Commercial Director",
      "Fleet Coordinator",
      "Logistics Coordinator",
      "Operations Lead",
      "Procurement Coordinator",
      "Rollback Test Role",
      "Supply Chain Manager",
    ].map((name, index) => masterRecord(`test-position-${index + 1}`, name)),
  );
  storage.writeCollection(
    "locations",
    ["Abu Dhabi", "Dubai", "Muscat", "VIA Dubai Office"].map((name, index) =>
      masterRecord(`test-location-${index + 1}`, name),
    ),
  );
  storage.writeCollection(
    "grades",
    ["G5", "G6", "G7", "G9"].map((name, index) => masterRecord(`test-grade-${index + 1}`, name)),
  );
  storage.writeCollection("employmentTypes", [masterRecord("test-employment-type-1", "Full-time")]);
  const audit = new AuditService(storage);
  const storedFiles = new Map<string, { metadata: Record<string, unknown>; blob: Blob }>();
  configureApplicationDataServices({
    storage,
    audit,
    notifications: new NotificationService(storage, audit),
    files: {
      save: async (input: {
        blob: Blob;
        name: string;
        mimeType?: string;
        owner: Record<string, string>;
      }) => {
        const id = `file-${storedFiles.size + 1}`;
        const now = new Date().toISOString();
        const metadata = {
          id,
          name: input.name,
          mimeType: input.mimeType || input.blob.type,
          size: input.blob.size,
          checksum: `test-${input.name}-${input.blob.size}`,
          owner: input.owner,
          createdAt: now,
          createdBy: "SYSTEM",
          updatedAt: now,
          updatedBy: "SYSTEM",
          recordVersion: 1,
        };
        storedFiles.set(id, { metadata, blob: input.blob });
        return metadata;
      },
      getMetadata: async (id: string) =>
        storedFiles.get(id)?.metadata || {
          id,
          name: "cv.pdf",
          mimeType: "application/pdf",
          size: 1024,
          owner: { entityType: "candidate", entityId: "test" },
          createdAt: new Date().toISOString(),
          createdBy: "SYSTEM",
          updatedAt: new Date().toISOString(),
          updatedBy: "SYSTEM",
          recordVersion: 1,
        },
      getBlob: async (id: string) => storedFiles.get(id)?.blob || null,
      updateOwner: async (id: string, owner: Record<string, string>) => {
        const stored = storedFiles.get(id) ?? {
          metadata: {
            id,
            name: "cv.pdf",
            mimeType: "application/pdf",
            size: 1024,
            owner: { entityType: "candidate", entityId: "test" },
            createdAt: new Date().toISOString(),
            createdBy: "SYSTEM",
            updatedAt: new Date().toISOString(),
            updatedBy: "SYSTEM",
            recordVersion: 1,
          },
          blob: new Blob(["test cv"], { type: "application/pdf" }),
        };
        stored.metadata = {
          ...stored.metadata,
          owner,
          recordVersion: Number(stored.metadata.recordVersion) + 1,
        };
        storedFiles.set(id, stored);
        return stored.metadata;
      },
      delete: async (id: string) => storedFiles.delete(id),
      clear: async () => storedFiles.clear(),
    } as never,
  });
  resetIntegrationProviders();
  return { storage, audit, storedFiles };
}

test("vacancy, public application, contact, scoring and shortlist remain connected", async () => {
  const { storage, storedFiles } = harness();
  const vacancies = new VacancyService();
  const vacancy = vacancies.saveDraft(
    {
      title: "Logistics Coordinator",
      position: "Logistics Coordinator",
      department: "Operations",
      location: "Dubai",
      grade: "G5",
      employmentType: "Full-time",
      summary: "Coordinate safe and timely logistics operations.",
      responsibilities: ["Coordinate shipments"],
      requirements: ["Three years of logistics experience"],
      mandatoryCriteria: ["Three years of logistics experience"],
      headcount: 1,
      hiringReason: "Project growth",
      education: "Diploma or degree",
      minimumExperience: "3 years",
      skills: { required: ["Logistics"], preferred: ["ERP"] },
      certifications: [],
      languages: ["English"],
      notes: "",
      screeningQuestions: ["Describe a difficult shipment you coordinated."],
    },
    hr,
  );
  vacancies.submitForApproval(vacancy.id, hr);
  vacancies.publishVacancy(vacancy.id, hr);

  const uploadedAt = new Date().toISOString();
  storedFiles.set("file-cv-lina", {
    metadata: {
      id: "file-cv-lina",
      name: "Lina-Hassan-CV.pdf",
      mimeType: "application/pdf",
      size: 78,
      checksum: "checksum-lina-cv-v1",
      owner: { entityType: "application", entityId: "public-upload" },
      createdAt: uploadedAt,
      createdBy: "SYSTEM",
      updatedAt: uploadedAt,
      updatedBy: "SYSTEM",
      recordVersion: 1,
    },
    blob: new Blob(["Lina Hassan Logistics Coordinator 5 years experience logistics ERP Dubai"], {
      type: "application/pdf",
    }),
  });

  const candidates = new CandidateService();
  const application = await candidates.submitApplication({
    firstName: "Lina",
    lastName: "Hassan",
    email: "lina.hassan@example.com",
    phone: "+971500000003",
    location: "Dubai",
    currentTitle: "Logistics Coordinator",
    yearsOfExperience: 5,
    noticePeriod: "30 days",
    screeningAnswers: [
      {
        question: vacancy.screeningQuestions[0]!,
        answer: "Recovered a delayed regional shipment.",
      },
    ],
    cvFileId: "file-cv-lina",
    vacancyId: vacancy.id,
    consent: true,
  });
  candidates.logContact(
    {
      candidateId: application.candidateId,
      channel: "Phone",
      vacancyId: vacancy.id,
      outcome: "Interested",
      notes: "Confirmed salary range and availability.",
    },
    hr,
  );
  assert.equal(storage.readCollection("candidate_scores").length, 0);
  assert.equal(storage.readCollection("applications").length, 1);
  assert.equal(storage.readCollection("candidate_cv_records").length, 1);
  assert.deepEqual(storedFiles.get("file-cv-lina")?.metadata.owner, {
    entityType: "candidate-cv",
    entityId: storage.readCollection<{ id: string }>("candidate_cv_records")[0]?.id,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const preparation = new CandidatePreparationService();
  await preparation.prepareVacancyApplications(vacancy.id, hr);
  const candidateBeforeReview = candidates.getCandidate(application.candidateId, hr)!;
  assert.deepEqual(candidateBeforeReview.skills ?? [], []);
  const cvBeforeReview = storage.readCollection<{
    id: string;
    processingStatus: string;
    extractedFields: { skills?: string[] };
  }>("candidate_cv_records")[0]!;
  assert.equal(cvBeforeReview.processingStatus, "Awaiting HR Review");
  assert.ok(cvBeforeReview.extractedFields.skills?.includes("logistics"));
  new CandidatePoolService().confirmCandidateCvExtraction(cvBeforeReview.id, hr);
  assert.ok(candidates.getCandidate(application.candidateId, hr)?.skills?.includes("logistics"));

  const completedRun = storage.readCollection<{ id: string; status: string }>(
    "candidate_preparation_runs",
  )[0]!;
  storage.writeCollection("candidate_preparation_runs", [{ ...completedRun, status: "Queued" }]);
  const resumed = await new CandidatePreparationService().resumePendingRuns(hr);
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0]?.id, completedRun.id);
  assert.notEqual(resumed[0]?.status, "Queued");
  assert.equal(storage.readCollection("candidate_preparation_runs").length, 1);
  const batch = preparation.createAssessmentBatch(vacancy.id, 1, hr);
  preparation.runDetailedAssessment(batch.id, hr);
  const scores = candidates.getLatestScoresForVacancy(vacancy.id, hr);
  assert.equal(scores.length, 1);
  const shortlistService = new ShortlistService();
  const shortlist = shortlistService.saveDraft(
    {
      vacancyId: vacancy.id,
      targetSize: 1,
      rankedCandidateIds: [application.candidateId],
      selectedCandidateIds: [application.candidateId],
      unselectedAction: null,
      overrides: [],
      status: "Draft",
    },
    hr,
  );
  shortlistService.finalizeShortlist(shortlist.id, "On Hold", hr);

  assert.equal(candidates.getCandidate(application.candidateId, hr)?.stage, "Shortlisted");
  assert.equal(candidates.getApplicationRepository().list()[0]?.status, "Shortlisted");
  assert.equal(candidates.getContactsForCandidate(application.candidateId, hr).length, 1);
  assert.equal(
    storage.readCollection<{ candidateId: string }>("candidate_cv_records")[0]?.candidateId,
    application.candidateId,
  );
  assert.ok(storage.readCollection("integration_operations").length > 0);
});

test("a vacancy cannot be published without its compulsory criteria in the final description", () => {
  harness();
  const vacancies = new VacancyService();
  const createDraft = (mandatoryCriteria: string[]) =>
    vacancies.saveDraft(
      {
        title: "Fleet Coordinator",
        position: "Fleet Coordinator",
        department: "Operations",
        location: "Dubai",
        grade: "G5",
        employmentType: "Full-time",
        summary: "Coordinate VIA fleet activity.",
        responsibilities: ["Coordinate daily fleet activity"],
        requirements: ["Relevant fleet experience"],
        mandatoryCriteria,
        headcount: 1,
        hiringReason: "Growth",
        education: "Diploma",
        minimumExperience: "3 years",
        skills: { required: ["Fleet coordination"], preferred: [] },
        certifications: [],
        languages: ["English"],
        notes: "",
        screeningQuestions: [],
      },
      hr,
    );

  const missingAllCriteria = createDraft([]);
  vacancies.submitForApproval(missingAllCriteria.id, hr);
  assert.throws(
    () => vacancies.publishVacancy(missingAllCriteria.id, hr),
    /at least one compulsory criterion/,
  );

  const missingFromDescription = createDraft(["Valid UAE driving licence"]);
  vacancies.submitForApproval(missingFromDescription.id, hr);
  assert.throws(
    () => vacancies.publishVacancy(missingFromDescription.id, hr),
    /Valid UAE driving licence/,
  );
});

test("a directly received CV is saved, extracted, duplicate-reviewed and added to the Candidate Pool", async () => {
  const { storage } = harness();
  const pool = new CandidatePoolService();
  const intake = await pool.uploadDirectCv(
    {
      file: new Blob(
        [
          "Fatma Hassan\nfatma.hassan@example.com\n+968 9911 2233\n6 years experience\nLogistics and supply chain",
        ],
        { type: "text/plain" },
      ),
      fileName: "Fatma_Hassan_CV.txt",
      source: "Direct Email",
      receivedAt: "2026-08-25T09:00:00.000Z",
      consentStatus: "Confirmed",
    },
    hr,
  );
  assert.equal(intake.processingStatus, "Awaiting HR Review");
  assert.equal(intake.extractedFields.email, "fatma.hassan@example.com");
  assert.ok(intake.extractedFields.skills?.includes("logistics"));

  const finalised = pool.finaliseCvIntake(
    {
      cvRecordId: intake.id,
      candidate: {
        firstName: intake.extractedFields.firstName || "Fatma",
        lastName: intake.extractedFields.lastName || "Hassan",
        email: intake.extractedFields.email || "fatma.hassan@example.com",
        phone: intake.extractedFields.phone || "+968 9911 2233",
        location: "Muscat",
        currentTitle: "Logistics Coordinator",
        yearsOfExperience: intake.extractedFields.yearsOfExperience || 6,
        skills: intake.extractedFields.skills,
        talentPools: ["Logistics", "Future Opportunities"],
      },
      consentStatus: "Confirmed",
    },
    hr,
  );
  assert.equal(finalised.candidate.email, "fatma.hassan@example.com");
  assert.deepEqual(finalised.candidate.talentPools, ["Logistics", "Future Opportunities"]);
  assert.equal(finalised.cvRecord.processingStatus, "Ready");
  assert.equal(storage.readCollection("candidates").length, 1);

  const second = await pool.uploadDirectCv(
    {
      file: new Blob(["fatma.hassan@example.com"], { type: "text/plain" }),
      fileName: "Fatma_Hassan_Updated_CV.txt",
      source: "WhatsApp",
      receivedAt: "2026-08-25T10:00:00.000Z",
      consentStatus: "Confirmed",
    },
    hr,
  );
  assert.throws(
    () =>
      pool.finaliseCvIntake(
        {
          cvRecordId: second.id,
          candidate: {
            firstName: "Fatma",
            lastName: "Hassan",
            email: "fatma.hassan@example.com",
            phone: "+968 9911 2233",
            location: "Muscat",
            yearsOfExperience: 6,
          },
          consentStatus: "Confirmed",
        },
        hr,
      ),
    /DUPLICATE_CANDIDATE_MATCH_FOUND/,
  );
});

test("a CV intake can continue into a recommended candidate without uploading the file twice", async () => {
  const { storage } = harness();
  const vacancies = new VacancyService();
  const vacancy = vacancies.saveDraft(
    {
      title: "Procurement Coordinator",
      position: "Procurement Coordinator",
      department: "Operations",
      location: "Dubai",
      grade: "G5",
      employmentType: "Full-time",
      summary: "Coordinate purchasing and supplier delivery.",
      responsibilities: ["Coordinate purchase orders"],
      requirements: ["Three years of procurement experience"],
      mandatoryCriteria: ["Three years of procurement experience"],
      headcount: 1,
      hiringReason: "Growth",
      education: "Diploma",
      minimumExperience: "3 years",
      skills: { required: ["Procurement"], preferred: ["SAP"] },
      certifications: [],
      languages: ["English"],
      notes: "",
      screeningQuestions: [],
    },
    hr,
  );
  vacancies.submitForApproval(vacancy.id, hr);
  vacancies.publishVacancy(vacancy.id, hr);

  const pool = new CandidatePoolService();
  const intake = await pool.uploadDirectCv(
    {
      file: new Blob(["Sara Ali sara.ali@example.com +971 50 555 2222 procurement"], {
        type: "",
      }),
      fileName: "Sara_Ali_CV.docx",
      source: "Direct Email",
      receivedAt: new Date().toISOString(),
      consentStatus: "Confirmed",
      vacancyId: vacancy.id,
      isRecommended: true,
    },
    hr,
  );
  assert.equal(intake.recommendationPending, true);

  pool.saveCvIntakeReviewDraft(
    intake.id,
    {
      vacancyId: vacancy.id,
      extractedFields: {
        firstName: "Sara",
        lastName: "Ali",
        email: "sara.ali@example.com",
        phone: "+971 50 555 2222",
        location: "Dubai",
        currentTitle: "Procurement Coordinator",
        yearsOfExperience: 5,
        skills: ["Procurement"],
      },
    },
    hr,
  );
  const result = await pool.finaliseRecommendedCvIntake(
    {
      cvRecordId: intake.id,
      candidate: {
        firstName: "Sara",
        lastName: "Ali",
        email: "sara.ali@example.com",
        phone: "+971 50 555 2222",
        location: "Dubai",
        currentTitle: "Procurement Coordinator",
        yearsOfExperience: 5,
        skills: ["Procurement"],
      },
      vacancyId: vacancy.id,
      consentStatus: "Confirmed",
    },
    {
      recommenderType: "External Person",
      recommenderName: "Omar Rahman",
      recommenderEmail: "",
      recommenderPhone: "+971 50 111 3333",
      relationship: "Former supervisor",
      date: new Date().toISOString(),
      notes: "Recommended based on procurement delivery experience.",
      hrOwnerId: hr.actor.userId,
      sourceOutcome: "Sourced",
    },
    hr,
  );

  assert.equal(result.cvRecord.recommendationPending, false);
  assert.equal(result.cvRecord.recommendationId, result.recommendation.id);
  assert.equal(storage.readCollection("candidate_recommendations").length, 1);
  assert.equal(storage.readCollection("applications").length, 1);
  const recommenderProfile = new CandidateService()
    .getRecommenderProfiles(hr)
    .find((profile) => profile.name === "Omar Rahman");
  assert.equal(recommenderProfile?.email, "");
  assert.equal(recommenderProfile?.phone, "+971 50 111 3333");
  assert.equal(
    storage.readCollection<{ source: string }>("candidate_assessment_inclusions")[0]?.source,
    "Recommended",
  );
});

test("HR recommendation is pinned without changing the objective assessment score", async () => {
  const { storage } = harness();
  const vacancies = new VacancyService();
  const vacancy = vacancies.saveDraft(
    {
      title: "Supply Chain Manager",
      position: "Supply Chain Manager",
      department: "Operations",
      location: "Muscat",
      grade: "G7",
      employmentType: "Full-time",
      summary: "Lead regional supply chain delivery.",
      responsibilities: ["Lead supply chain operations"],
      requirements: ["Relevant management experience"],
      mandatoryCriteria: ["Relevant management experience"],
      headcount: 1,
      hiringReason: "Growth",
      education: "Degree preferred",
      minimumExperience: "5 years",
      skills: { required: ["Supply chain"], preferred: ["SAP"] },
      certifications: [],
      languages: ["English"],
      notes: "",
      screeningQuestions: [],
    },
    hr,
  );
  vacancies.submitForApproval(vacancy.id, hr);
  vacancies.publishVacancy(vacancy.id, hr);

  const pool = new CandidatePoolService();
  const intake = await pool.uploadDirectCv(
    {
      file: new Blob(["Nadia Karim nadia@example.com +968 9900 1111 supply chain"], {
        type: "text/plain",
      }),
      fileName: "Nadia_Karim_CV.txt",
      source: "Direct Email",
      receivedAt: "2026-08-25T09:00:00.000Z",
      consentStatus: "Confirmed",
    },
    hr,
  );
  const { candidate } = pool.finaliseCvIntake(
    {
      cvRecordId: intake.id,
      candidate: {
        firstName: "Nadia",
        lastName: "Karim",
        email: "nadia@example.com",
        phone: "+968 9900 1111",
        location: "Muscat",
        yearsOfExperience: 8,
        skills: ["Supply chain"],
      },
      consentStatus: "Confirmed",
    },
    hr,
  );
  const recommendation = await pool.recommendForInterview(
    {
      candidateId: candidate.id,
      vacancyId: vacancy.id,
      reason: "Strong regional supply chain leadership experience.",
    },
    hr,
  );
  assert.equal(recommendation.status, "Ready for Assessment");
  assert.equal(recommendation.assessmentScoreId, undefined);
  assert.equal(storage.readCollection("candidate_scores").length, 0);
  const preparation = new CandidatePreparationService();
  const inclusions = preparation.getInclusions(vacancy.id, hr);
  assert.equal(inclusions[0]?.source, "Recommended");
  const batch = preparation.createAssessmentBatch(vacancy.id, 1, hr);
  assert.deepEqual(batch.recommendedCandidateIds, [candidate.id]);
  preparation.runDetailedAssessment(batch.id, hr);
  const updatedRecommendation = storage.readCollection<{
    status: string;
    assessmentScoreId?: string;
  }>("candidate_interview_recommendations")[0];
  assert.equal(updatedRecommendation?.status, "Ready to Schedule");
  assert.ok(updatedRecommendation?.assessmentScoreId);
  assert.equal(storage.readCollection("candidate_scores").length, 1);
  assert.equal(storage.readCollection<{ status: string }>("applications")[0]?.status, "New");
  assert.equal(storage.readCollection<{ stage: string }>("candidates")[0]?.stage, "Screened");
});

test("employees cannot browse CV intake or recommend candidates for interview", async () => {
  harness();
  const pool = new CandidatePoolService();
  const employee: ActorContext = {
    actor: {
      userId: "user-employee-candidate-test",
      employeeId: "employee-candidate-test",
      displayName: "Employee User",
      activeRole: "Employee",
      roles: ["Employee"],
    },
  };
  assert.throws(() => pool.getCvIntakes(employee), /Only HR or Super Admin/);
  await assert.rejects(
    async () =>
      pool.recommendForInterview(
        {
          candidateId: "candidate-1",
          vacancyId: "vacancy-1",
          reason: "Attempted unauthorised interview recommendation.",
        },
        employee,
      ),
    /Only HR or Super Admin/,
  );
});

test("candidate, interview and offer reads are denied outside the permitted recruitment scope", () => {
  const { storage, audit } = harness();
  storage.writeCollection("candidates", [
    {
      id: "candidate-private",
      firstName: "Private",
      lastName: "Candidate",
      email: "private@example.com",
      phone: "+971500000099",
      location: "Dubai",
      yearsOfExperience: 4,
      stage: "Interview",
      source: "Career Portal",
      doNotContact: false,
    },
  ]);
  storage.writeCollection("interview_events", [
    {
      id: "interview-private",
      candidateId: "candidate-private",
      vacancyId: "vacancy-private",
      panelUserIds: ["panel-user"],
      status: "Scheduled",
    },
  ]);
  storage.writeCollection("job_offers", [
    {
      id: "offer-private",
      candidateId: "candidate-private",
      vacancyId: "vacancy-private",
      salary: 10000,
      status: "Draft",
    },
  ]);

  assert.throws(() => new CandidateService().getCandidate("candidate-private", employee));
  assert.throws(() =>
    new InterviewService().getInterviewsForCandidate("candidate-private", employee),
  );
  assert.throws(() => new OfferService().getAllOffers(employee));
  assert.ok(
    audit
      .list()
      .filter((event) => event.action.includes("denied"))
      .some((event) => event.entityId === "candidate-private"),
  );
});

test("shortlist size and ranking overrides are enforced by the service", () => {
  harness();
  const candidates = new CandidateService();
  const first = candidates.getCandidateRepository().create(
    {
      firstName: "First",
      lastName: "Ranked",
      email: "first.ranked@example.com",
      phone: "+971500001001",
      location: "Dubai",
      yearsOfExperience: 7,
      stage: "Screened",
      doNotContact: false,
    },
    hr,
  );
  const second = candidates.getCandidateRepository().create(
    {
      firstName: "Second",
      lastName: "Ranked",
      email: "second.ranked@example.com",
      phone: "+971500001002",
      location: "Dubai",
      yearsOfExperience: 6,
      stage: "Screened",
      doNotContact: false,
    },
    hr,
  );
  const shortlists = new ShortlistService();

  assert.throws(
    () =>
      shortlists.saveDraft(
        {
          vacancyId: "vacancy-shortlist-limit",
          targetSize: 11,
          rankedCandidateIds: [first.id, second.id],
          selectedCandidateIds: [first.id],
          unselectedAction: null,
          overrides: [],
          status: "Draft",
        },
        hr,
      ),
    /between 1 and 10/,
  );

  let draft = shortlists.saveDraft(
    {
      vacancyId: "vacancy-shortlist-overrides",
      targetSize: 1,
      rankedCandidateIds: [first.id, second.id],
      selectedCandidateIds: [second.id],
      unselectedAction: null,
      overrides: [],
      status: "Draft",
    },
    hr,
  );
  assert.throws(() => shortlists.finalizeShortlist(draft.id, "On Hold", hr), /top-ranked/);

  draft = shortlists.saveDraft(
    {
      vacancyId: "vacancy-shortlist-overrides",
      targetSize: 1,
      rankedCandidateIds: [first.id, second.id],
      selectedCandidateIds: [second.id],
      unselectedAction: null,
      overrides: [
        { candidateId: first.id, type: "excluded_top", reason: "Availability changed" },
        { candidateId: second.id, type: "included_low", reason: "Required licence verified" },
      ],
      status: "Draft",
    },
    hr,
  );
  assert.equal(shortlists.finalizeShortlist(draft.id, "On Hold", hr).status, "Finalized");
});

test("candidate export excludes compensation and records the exported fields", () => {
  const { audit } = harness();
  const candidates = new CandidateService();
  const candidate = candidates.getCandidateRepository().create(
    {
      firstName: "Safe",
      lastName: "Export",
      email: "safe.export@example.com",
      phone: "+971500001010",
      location: "Dubai",
      yearsOfExperience: 5,
      stage: "Sourced",
      doNotContact: false,
      currentSalary: "10000 AED",
      expectedSalary: "12000 AED",
    },
    hr,
  );
  const csv = candidates.exportCandidates([candidate.id], hr);
  assert.doesNotMatch(csv, /10000 AED|12000 AED|Current Salary|Expected Salary/);
  assert.ok(
    audit
      .list()
      .some(
        (event) =>
          event.action === "candidate_csv_export" &&
          (event.after as { compensationIncluded?: boolean }).compensationIncluded === false,
      ),
  );
});

test("a returning applicant updates their candidate profile without creating a duplicate", async () => {
  const { storage, audit } = harness();
  const vacancyRepo = new LocalRepository<Vacancy>("vacancies", storage, audit, {
    module: "recruitment",
    entityType: "vacancy",
  });
  const createVacancy = (id: string, title: string) =>
    vacancyRepo.create(
      {
        id,
        title,
        position: title,
        department: "Operations",
        location: "Dubai",
        grade: "G6",
        employmentType: "Full-time",
        status: "Open",
        summary: `${title} vacancy`,
        responsibilities: ["Deliver assigned work"],
        requirements: ["Relevant experience"],
        applicantCount: 0,
        headcount: 1,
        hiringReason: "Growth",
        education: "Relevant qualification",
        minimumExperience: "3 years",
        skills: { required: ["Operations"], preferred: [] },
        certifications: [],
        languages: ["English"],
        notes: "",
        screeningQuestions: [],
      },
      hr,
    );
  const firstVacancy = createVacancy("vacancy-returning-one", "Operations Coordinator");
  const secondVacancy = createVacancy("vacancy-returning-two", "Senior Coordinator");
  const candidates = new CandidateService();
  const first = await candidates.submitApplication({
    firstName: "Maya",
    lastName: "Saleh",
    email: "maya.old@example.com",
    phone: "+971 50 111 2233",
    location: "Abu Dhabi",
    currentTitle: "Coordinator",
    yearsOfExperience: 4,
    noticePeriod: "30 days",
    screeningAnswers: [],
    cvFileId: "maya-first-cv",
    vacancyId: firstVacancy.id,
    consent: true,
  });
  const second = await candidates.submitApplication({
    firstName: "Maya",
    lastName: "Saleh",
    email: "maya.current@example.com",
    phone: "00971-50-111-2233",
    location: "Dubai",
    currentTitle: "Senior Coordinator",
    yearsOfExperience: 6,
    noticePeriod: "14 days",
    screeningAnswers: [],
    cvFileId: "maya-second-cv",
    vacancyId: secondVacancy.id,
    consent: true,
  });

  assert.equal(second.candidateId, first.candidateId);
  assert.equal(candidates.getCandidateRepository().list().length, 1);
  assert.equal(candidates.getCandidate(first.candidateId, hr)?.email, "maya.current@example.com");
  assert.equal(candidates.getCandidate(first.candidateId, hr)?.currentTitle, "Senior Coordinator");
  assert.equal(candidates.getCandidate(first.candidateId, hr)?.yearsOfExperience, 6);
  assert.equal(candidates.getApplicationRepository().list().length, 2);
});

test("failed accepted-offer provisioning rolls back every local conversion record", async () => {
  const { storage, audit } = harness();
  const candidates = new CandidateService();
  const candidate = candidates.getCandidateRepository().create(
    {
      firstName: "Rollback",
      lastName: "Candidate",
      email: "rollback.candidate@example.com",
      phone: "+971500001020",
      location: "Dubai",
      yearsOfExperience: 8,
      stage: "Offer",
      doNotContact: false,
    },
    hr,
  );
  const vacancy = new LocalRepository<Vacancy>("vacancies", storage, audit, {
    module: "recruitment",
    entityType: "vacancy",
  }).create(
    {
      title: "Rollback Test Role",
      position: "Rollback Test Role",
      department: "Operations",
      location: "Dubai",
      grade: "G7",
      employmentType: "Full-time",
      status: "Closed",
      summary: "Test role",
      responsibilities: ["Test"],
      requirements: ["Test"],
      applicantCount: 1,
      headcount: 1,
      hiringReason: "Replacement",
      education: "Degree",
      minimumExperience: "5 years",
      skills: { required: ["Testing"], preferred: [] },
      certifications: [],
      languages: ["English"],
      notes: "",
      screeningQuestions: [],
    },
    hr,
  );
  new LocalRepository<HiringDecisionSnapshot>("hiring_decisions", storage, audit, {
    module: "recruitment",
    entityType: "decision",
  }).create(
    {
      vacancyId: vacancy.id,
      systemRecommendedCandidateId: candidate.id,
      finalSelectedCandidateId: candidate.id,
      status: "Finalized",
    },
    hr,
  );
  const offers = new OfferService();
  let offer = offers.createOffer(
    {
      candidateId: candidate.id,
      vacancyId: vacancy.id,
      template: "VIA Standard Offer",
      position: vacancy.position,
      grade: vacancy.grade,
      salary: 20000,
      currency: "AED",
      allowances: "As per policy",
      benefits: "Medical insurance",
      startDate: "2026-10-01",
      probation: "6 months",
      location: vacancy.location,
      conditions: "Subject to references",
      responseDeadline: "2099-09-01",
    },
    hr,
  );
  for (const status of ["Pending Approval", "Approved", "Ready to Send", "Sent"] as const) {
    offer = await offers.transitionOffer(offer.id, status, undefined, hr);
  }
  configureIntegrationProviders({
    workspaceIdentity: {
      metadata: {
        name: "failing-workspace-test",
        mode: "local",
        capabilities: ["workspace_identity"],
      },
      async provisionIdentity() {
        throw new Error("Simulated provisioning failure");
      },
    },
  });

  await assert.rejects(
    () => offers.transitionOffer(offer.id, "Accepted", undefined, hr),
    /Simulated provisioning failure/,
  );
  assert.equal(new OfferService().getOfferById(offer.id, hr)?.status, "Sent");
  assert.equal(storage.readCollection("employees").length, 0);
  assert.equal(storage.readCollection("users").length, 0);
  assert.equal(storage.readCollection("onboardingCases").length, 0);
  assert.equal(candidates.getCandidate(candidate.id, hr)?.stage, "Offer");
  assert.ok(audit.list().some((event) => event.action === "offer_acceptance_rolled_back"));
  resetIntegrationProviders();
});

test("reviewed spreadsheet import preserves provenance, duplicate decisions, actor and batch audit", () => {
  const { audit } = harness();
  const candidates = new CandidateService();
  const importer = new ImportService();
  const rows = importer.normalizeData(
    [
      {
        Shortlisted: "Yes",
        Status: "Interview scheduled",
        Project: "Muscat Waterfront",
        Type: "Design",
        Name: "Sara Nasser",
        Email: "sara.nasser@example.com",
        Phone: "+971500000004",
        Position: "Planner",
        Company: "VIA International",
        Experience: "6 years",
        Nationality: "Omani",
        Location: "Muscat",
        Visa: "Omani",
        "Martial Status": "Single",
        Notice: "30 days",
        Current: "850 OMR",
        Expected: "1,000 OMR",
        Accepted: "950 OMR",
        "Last contacted": "12 Aug 2026",
        Interview: "25 Aug 2026",
        Remarks: "Available for a morning interview.",
      },
    ],
    "Planning Candidates",
    importer.autoMapHeaders([
      "Shortlisted",
      "Status",
      "Project",
      "Type",
      "Name",
      "Email",
      "Phone",
      "Position",
      "Company",
      "Experience",
      "Nationality",
      "Location",
      "Visa",
      "Martial Status",
      "Notice",
      "Current",
      "Expected",
      "Accepted",
      "Last contacted",
      "Interview",
      "Remarks",
    ]),
  );
  const detected = importer.detectDuplicates(rows, candidates);
  const result = importer.commitImportBatch(
    detected.newCandidates,
    detected.conflicts,
    candidates,
    hr,
  );
  assert.deepEqual(result, { inserted: 1, updated: 0, skipped: 0 });
  assert.match(
    candidates.getCandidateRepository().list()[0]!.importProvenance!,
    /Planning Candidates/,
  );
  const imported = candidates.getCandidateRepository().list()[0]!;
  assert.equal(imported.projectName, "Muscat Waterfront");
  assert.equal(imported.projectType, "Design");
  assert.equal(imported.shortlistStatus, "Yes");
  assert.equal(imported.trackerStatus, "Interview scheduled");
  assert.equal(imported.stage, "Interview");
  assert.equal(imported.noticePeriod, "30 days");
  assert.equal(imported.acceptedSalary, "950 OMR");
  assert.equal(imported.interviewDate, "25 Aug 2026");
  assert.equal(imported.source, undefined);
  assert.equal(imported.originalImportValues?.Project, "Muscat Waterfront");
  assert.ok(
    audit
      .list()
      .some(
        (event) =>
          event.entityType === "candidate-import-batch" && event.actor.userId === hr.actor.userId,
      ),
  );
});

test("manual interview bypasses application and scheduling but can enter the controlled offer path", () => {
  const { storage, audit } = harness();
  const candidates = new CandidateService();
  const candidate = candidates.getCandidateRepository().create(
    {
      firstName: "Maya",
      lastName: "Thomas",
      email: "maya.thomas@example.com",
      phone: "+971500000099",
      location: "Dubai",
      currentTitle: "Commercial Manager",
      yearsOfExperience: 10,
      stage: "Sourced",
      doNotContact: false,
      source: "Executive Referral",
    },
    hr,
  );
  const scorecards = new ScorecardService();
  const template = scorecards.getTemplates()[0]!;
  const interviews = new InterviewService();
  const interview = interviews.createManualInterview(
    {
      candidateId: candidate.id,
      templateId: template.id,
      stageName: "Leadership Discussion",
      occurredAt: "2026-08-19T08:00:00.000Z",
      durationMinutes: 60,
      timezone: "Asia/Dubai",
      panelUserIds: [hr.actor.userId],
      positionTitle: "Commercial Director",
      projectName: "Regional Growth",
      location: "VIA Dubai Office",
      videoMethod: "In person",
      notes: "Interview conducted before the candidate was entered into VIA HR System.",
    },
    hr,
  );

  assert.equal(interview.source, "Manual / Offline");
  assert.equal(interview.status, "Completed");
  assert.equal(interview.vacancyId, undefined);
  assert.equal(candidates.getApplicationRepository().list().length, 0);
  assert.equal(storage.readCollection("integration_operations").length, 0);

  const scorecard = scorecards.getOrCreateScorecard(interview.id, hr.actor.userId, hr);
  scorecards.submitScorecard(
    scorecard.id,
    template.criteria.map((criterion) => ({
      criterionId: criterion.id,
      score: 5,
      evidence: `Strong evidence for ${criterion.name}.`,
    })),
    "Strong Yes",
    hr,
  );
  const disposition = interviews.recordDisposition(
    interview.id,
    {
      outcome: "Recommend for Another Role",
      reason: "The panel recommends a broader regional leadership position.",
      suggestedRoleTitles: ["Regional Commercial Director"],
    },
    hr,
  );
  assert.equal(disposition.outcome, "Recommend for Another Role");
  assert.equal(interviews.getDispositionsForCandidate(candidate.id, hr).length, 1);
  assert.ok(
    candidates
      .getCandidate(candidate.id, hr)
      ?.talentPools?.includes("Future role: Regional Commercial Director"),
  );
  interviews.recordManualOutcome(
    interview.id,
    "Selected",
    "Panel scoring supports selection for a direct offer.",
    hr,
  );

  const offers = new OfferService();
  const prepared = offers.prepareManualInterviewHire(
    interview.id,
    {
      position: "Commercial Director",
      department: "Commercial",
      location: "Dubai",
      employmentType: "Full-time",
      grade: "G9",
    },
    "Approved as a controlled direct hire after manual interview scoring.",
    hr,
  );
  assert.equal(prepared.vacancy.status, "Closed");
  assert.equal(prepared.vacancy.applicantCount, 0);
  assert.equal(prepared.decision.decisionSource, "Manual Interview");
  assert.equal(prepared.decision.interviewId, interview.id);
  assert.equal(candidates.getCandidate(candidate.id, hr)?.stage, "Offer");
  assert.equal(candidates.getApplicationRepository().list().length, 0);

  const offer = offers.createOffer(
    {
      candidateId: candidate.id,
      vacancyId: prepared.vacancy.id,
      template: "VIA Standard Offer",
      position: "Commercial Director",
      grade: "G9",
      salary: 5000,
      currency: "OMR",
      allowances: "As per policy",
      benefits: "Medical insurance",
      startDate: "2026-10-01",
      probation: "6 months",
      location: "Dubai",
      conditions: "Subject to references",
      responseDeadline: "2099-09-01",
    },
    hr,
  );
  assert.equal(offer.status, "Draft");
  assert.ok(
    audit.list().some((event) => event.entityType === "interview" && event.action === "create"),
  );
});

test("accepted offer automatically creates the employee, source linkage, onboarding, and local integration records", async () => {
  const { storage, audit } = harness();
  const candidateService = new CandidateService();
  const candidate = candidateService.getCandidateRepository().create(
    {
      firstName: "Amina",
      lastName: "Rahman",
      email: "amina.rahman@example.com",
      phone: "+971500000001",
      location: "Dubai",
      currentTitle: "Operations Lead",
      yearsOfExperience: 8,
      stage: "Offer",
      doNotContact: false,
      source: "Employee Referral",
    },
    hr,
  );
  const vacancyRepo = new LocalRepository<Vacancy>("vacancies", storage, audit, {
    module: "recruitment",
    entityType: "vacancy",
  });
  const vacancy = vacancyRepo.create(
    {
      title: "Operations Lead",
      position: "Operations Lead",
      department: "Operations",
      location: "Dubai",
      grade: "G7",
      employmentType: "Full-time",
      status: "Open",
      summary: "Lead operations delivery.",
      responsibilities: ["Lead delivery"],
      requirements: ["Eight years experience"],
      applicantCount: 1,
      headcount: 1,
      hiringReason: "Growth",
      education: "Bachelor degree",
      minimumExperience: "8 years",
      skills: { required: ["Operations"], preferred: [] },
      certifications: [],
      languages: ["English"],
      notes: "",
      screeningQuestions: [],
    },
    hr,
  );
  candidateService.addRecommendation(
    {
      candidateId: candidate.id,
      vacancyId: vacancy.id,
      recommenderType: "Employee Referral",
      recommenderName: "Omar Khan",
      recommenderCompany: "VIA",
      recommenderPosition: "Project Director",
      recommenderEmail: "omar.khan@via.example",
      recommenderPhone: "+971500000002",
      relationship: "Former manager",
      date: "2026-08-20T08:00:00.000Z",
      notes: "Worked together for four years.",
      hrOwnerId: hr.actor.userId,
      commercialTerms: "No fee",
      sourceOutcome: "In Progress",
    },
    hr,
  );
  new LocalRepository<HiringDecisionSnapshot>("hiring_decisions", storage, audit, {
    module: "recruitment",
    entityType: "decision",
  }).create(
    {
      vacancyId: vacancy.id,
      systemRecommendedCandidateId: candidate.id,
      finalSelectedCandidateId: candidate.id,
      status: "Finalized",
    },
    hr,
  );

  const offers = new OfferService();
  let offer = offers.createOffer(
    {
      candidateId: candidate.id,
      vacancyId: vacancy.id,
      template: "Standard Employment Contract",
      position: vacancy.position,
      grade: vacancy.grade,
      salary: 240000,
      currency: "OMR",
      allowances: "Housing and transport",
      benefits: "Medical insurance",
      startDate: "2026-10-01",
      probation: "6 Months",
      location: vacancy.location,
      conditions: "Subject to references",
      responseDeadline: "2099-09-01",
    },
    hr,
  );
  await assert.rejects(
    () => offers.transitionOffer(offer.id, "Sent", undefined, hr),
    /cannot move/,
  );
  for (const status of [
    "Pending Approval",
    "Approved",
    "Ready to Send",
    "Sent",
    "Accepted",
  ] as const) {
    offer = await offers.transitionOffer(offer.id, status, undefined, hr);
  }

  const convertedCandidate = candidateService.getCandidate(candidate.id, hr)!;
  assert.equal(offer.status, "Accepted");
  assert.ok(convertedCandidate.convertedToEmployeeId);
  const employee = storage
    .readCollection<{ id: string; recommendationIds?: string[] }>("employees")
    .find((item) => item.id === convertedCandidate.convertedToEmployeeId)!;
  assert.equal(employee.recommendationIds?.length, 1);
  assert.equal(
    storage.readCollection<{ employeeId: string }>("onboardingCases")[0]?.employeeId,
    employee.id,
  );
  assert.match(
    storage
      .readCollection<{ employeeId?: string; workspaceEmail: string }>("users")
      .find((user) => user.employeeId === employee.id)!.workspaceEmail,
    /@via-int\.com$/,
  );
  assert.equal(
    candidateService.getRecommendationsForCandidate(candidate.id, hr)[0]?.employeeId,
    employee.id,
  );
  assert.throws(
    () =>
      candidateService.getRecommendationsForCandidate(candidate.id, {
        actor: {
          userId: "employee-viewer",
          displayName: "Employee Viewer",
          activeRole: "Employee",
          roles: ["Employee"],
        },
      }),
    /Only HR or Super Admin/,
  );

  const operationTypes = storage
    .readCollection<{ operationType: string }>("integration_operations")
    .map((item) => item.operationType);
  assert.ok(operationTypes.includes("email_delivery"));
  assert.ok(operationTypes.includes("workspace_identity"));
  assert.ok(audit.list().some((event) => event.entityType === "onboarding-case"));
});

test("interview confirmation records calendar, meeting and invitations and calculates weighted critical scoring", async () => {
  const { storage } = harness();
  storage.writeCollection("users", [
    { id: hr.actor.userId, workspaceEmail: "hr@via.example", status: "Active" },
    { id: "panel-1", workspaceEmail: "panel@via.example", status: "Active" },
  ]);
  storage.writeCollection("candidates", [
    { id: "candidate-1", firstName: "Noor", lastName: "Ali", email: "noor@example.com" },
  ]);
  storage.writeCollection("vacancies", [{ id: "vacancy-1", title: "Finance Manager" }]);

  const scorecards = new ScorecardService();
  const template = scorecards.createTemplate(
    {
      name: "Finance Leadership Panel",
      blindScoring: true,
      vacancyId: "vacancy-1",
      stageName: "Final Panel",
      aiDecisionWeight: 30,
      interviewDecisionWeight: 70,
      criteria: [
        {
          id: "leadership",
          name: "Leadership",
          description: "Leads teams",
          requiresEvidence: true,
          weight: 70,
        },
        {
          id: "controls",
          name: "Controls",
          description: "Financial controls",
          requiresEvidence: true,
          weight: 30,
          minimumScore: 4,
          isCritical: true,
        },
      ],
    },
    hr,
  );
  const interviews = new InterviewService();
  const interview = interviews.createInterview(
    {
      vacancyId: "vacancy-1",
      candidateId: "candidate-1",
      templateId: template.id,
      stageName: "Final Panel",
      panelUserIds: ["panel-1"],
      location: "Google Meet",
      videoMethod: "Google Meet",
    },
    hr,
  );
  const confirmed = await interviews.confirmInterview(
    interview.id,
    {
      startTime: "2026-09-01T08:00:00.000Z",
      endTime: "2026-09-01T09:00:00.000Z",
      timezone: "Asia/Dubai",
    },
    hr,
  );
  assert.ok(confirmed.calendarEventReference);
  assert.ok(confirmed.meetingJoinUrl?.includes("meet.google.com"));
  assert.equal(confirmed.invitationDeliveryReferences?.length, 2);

  const panelContext: ActorContext = {
    actor: { userId: "panel-1", displayName: "Panel Member", roles: ["Employee"] },
  };
  const scorecard = scorecards.getOrCreateScorecard(interview.id, "panel-1", panelContext);
  scorecards.submitScorecard(
    scorecard.id,
    [
      { criterionId: "leadership", score: 5, evidence: "Led a regional team." },
      { criterionId: "controls", score: 3, evidence: "Controls example lacked depth." },
    ],
    "Yes",
    panelContext,
  );
  const metrics = scorecards.calculateInterviewMetrics(interview.id, ["panel-1"]);
  assert.equal(metrics.averageScore, 4.4);
  assert.equal(metrics.criticalFailure, true);
  assert.deepEqual(
    new Set(
      storage
        .readCollection<{ operationType: string }>("integration_operations")
        .map((item) => item.operationType),
    ),
    new Set(["meeting_link", "calendar_event", "email_delivery"]),
  );
});

test("candidate responses are recorded and conflicting panel bookings are blocked", async () => {
  const { storage } = harness();
  storage.writeCollection("users", [
    { id: "panel-conflict", workspaceEmail: "panel.conflict@via.example", status: "Active" },
  ]);
  storage.writeCollection("candidates", [
    {
      id: "candidate-conflict-one",
      firstName: "One",
      lastName: "Candidate",
      email: "one@example.com",
    },
    {
      id: "candidate-conflict-two",
      firstName: "Two",
      lastName: "Candidate",
      email: "two@example.com",
    },
  ]);
  storage.writeCollection("vacancies", [{ id: "vacancy-conflict", title: "Project Manager" }]);
  const scorecards = new ScorecardService();
  const template = scorecards.createTemplate(
    {
      name: "Conflict Test",
      blindScoring: false,
      vacancyId: "vacancy-conflict",
      stageName: "Panel",
      aiDecisionWeight: 40,
      interviewDecisionWeight: 60,
      criteria: [
        {
          id: "experience",
          name: "Experience",
          description: "Relevant experience",
          requiresEvidence: false,
          weight: 100,
        },
      ],
    },
    hr,
  );
  const interviews = new InterviewService();
  const first = interviews.createInterview(
    {
      vacancyId: "vacancy-conflict",
      candidateId: "candidate-conflict-one",
      templateId: template.id,
      stageName: "Panel",
      panelUserIds: ["panel-conflict"],
    },
    hr,
  );
  await interviews.confirmInterview(
    first.id,
    {
      startTime: "2026-09-01T08:00:00.000Z",
      endTime: "2026-09-01T09:00:00.000Z",
      timezone: "Asia/Dubai",
    },
    hr,
  );
  const conflictingSlot = {
    startTime: "2026-09-01T08:30:00.000Z",
    endTime: "2026-09-01T09:30:00.000Z",
    timezone: "Asia/Dubai",
  };
  const availableSlot = {
    startTime: "2026-09-01T10:00:00.000Z",
    endTime: "2026-09-01T11:00:00.000Z",
    timezone: "Asia/Dubai",
  };
  const second = interviews.createInterview(
    {
      vacancyId: "vacancy-conflict",
      candidateId: "candidate-conflict-two",
      templateId: template.id,
      stageName: "Panel",
      panelUserIds: ["panel-conflict"],
      proposedSlots: [conflictingSlot, availableSlot],
    },
    hr,
  );
  interviews.sendSlotsToCandidate(second.id, hr);
  await assert.rejects(
    () => interviews.recordCandidateResponse(second.id, "Accepted", hr, conflictingSlot),
    /conflicts with panel member availability/,
  );
  const scheduled = await interviews.recordCandidateResponse(
    second.id,
    "Accepted",
    hr,
    availableSlot,
  );
  assert.equal(scheduled.status, "Scheduled");
  assert.ok(scheduled.history.some((entry) => entry.action === "Confirmed"));
});
