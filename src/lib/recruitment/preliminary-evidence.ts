/** Deterministic screening evidence, not verification of a qualification by its issuer. */
export const PRELIMINARY_RULES_VERSION = "VIA-EVIDENCE-3";

export interface ScreeningFact {
  source: string;
  text: string;
}

const CONCEPT_GROUPS = [
  ["freight forwarding", "international shipping", "shipping operations"],
  ["supply chain", "supply-chain", "logistics"],
  ["financial planning and analysis", "fp&a", "fpa", "financial planning"],
  ["health and safety", "hse", "ehs", "occupational safety"],
  ["human resources", "hr", "people operations"],
  ["business development", "commercial development", "sales development"],
  ["project management", "programme management", "program management"],
  ["quality assurance", "quality control", "qa", "qc"],
  ["customs clearance", "customs brokerage", "customs compliance"],
  ["data analysis", "analytics", "business intelligence"],
] as const;

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\blicen[cs]es?\b/g, "licence")
    .replace(/\bcertifications?\b/g, "certificate");
}

const ignored = new Set([
  "a",
  "an",
  "the",
  "and",
  "of",
  "in",
  "for",
  "with",
  "required",
  "must",
  "have",
  "hold",
  "possess",
]);
const qualifiers = new Set(["valid", "active", "current", "currently", "minimum", "at", "least"]);
const generic = new Set([
  "certificate",
  "licence",
  "degree",
  "experience",
  "years",
  "year",
  "skills",
  "skill",
]);

