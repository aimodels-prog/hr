/** Case/accent-insensitive, order-independent words; never broadens the supplied option list. */
export function matchesSearch(query: string, ...values: string[]): boolean {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase();
  const text = normalize(values.join(" "));
  return normalize(query)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}
