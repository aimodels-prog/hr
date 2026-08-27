export type Stage = "Sourced" | "Screened" | "Shortlisted" | "Interview" | "Offer" | "Onboarding";

export type Candidate = {
  id: string;
  name: string;
  title: string;
  location: string;
  years: number;
  source: "Database" | "Email inbox" | "Referral" | "Career portal";
  score: number;
  stage: Stage;
  reasons: string[];
  risks: string[];
  skills: string[];
  email: string;
  salaryExpectation?: number | undefined;
  privateNotes?: string | undefined;
  interview?:
    | {
        date: string;
        time: string;
        panel: string;
        calendar: "Scheduled" | "Pending" | "Completed";
      }
    | undefined;
  interviewScore?: number | undefined;
};

export type Job = {
  id: string;
  title: string;
  department: string;
  location: string;
  type: string;
  posted: string;
  applicants: number;
  status: "Draft" | "Open" | "Interviewing";
  summary: string;
  responsibilities: string[];
  requirements: string[];
};

export const jobs: Job[] = [
  {
    id: "log-ops-lead",
    title: "Logistics Operations Lead",
    department: "Operations",
    location: "Dubai, UAE",
    type: "Full-time",
    posted: "2 days ago",
    applicants: 148,
    status: "Interviewing",
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
  },
  {
    id: "trade-compliance",
    title: "Trade Compliance Specialist",
    department: "Compliance",
    location: "Jebel Ali, UAE",
    type: "Full-time",
    posted: "5 days ago",
    applicants: 92,
    status: "Open",
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
  },
  {
    id: "fin-analyst",
    title: "Financial Analyst",
    department: "Finance",
    location: "Dubai, UAE",
    type: "Full-time",
    posted: "1 week ago",
    applicants: 210,
    status: "Open",
    summary:
      "Turn operational data into margin decisions — lane profitability, working capital and monthly forecast cycles.",
    responsibilities: [
      "Build lane-level profitability reporting",
      "Run the rolling 13-week cash forecast",
      "Partner with ops leads on cost control initiatives",
    ],
    requirements: [
      "3+ years FP&A experience, logistics preferred",
      "Advanced Excel plus Power BI or Tableau",
      "Part-qualified ACCA / CIMA / CPA",
    ],
  },
  {
    id: "warehouse-supervisor",
    title: "Warehouse Supervisor",
    department: "Operations",
    location: "Riyadh, KSA",
    type: "Full-time",
    posted: "1 week ago",
    applicants: 64,
    status: "Open",
    summary:
      "Run a 12,000 sqm bonded facility with a focus on safety, accuracy and inbound-to-dispatch cycle time.",
    responsibilities: [
      "Manage shift rosters and daily dispatch planning",
      "Maintain inventory accuracy above 99.5%",
      "Own HSE compliance and toolbox talks",
    ],
    requirements: [
      "5+ years warehouse supervision",
      "WMS experience (Manhattan, Infor or similar)",
      "Fluent Arabic and English",
    ],
  },
];

