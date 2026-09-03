import type { CollectionState } from "./storage.ts";
import type {
  AppSettings,
  AuditEvent,
  Employee,
  EmployeeDocument,
  Notification,
  User,
  MasterRecord,
  Project,
  Vacancy,
} from "./types.ts";
import type { AttendancePolicy } from "./attendance-types.ts";

export const SEED_TIMESTAMP = "2026-08-16T08:00:00.000Z";
export const SEED_SYSTEM_USER_ID = "user-super-admin";

// Keep reset/import output deterministic. Moving dates make an unchanged seed conflict with
// PostgreSQL the next day and prevent reliable backup verification.
const daysFromNow = (days: number) => {
  const d = new Date("2026-08-16T12:00:00.000Z");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const base = (id: string, actor = "system") => ({
  id,
  createdAt: SEED_TIMESTAMP,
  createdBy: actor,
  updatedAt: SEED_TIMESTAMP,
  updatedBy: actor,
  recordVersion: 1,
});

const employees: Employee[] = [
  {
    ...base("employee-rana"),
    employeeNumber: "VIA-0001",
    legalName: "Rana Nair",
    preferredName: "Rana",
    gender: "Female",
    workEmail: "rana.nair@via-int.com",
    phone: "+968 9900 1001",
    department: "People Operations",
    position: "HR Manager",
    location: "Muscat, Oman",
    employmentType: "Full-time",
    startDate: "2022-03-14",
    lineManagerId: "employee-yusuf",
    status: "Active",
    salary: {
      baseMonthly: 2400,
      currency: "OMR",
      housingAllowance: 600,
      transportAllowance: 150,
    },
    bankDetails: {
      bankName: "Bank Muscat",
      accountNumber: "031500123456001",
      iban: "OM63BMUS031500123456001",
      swiftCode: "BMUSOMRX",
    },
    nationalId: "10982341",
    passportNumber: "P9871234",
    performanceRating: 4.8,
    performanceNotes: "Exceptional leadership in recruitment scaling and HR policy modernisation.",
  },
  {
    ...base("employee-layla"),
    employeeNumber: "VIA-0002",
    legalName: "Layla Al Harthy",
    preferredName: "Layla",
    gender: "Female",
    workEmail: "layla.harthy@via-int.com",
    phone: "+968 9900 1002",
    department: "Operations",
    position: "Operations Director",
    location: "Muscat, Oman",
    employmentType: "Full-time",
    startDate: "2020-09-01",
    lineManagerId: "employee-yusuf",
    status: "Active",
    salary: {
      baseMonthly: 3100,
      currency: "OMR",
      housingAllowance: 800,
      transportAllowance: 200,
    },
    bankDetails: {
      bankName: "National Bank of Oman",
      accountNumber: "102200987654002",
      iban: "OM45NBOM102200987654002",
      swiftCode: "NBOMOMRX",
    },
    nationalId: "10293847",
    passportNumber: "P7654321",
    performanceRating: 4.9,
    performanceNotes: "High operational discipline; consistently meets logistics delivery SLAs.",
  },
  {
    ...base("employee-omar"),
    employeeNumber: "VIA-0003",
    legalName: "Omar Rahman",
    preferredName: "Omar",
    gender: "Male",
    workEmail: "omar.rahman@via-int.com",
    phone: "+968 9900 1003",
    department: "Operations",
    position: "Project Engineer",
    location: "Muscat, Oman",
    employmentType: "Full-time",
    startDate: "2024-01-08",
    lineManagerId: "employee-layla",
    status: "Active",
    salary: {
      baseMonthly: 1550,
      currency: "OMR",
      housingAllowance: 400,
      transportAllowance: 100,
    },
    bankDetails: {
      bankName: "Bank Dhofar",
      accountNumber: "010400554433003",
      iban: "OM72BKDH010400554433003",
      swiftCode: "BKDHOMRX",
    },
    nationalId: "11447788",
    passportNumber: "P5544332",
    performanceRating: 4.2,
    performanceNotes: "Strong technical delivery; currently on track with Q3 infrastructure goals.",
  },
  {
    ...base("employee-tariq"),
    employeeNumber: "VIA-0006",
    legalName: "Tariq Al Zadjali",
    preferredName: "Tariq",
    gender: "Male",
    workEmail: "tariq.zadjali@via-int.com",
    phone: "+968 9900 1006",
    department: "Operations",
    position: "Logistics Coordinator",
    location: "Muscat, Oman",
    employmentType: "Full-time",
    startDate: "2024-05-15",
    lineManagerId: "employee-layla",
    status: "Active",
    salary: {
      baseMonthly: 1250,
      currency: "OMR",
      housingAllowance: 350,
      transportAllowance: 100,
    },
    bankDetails: {
      bankName: "Bank Muscat",
      accountNumber: "031500667788006",
      iban: "OM63BMUS031500667788006",
      swiftCode: "BMUSOMRX",
    },
    nationalId: "11883322",
    passportNumber: "P6677889",
    performanceRating: 4.0,
    performanceNotes: "Reliable freight desk coordination; completed carrier safety onboarding.",
  },
  {
    ...base("employee-aisha"),
    employeeNumber: "VIA-0007",
    legalName: "Aisha Al Habsi",
    preferredName: "Aisha",
    gender: "Female",
    workEmail: "aisha.habsi@via-int.com",
    phone: "+968 9900 1007",
    department: "People Operations",
    position: "HR Specialist",
    location: "Muscat, Oman",
    employmentType: "Full-time",
    startDate: "2023-11-01",
    lineManagerId: "employee-rana",
    status: "Active",
    salary: {
      baseMonthly: 1400,
      currency: "OMR",
      housingAllowance: 350,
      transportAllowance: 100,
    },
    bankDetails: {
      bankName: "Oman Arab Bank",
      accountNumber: "050100778899007",
      iban: "OM81OABK050100778899007",
      swiftCode: "OABKOMRX",
    },
    nationalId: "11995544",
    passportNumber: "P4455667",
    performanceRating: 4.5,
    performanceNotes: "Proactive candidate screening and interview coordination.",
  },
  {
    ...base("employee-mariam"),
    employeeNumber: "VIA-0004",
    legalName: "Mariam Said",
    preferredName: "Mariam",
    gender: "Female",
    workEmail: "mariam.said@via-int.com",
    phone: "+968 9900 1004",
    department: "Accounts",
    position: "Senior Accountant",
    location: "Muscat, Oman",
    employmentType: "Full-time",
    startDate: "2021-06-20",
    lineManagerId: "employee-yusuf",
    status: "Active",
    salary: {
      baseMonthly: 2100,
      currency: "OMR",
      housingAllowance: 550,
      transportAllowance: 150,
    },
    bankDetails: {
      bankName: "Bank Muscat",
      accountNumber: "031500332211004",
      iban: "OM63BMUS031500332211004",
      swiftCode: "BMUSOMRX",
    },
    nationalId: "10556677",
    passportNumber: "P3322114",
    performanceRating: 4.7,
    performanceNotes: "Punctual payroll audits and strict compliance with accounting controls.",
  },
  {
    ...base("employee-yusuf"),
    employeeNumber: "VIA-0005",
    legalName: "Yusuf Al Balushi",
    preferredName: "Yusuf",
    gender: "Male",
    workEmail: "yusuf.balushi@via-int.com",
    phone: "+968 9900 1005",
    department: "Executive",
    position: "Managing Director",
    location: "Muscat, Oman",
    employmentType: "Full-time",
    startDate: "2018-01-01",
    status: "Active",
    salary: {
      baseMonthly: 4800,
      currency: "OMR",
      housingAllowance: 1200,
      transportAllowance: 300,
    },
    bankDetails: {
      bankName: "National Bank of Oman",
      accountNumber: "102200112233005",
      iban: "OM45NBOM102200112233005",
      swiftCode: "NBOMOMRX",
    },
    nationalId: "10011001",
    passportNumber: "P1122334",
    performanceRating: 5.0,
    performanceNotes: "Managing Director and system executive sponsor.",
  },
];

const users: User[] = [
  {
    ...base("user-rana"),
    employeeId: "employee-rana",
    displayName: "Rana Nair",
    workspaceEmail: "rana.nair@via-int.com",
    roles: ["Employee", "HR"],
    status: "Active",
  },
  {
    ...base("user-layla"),
    employeeId: "employee-layla",
    displayName: "Layla Al Harthy",
    workspaceEmail: "layla.harthy@via-int.com",
    roles: ["Employee", "Line Manager"],
    status: "Active",
  },
  {
    ...base("user-omar"),
    employeeId: "employee-omar",
    displayName: "Omar Rahman",
    workspaceEmail: "omar.rahman@via-int.com",
    roles: ["Employee"],
    status: "Active",
  },
  {
    ...base("user-tariq"),
    employeeId: "employee-tariq",
    displayName: "Tariq Al Zadjali",
    workspaceEmail: "tariq.zadjali@via-int.com",
    roles: ["Employee"],
    status: "Active",
  },
  {
    ...base("user-aisha"),
    employeeId: "employee-aisha",
    displayName: "Aisha Al Habsi",
    workspaceEmail: "aisha.habsi@via-int.com",
    roles: ["Employee", "HR"],
    status: "Active",
  },
  {
    ...base("user-mariam"),
    employeeId: "employee-mariam",
    displayName: "Mariam Said",
    workspaceEmail: "mariam.said@via-int.com",
    roles: ["Employee", "Accounts"],
    status: "Active",
  },
  {
    ...base(SEED_SYSTEM_USER_ID),
    employeeId: "employee-yusuf",
    displayName: "Yusuf Al Balushi",
    workspaceEmail: "yusuf.balushi@via-int.com",
    roles: ["Employee", "Super Admin"],
    status: "Active",
  },
];

const settings: AppSettings[] = [
  {
    ...base("settings-primary"),
    organisationName: "VIA International",
    timezone: "Asia/Muscat",
    baseCurrency: "OMR",
    workingDays: [0, 1, 2, 3, 4],
    standardDailyHours: 8,
    standardWeeklyHours: 40,
    leaveYearStart: "01-01",
    leaveYearEnd: "12-31",
    documentReminderDays: [90, 60, 30, 14, 7, 1],
    employeeNumberFormat: "VIA-{0000}",
    candidateReferenceFormat: "CAND-{00000}",
    schemaVersion: 1,
    requireOnboardingCompletionBeforeDashboard: true,
  },
];

const attendancePolicies: AttendancePolicy[] = [
  {
    ...base("attendance-policy-primary"),
    standardDailyHours: 8,
    expectedClockIn: "09:00",
    expectedClockOut: "18:00",
    defaultBreakMinutes: 60,
    lateGraceMinutes: 5,
    maximumLocationAccuracyMeters: 100,
    signOutReminderOffsetsMinutes: [0, 15, 30],
  },
];

const master = (id: string, name: string, code = "", orderIndex = 0): MasterRecord => ({
  ...base(id),
  name,
  code,
  isActive: true,
  orderIndex,
});

const departments: MasterRecord[] = [
  master("dept-operations", "Operations", "OPS", 1),
  master("dept-people", "People Operations", "HR", 2),
  master("dept-accounts", "Accounts", "FIN", 3),
  master("dept-executive", "Executive", "EXEC", 4),
  master("dept-compliance", "Compliance", "COMP", 5),
  master("dept-finance", "Finance", "FP&A", 6),
  master("dept-commercial", "Commercial", "COMM", 7),
];

const locations: MasterRecord[] = [
  {
    ...master("loc-muscat", "Muscat, Oman", "MCT", 1),
    latitude: 23.588,
    longitude: 58.3829,
    radiusMeters: 200,
    isClockInSite: true,
  },
  master("loc-salalah", "Salalah, Oman", "SLL", 2),
  master("loc-dubai", "Dubai, UAE", "DXB", 3),
  master("loc-jebel-ali", "Jebel Ali, UAE", "JAFZA", 4),
  master("loc-abu-dhabi", "Abu Dhabi, UAE", "AUH", 5),
];

const workingTimes: MasterRecord[] = [
  {
    ...master("working-time-standard", "Standard Office Hours", "STD", 1),
    startTime: "09:00:00",
    endTime: "18:00:00",
    breakMinutes: 60,
    workingDays: [0, 1, 2, 3, 4],
  },
];

const publicHolidays: MasterRecord[] = [];

const currencies: MasterRecord[] = [
  {
    ...master("currency-omr", "Omani Rial", "OMR", 1),
    symbol: "ر.ع.",
    decimalPlaces: 3,
  },
  { ...master("currency-aed", "UAE Dirham", "AED", 2), symbol: "د.إ", decimalPlaces: 2 },
  { ...master("currency-usd", "US Dollar", "USD", 3), symbol: "$", decimalPlaces: 2 },
];

const projects: Project[] = [
  {
    ...master("proj-001", "Al Mouj Phase 3", "PRJ-001", 1),
    client: "Al Mouj Properties",
    type: "Construction",
    location: "Muscat",
    startDate: "2024-01-01",
    managerId: "employee-layla",
  },
];

const positions: MasterRecord[] = [
  master("pos-hr-manager", "HR Manager", "HRM", 1),
  master("pos-ops-director", "Operations Director", "OD", 2),
  master("pos-project-eng", "Project Engineer", "PE", 3),
  master("pos-logistics-coordinator", "Logistics Coordinator", "LC", 4),
  master("pos-hr-specialist", "HR Specialist", "HRS", 5),
  master("pos-senior-accountant", "Senior Accountant", "SA", 6),
  master("pos-managing-director", "Managing Director", "MD", 7),
  master("pos-operations-lead", "Operations Lead", "OL", 8),
  master("pos-compliance-specialist", "Compliance Specialist", "CS", 9),
  master("pos-financial-analyst", "Financial Analyst", "FA", 10),
  master("pos-coordinator", "Coordinator", "COORD", 11),
  master("pos-senior-operations-coordinator", "Senior Operations Coordinator", "SOC", 12),
];

const grades: MasterRecord[] = Array.from({ length: 9 }, (_, index) =>
  master(`grade-g${index + 1}`, `G${index + 1}`, `G${index + 1}`, index + 1),
);

const employmentTypes: MasterRecord[] = [
  master("employment-full-time", "Full-time", "FT", 1),
  master("employment-part-time", "Part-time", "PT", 2),
  master("employment-fixed-term", "Fixed-term", "FIX", 3),
  master("employment-internship", "Internship", "INT", 4),
];

// Timesheet entries reference these by ID and are rejected if the reference doesn't resolve to
// an active record (see TimesheetService.submitTimesheet) - a handful of realistic defaults keep
// the demo usable out of the box instead of every employee needing HR to configure master data
// before they can log a single hour.
const costCentres: MasterRecord[] = [
  master("cc-operations", "Operations", "CC-OPS", 1),
  master("cc-people", "People Operations", "CC-HR", 2),
  master("cc-accounts", "Accounts", "CC-FIN", 3),
  master("cc-executive", "Executive", "CC-EXEC", 4),
];

const activityCodes: MasterRecord[] = [
  master("activity-delivery", "Project Delivery", "ACT-DEL", 1),
  master("activity-admin", "Administration", "ACT-ADM", 2),
  master("activity-client-meeting", "Client Meeting", "ACT-CLI", 3),
  master("activity-design", "Design & Planning", "ACT-DSN", 4),
];

const notifications: Notification[] = [
  {
    ...base("notification-welcome", SEED_SYSTEM_USER_ID),
    recipientUserId: "user-rana",
    type: "system.ready",
    title: "VIA HR System is ready",
    message: "VIA HR System is ready.",
    priority: "Normal",
    status: "Unread",
    deduplicationKey: "seed-system-ready-user-rana",
  },
];

const auditEvents: AuditEvent[] = [
  {
    id: "audit-demo-data-initialized",
    occurredAt: SEED_TIMESTAMP,
    actor: {
      userId: "system",
      displayName: "VIA HR System",
      roles: ["Super Admin"],
    },
    action: "initialize",
    module: "data-management",
    entityType: "demo-data",
    entityId: "via-hr-demo-data",
    after: { seedVersion: 1 },
    reason: "Initial deterministic VIA demo dataset",
    riskLevel: "Low",
  },
];

const vacancies: Vacancy[] = [
  {
    ...base("log-ops-lead"),
    title: "Logistics Operations Lead",
    department: "Operations",
    location: "Dubai, UAE",
    position: "Operations Lead",
    grade: "G6",
    employmentType: "Full-time",
    status: "Open",
    applicantCount: 148,
    targetStartDate: "2026-10-01",
    summary:
      "Own end-to-end freight execution across sea, air and land corridors, keeping service levels high and cost per shipment low.",
    responsibilities: [
      "Lead a team of 8 coordinators across import and export desks",
      "Own carrier negotiations and quarterly rate reviews",
      "Drive on-time delivery above 97% across all lanes",
    ],
    requirements: [
      "6+ years in freight forwarding or 3PL operations",
      "Hands-on with CargoWise or comparable TMS",
      "Proven people leadership in a multi-site environment",
    ],
    mandatoryCriteria: [
      "6+ years in freight forwarding or 3PL operations",
      "Hands-on with CargoWise or comparable TMS",
    ],
    headcount: 1,
    hiringReason: "Replacement",
    education: "Bachelor's degree in Supply Chain, Logistics, or related field",
    minimumExperience: "6+ years",
    skills: {
      required: ["Freight Forwarding", "CargoWise", "Team Leadership"],
      preferred: ["Arabic", "Process Improvement"],
    },
    certifications: ["CSCP preferred"],
    languages: ["English", "Arabic (advantage)"],
    notes: "Critical hire to stabilize the import desk.",
    screeningQuestions: ["Do you have experience with CargoWise?", "Have you led a team of 5+?"],
    salaryRange: { min: 20000, max: 28000, currency: "AED", visibleToPublic: false },
  },
  {
    ...base("trade-compliance"),
    title: "Trade Compliance Specialist",
    department: "Compliance",
    location: "Jebel Ali, UAE",
    position: "Compliance Specialist",
    grade: "G4",
    employmentType: "Full-time",
    status: "Open",
    applicantCount: 92,
    targetStartDate: "2026-10-15",
    summary:
      "Keep every shipment clean against customs, sanctions and dangerous-goods regulation across our trading corridors.",
    responsibilities: [
      "Own HS classification and customs documentation quality",
      "Run internal audits and corrective action plans",
      "Advise commercial teams on restricted party screening",
    ],
    requirements: [
      "4+ years customs or trade compliance experience",
      "Working knowledge of GCC customs regimes",
      "Certification in DG handling is a plus",
    ],
    mandatoryCriteria: [
      "4+ years customs or trade compliance experience",
      "Working knowledge of GCC customs regimes",
    ],
    headcount: 1,
    hiringReason: "New role for expanding corridor",
    education: "Degree in International Trade, Law, or Business",
    minimumExperience: "4+ years",
    skills: {
      required: ["HS Classification", "GCC Customs", "Internal Audits"],
      preferred: ["DG Handling"],
    },
    certifications: ["DG Certification"],
    languages: ["English", "Arabic"],
    notes: "",
    screeningQuestions: ["Are you familiar with GCC customs regimes?"],
    salaryRange: { min: 15000, max: 20000, currency: "AED", visibleToPublic: false },
  },
  {
    ...base("fin-analyst"),
    title: "Financial Analyst",
    department: "Finance",
    location: "Dubai, UAE",
    position: "Financial Analyst",
    grade: "G4",
    employmentType: "Full-time",
    status: "Open",
    applicantCount: 210,
    targetStartDate: "2026-11-01",
    summary:
      "Turn operational data into margin decisions — lane profitability, working capital and monthly forecast cycles.",
    responsibilities: [
      "Build lane-level profitability reporting",
      "Partner with operations to uncover cost-saving opportunities",
      "Support month-end close and variance analysis",
    ],
    requirements: [
      "3+ years in FP&A, ideally within logistics or supply chain",
      "Advanced Excel and PowerBI skills",
      "Strong capability to communicate financial concepts to non-financial managers",
    ],
    mandatoryCriteria: [
      "3+ years in FP&A, ideally within logistics or supply chain",
      "Advanced Excel and PowerBI skills",
    ],
    headcount: 2,
    hiringReason: "Team expansion",
    education: "Bachelor's in Finance, Accounting, or Economics",
    minimumExperience: "3+ years",
    skills: {
      required: ["FP&A", "Advanced Excel", "PowerBI"],
      preferred: ["Logistics experience", "SQL"],
    },
    certifications: ["CPA/CFA or CMA part-qualified preferred"],
    languages: ["English"],
    notes: "Requires strong business partnering skills.",
    screeningQuestions: [
      "Rate your PowerBI proficiency (1-10)?",
      "Have you partnered with operations teams before?",
    ],
    salaryRange: { min: 14000, max: 18000, currency: "AED", visibleToPublic: true },
  },
];

const employeeDocuments: EmployeeDocument[] = [
  {
    ...base("employee-document-omar-work-permit"),
    employeeId: "employee-omar",
    type: "work_permit",
    fileId: "seed-file-omar-work-permit",
    documentNumber: "WP-2023-88214",
    issueDate: daysFromNow(-700),
    expiryDate: daysFromNow(20),
    issuingAuthority: "Royal Oman Police",
    visibility: "Restricted",
    status: "Valid",
  },
  {
    ...base("employee-document-tariq-passport"),
    employeeId: "employee-tariq",
    type: "passport",
    fileId: "seed-file-tariq-passport",
    documentNumber: "P-4471029",
    issueDate: daysFromNow(-1800),
    expiryDate: daysFromNow(60),
    issuingAuthority: "Royal Oman Police",
    visibility: "Restricted",
    status: "Valid",
  },
];

export const trainingCourses = [
  {
    id: "course-first-aid",
    code: "HSE-001",
    title: "Basic First Aid & CPR",
    description: "Mandatory first aid certification for site workers.",
    provider: "Oman Safety Institute",
    category: "HSE",
    deliveryType: "Classroom",
    durationHours: 8,
    cost: 50,
    currency: "OMR",
    validityMonths: 24,
    requiredRoles: [],
    requiredLocations: ["loc-salalah", "loc-dubai"],
    requiredProjects: [],
    isMandatory: true,
    isActive: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    createdBy: "system",
    updatedBy: "system",
    recordVersion: 1,
  },
];

const trainingRequests = [
  {
    id: "training-request-omar-first-aid",
    employeeId: "employee-omar",
    courseId: "course-first-aid",
    origin: "Employee Request",
    reason: "Required for a new site assignment.",
    status: "Pending Supervisor",
    createdAt: "2026-09-15T08:00:00.000Z",
    updatedAt: "2026-09-15T08:00:00.000Z",
    createdBy: "employee-omar",
    updatedBy: "employee-omar",
    recordVersion: 1,
  },
];

export function createSeedCollections(): CollectionState {
  return structuredClone({
    appSettings: settings,
    attendancePolicies,
    attendanceRecords: [],
    attendanceCorrections: [],
    attendanceSiteVisits: [],
    employees,
    users,
    notifications,
    auditEvents,
    departments,
    locations,
    workingTimes,
    publicHolidays,
    currencies,
    projects,
    positions,
    grades,
    employmentTypes,
    costCentres,
    activityCodes,
    vacancies,
    candidates: [],
    applications: [],
    employee_documents: employeeDocuments,
    training_courses: trainingCourses,
    training_requests: trainingRequests,
    training_sessions: [],
    training_enrollments: [],
    training_records: [],
    reportSavedViews: [],
  });
}
