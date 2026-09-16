export interface PolicySource {
  id: string;
  title: string;
  version: number;
  page: number;
  text: string;
}
export interface PolicyAnswer {
  text: string;
  documentId: string;
  page: number;
  quote: string;
}
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
export function validatePolicyAnswers(
  answers: PolicyAnswer[],
  sources: PolicySource[],
): PolicyAnswer[] {
  if (!answers.length) return [];
  return answers.every(
    (answer) =>
      answer.quote.trim().length >= 15 &&
      sources.some(
        (source) =>
          source.id === answer.documentId &&
          source.page === answer.page &&
          normalize(source.text).includes(normalize(answer.quote)),
      ),
  )
    ? answers
    : [];
}
export function selectPolicySources(question: string, sources: PolicySource[]): PolicySource[] {
  const words = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
  return sources
    .map((source) => ({
      source,
      score: words.reduce(
        (score, word) =>
          score + ((source.title + " " + source.text).toLowerCase().includes(word) ? 1 : 0),
        0,
      ),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((row) => ({ ...row.source, text: row.source.text.slice(0, 12000) }));
}