export const candidates: Candidate[] = [
  {
    id: "c1",
    name: "Amira Haddad",
    title: "Senior Freight Operations Manager",
    location: "Dubai, UAE",
    years: 9,
    source: "Database",
    score: 94,
    stage: "Interview",
    email: "amira.haddad@example.com",
    salaryExpectation: 2800,
    privateNotes:
      "Internal HR note: Candidate has competing offer from DHL. Willing to negotiate on start date if notice buyout is approved.",
    skills: ["CargoWise", "Team leadership", "Carrier negotiation", "Arabic"],
    reasons: [
      "9 years in multimodal freight, 4 of them leading teams of 6-10",
      "CargoWise power user — matches the core system requirement",
      "Delivered 98.2% OTIF at previous 3PL, above the target in the JD",
    ],
    risks: ["Notice period of 60 days"],
    interview: {
      date: "Mon 24 Aug",
      time: "10:00",
      panel: "R. Nair, S. Fadel",
      calendar: "Scheduled",
    },
    interviewScore: 4.6,
  },
  {
    id: "c2",
    name: "Daniel Okoro",
    title: "Operations Lead, Sea Freight",
    location: "Abu Dhabi, UAE",
    years: 7,
    source: "Referral",
    score: 91,
    stage: "Interview",
    email: "daniel.okoro@example.com",
    salaryExpectation: 2200,
    privateNotes:
      "Internal HR note: Recommended by Layla Al Harthy. Highly rated carrier contract negotiation abilities.",
    skills: ["Sea freight", "P&L ownership", "TMS", "Lean"],
    reasons: [
      "Owned a $14M lane P&L — direct match for cost-per-shipment focus",
      "Led a Lean programme cutting dwell time 22%",
      "Already based in the UAE, no relocation needed",
    ],
    risks: ["Limited air freight exposure"],
    interview: { date: "Mon 24 Aug", time: "13:30", panel: "R. Nair", calendar: "Scheduled" },
    interviewScore: 4.2,
  },
  {
    id: "c3",
    name: "Priya Raghunathan",
    title: "Logistics Manager",
    location: "Chennai, India",
    years: 8,
    source: "Database",
    score: 88,
    stage: "Shortlisted",
    email: "priya.r@example.com",
    skills: ["Import/export", "Customs", "SAP TM", "Vendor management"],
    reasons: [
      "Strong import/export desk background across GCC-India corridor",
      "Managed 11 coordinators across two sites",
      "Customs fluency reduces compliance handoffs",
    ],
    risks: ["Requires relocation and visa sponsorship"],
  },
  {
    id: "c4",
    name: "Mohammed Al-Suwaidi",
    title: "Deputy Operations Manager",
    location: "Jebel Ali, UAE",
    years: 6,
    source: "Career portal",
    score: 86,
    stage: "Shortlisted",
    email: "m.alsuwaidi@example.com",
    skills: ["Land freight", "Bonded logistics", "Arabic", "HSE"],
    reasons: [
      "Deep bonded-zone and free-zone operating knowledge",
      "Bilingual — valuable for carrier and customs relationships",
      "Six years, just at the required experience threshold",
    ],
    risks: ["Team size managed so far is 4, below the JD's 8"],
  },
  {
    id: "c5",
    name: "Grace Mensah",
    title: "Freight Forwarding Supervisor",
    location: "Accra, Ghana",
    years: 7,
    source: "Email inbox",
    score: 83,
    stage: "Screened",
    email: "grace.mensah@example.com",
    skills: ["Air freight", "CargoWise", "Client onboarding"],
    reasons: [
      "Air freight depth complements the current team's sea bias",
      "CargoWise certified",
      "Ran client onboarding for 20+ enterprise accounts",
    ],
    risks: ["No GCC market experience", "Relocation required"],
  },
  {
    id: "c6",
    name: "Yusuf Karaman",
    title: "Supply Chain Team Lead",
    location: "Istanbul, Türkiye",
    years: 10,
    source: "Database",
    score: 81,
    stage: "Screened",
    email: "y.karaman@example.com",
    skills: ["Multimodal", "Rate management", "Analytics"],
    reasons: [
      "Longest tenure of the pool with rate-management ownership",
      "Built a lane analytics model still used by his employer",
    ],
    risks: ["Mostly Europe-Türkiye lanes", "Salary expectation above band"],
  },
  {
    id: "c7",
    name: "Sara Bennani",
    title: "Operations Coordinator (Senior)",
    location: "Casablanca, Morocco",
    years: 5,
    source: "Email inbox",
    score: 78,
    stage: "Screened",
    email: "s.bennani@example.com",
    skills: ["Documentation", "Customer service", "French", "Arabic"],
    reasons: [
      "Excellent documentation accuracy record (99.7%)",
      "Trilingual, useful for North Africa corridor growth",
    ],
    risks: ["Below the 6-year requirement", "No direct reports yet"],
  },
  {
    id: "c8",
    name: "Rahul Kapoor",
    title: "3PL Operations Manager",
    location: "Dubai, UAE",
    years: 8,
    source: "Database",
    score: 76,
    stage: "Sourced",
    email: "rahul.kapoor@example.com",
    skills: ["Warehousing", "3PL", "WMS", "Contract logistics"],
    reasons: ["Contract logistics depth and local market network", "Available immediately"],
    risks: ["Warehouse-weighted profile, lighter on forwarding"],
  },
  {
    id: "c9",
    name: "Elena Petrova",
    title: "Transport Planning Lead",
    location: "Sofia, Bulgaria",
    years: 6,
    source: "Database",
    score: 74,
    stage: "Sourced",
    email: "e.petrova@example.com",
    skills: ["Route planning", "TMS", "Cost modelling"],
    reasons: ["Strong cost modelling background", "TMS migration experience"],
    risks: ["Land-only exposure", "Time zone and relocation"],
  },
  {
    id: "c10",
    name: "Tariq Rahman",
    title: "Export Desk Manager",
    location: "Karachi, Pakistan",
    years: 7,
    source: "Email inbox",
    score: 71,
    stage: "Sourced",
    email: "t.rahman@example.com",
    skills: ["Export operations", "Customs", "Team lead"],
    reasons: ["Export desk ownership with a team of 6"],
    risks: ["Limited system exposure beyond in-house tools", "Visa required"],
  },
];

export const scoringWeights = [
  { label: "Role experience", weight: 30 },
  { label: "Systems & tools", weight: 20 },
  { label: "Leadership", weight: 20 },
  { label: "Domain / corridor fit", weight: 15 },
  { label: "Availability & logistics", weight: 15 },
];

export const interviewCriteria = [
  "Operational depth",
  "Leadership & people",
  "Commercial judgement",
  "Communication",
  "Culture add",
];

export const onboardingTasks = [
  {
    group: "Documents",
    items: [
      "Passport & visa copy",
      "Signed offer letter",
      "Emirates ID application",
      "Educational certificates",
    ],
  },
  {
    group: "Payroll & benefits",
    items: [
      "Bank account details",
      "WPS enrolment",
      "Medical insurance form",
      "Dependant declaration",
    ],
  },
  {
    group: "IT & access",
    items: ["Laptop allocation", "Email & SSO account", "TMS role assignment", "Access badge"],
  },
  {
    group: "Day one",
    items: ["Welcome session", "HSE induction", "Buddy assignment", "30-60-90 plan review"],
  },
];