function tokens(value: string): string[] {
  let text = normalize(value);
  for (const group of CONCEPT_GROUPS) {
    for (const phrase of [...group].sort((a, b) => b.length - a.length)) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "g"), group[0]);
    }
  }
  return [...new Set(text.split(/[^\p{L}\p{N}+#]+/u).filter((word) => word && !ignored.has(word)))];
}

// Keep each statement separate: an Oman address plus a UAE licence is not an Oman licence.
function statements(text: string): string[] {
  const parts = text
    .split(/[;!?\n\r]+|\.(?=\s|$)/)
    .map((part) => part.trim())
    .filter(Boolean);
  // CVs often put a licence's status/expiry on the next line or after a semicolon.
  return parts.map((part, index) =>
    index > 0 &&
    /^(?:status\s*[:=-]?\s*)?(?:expired|lapsed|revoked|suspended|pending|awaiting|expir(?:es|y|ation)|valid (?:until|through|to))\b/i.test(
      part,
    )
      ? `${parts[index - 1]}; ${part}`
      : part,
  );
}

function uncertainty(text: string, today: string): string | undefined {
  const normalized = normalize(text);
  if (
    /\b(?:no|not|never|without|lack(?:s|ing)?|unable|cannot|can'?t|don'?t|doesn'?t|didn'?t|hasn'?t|haven'?t|isn'?t|aren'?t)\b/.test(
      normalized,
    )
  )
    return "Negative or conflicting statement";
  if (
    /\b(?:expired|lapsed|revoked|suspended|invalid|unlicensed|unqualified|unverified|pending|awaiting|planned|planning|pursuing|incomplete|willing|intends?|renewal|in progress|working towards?|working toward)\b/.test(
      normalized,
    )
  )
    return "Qualification is unavailable, uncertain or not yet completed";
  const expiry = normalized.match(
    /\b(?:expir(?:es|y|ation)(?: date)?|valid (?:until|through|to))\s*[:=-]?\s*(\d{4}-\d{2}-\d{2})\b/,
  );
  if (expiry) {
    const parsed = new Date(`${expiry[1]}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== expiry[1])
      return "Expiry date needs review";
    if (expiry[1]! < today) return "The stated expiry date has passed";
  } else if (/\b(?:expir(?:es|y|ation)|valid (?:until|through|to))\b/.test(normalized)) {
    // Do not guess ambiguous DD/MM versus MM/DD dates, or missing expiry values.
    return "Expiry date needs review";
  }
  if (/\b(?:required|requires|must|should|desirable|preferred|if|unless)\b/.test(normalized))
    return "Conditional or requirement wording needs review";
  return undefined;
}

function related(required: string[], text: string): boolean {
  const available = new Set(tokens(text));
  const subject = required.filter((token) => !qualifiers.has(token));
  const specific = subject.filter((token) => !generic.has(token));
  if (subject.every((token) => available.has(token))) return true;
  // A specific qualification name is stronger than generic words such as "certificate".
  if (specific.length && specific.every((token) => available.has(token))) return true;
  // "No driving licence" also conflicts with a claimed *Oman* driving licence.
  // Do not require the negative statement to repeat every geographic qualifier.
  if (
    specific.some((token) => available.has(token)) &&
    subject.some((token) => generic.has(token) && available.has(token))
  )
    return true;
  const normalized = normalize(text);
  if (
    subject.some(
      (token) =>
        ["licence", "certificate", "degree"].includes(token) &&
        new RegExp(
          `\\b(?:no|without|not (?:hold|have|obtained)|expired)\\s+(?:(?:a|any|the|valid)\\s+)*${token}\\b|\\b${token}\\s+(?:is\\s+)?(?:expired|revoked|suspended)\\b`,
        ).test(normalized),
    )
  )
    return true;
  // A bare "licence expired" can contradict a claimed valid driving licence too.
  const availableSpecific = [...available].filter(
    (token) =>
      !generic.has(token) &&
      !qualifiers.has(token) &&
      !/^(?:no|not|expired|lapsed|revoked|suspended|invalid|pending|awaiting|renewal)$/.test(token),
  );
  return (
    availableSpecific.length === 0 &&
    subject.some((token) => generic.has(token) && available.has(token))
  );
}

export function assessPreliminaryCriterion(
  criterion: string,
  facts: readonly ScreeningFact[],
  options: { cvText?: string | undefined; today?: string } = {},
): { criterion: string; status: "Confirmed" | "Needs Review"; evidence: string } {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const required = tokens(criterion);
  const review = (evidence: string) => ({ criterion, status: "Needs Review" as const, evidence });
  if (!required.length) return review("No assessable criterion was provided.");
  // Quantities and negative eligibility rules need a structured or HR assessment, not word overlap.
  if (/\d|\b(?:no|not|without|minimum|at least|more than|less than)\b/i.test(criterion))
    return review("A quantified or exclusion criterion requires HR confirmation.");

  const entries = facts.flatMap((fact) =>
    statements(fact.text).map((text) => ({ source: fact.source, text })),
  );
  const context = [
    ...entries,
    ...statements(options.cvText ?? "").map((text) => ({ source: "CV text", text })),
  ];
  for (const fact of context) {
    const reason = uncertainty(fact.text, today);
    if (reason && related(required, fact.text))
      return review(`${reason}. ${fact.source}: ${fact.text.slice(0, 350)}`);
  }
  for (const fact of entries) {
    if (uncertainty(fact.text, today)) continue;
    const available = new Set(tokens(fact.text));
    // "Valid until" with a checked future ISO expiry is positive validity evidence.
    if (/\bvalid (?:until|through|to)\s*[:=-]?\s*\d{4}-\d{2}-\d{2}\b/i.test(fact.text)) {
      available.add("valid");
      available.add("current");
    }
    if (required.every((token) => available.has(token)))
      return {
        criterion,
        status: "Confirmed",
        evidence: `${fact.source}: ${fact.text.slice(0, 350)}`,
      };
  }
  return review(
    "No clear positive statement confirms the complete criterion; HR review is required.",
  );
}

/** Use asserted qualification fields, never a company name or address as proof of eligibility. */
export function candidateScreeningFacts(
  candidate: {
    currentTitle?: string | null | undefined;
    skills?: readonly string[] | null | undefined;
    education?: readonly string[] | null | undefined;
    certifications?: readonly string[] | null | undefined;
    languages?: readonly string[] | null | undefined;
    workEligibility?: string | null | undefined;
  },
  extracted: Record<string, unknown>,
): ScreeningFact[] {
  const result: ScreeningFact[] = [];
  for (const key of [
    "currentTitle",
    "skills",
    "education",
    "certifications",
    "languages",
    "workEligibility",
  ] as const) {
    for (const [prefix, value] of [
      ["Candidate", candidate[key]],
      ["CV", extracted[key]],
    ] as const) {
      for (const text of Array.isArray(value) ? value : [value])
        if (typeof text === "string" && text.trim())
          result.push({ source: `${prefix} ${key}`, text });
    }
  }
  return result;
}

export function currentPreliminaryRules(model: string | null | undefined): boolean {
  return Boolean(model?.startsWith(`${PRELIMINARY_RULES_VERSION} | `));
}
