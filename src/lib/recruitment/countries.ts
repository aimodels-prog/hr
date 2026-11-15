import english from "i18n-iso-countries/langs/en.json" with { type: "json" };

// Import the English country data directly. The package's CommonJS entry point
// dynamically requires every locale and cannot run from the bundled server.
export const COUNTRY_OPTIONS = Object.entries(english.countries)
  .map(([code, names]) => {
    const aliases = Array.isArray(names) ? names : [names];
    return {
      value: code,
      label: aliases[0] ?? code,
      keywords: [code, ...aliases],
    };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

const countryByCode = new Map(COUNTRY_OPTIONS.map((option) => [option.value, option.label]));

export function countryName(code: string): string {
  return countryByCode.get(code) ?? "";
}

export function locationCountryCode(location: string): string | undefined {
  const lastPart = location.split(",").at(-1)?.trim() ?? "";
  if (!lastPart) return undefined;
  return COUNTRY_OPTIONS.find((option) =>
    option.keywords.some((keyword) => keyword.toLowerCase() === lastPart.toLowerCase()),
  )?.value;
}
