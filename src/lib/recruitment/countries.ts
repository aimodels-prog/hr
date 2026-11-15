import * as countries from "i18n-iso-countries";
import english from "i18n-iso-countries/langs/en.json";

countries.registerLocale(english);

const names = countries.getNames("en", { select: "official" });

export const COUNTRY_OPTIONS = Object.entries(names)
  .map(([code, label]) => ({
    value: code,
    label,
    keywords: [code, ...(countries.getName(code, "en", { select: "all" }) as string[])],
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

const countryByCode = new Map(COUNTRY_OPTIONS.map((option) => [option.value, option.label]));

export function countryName(code: string): string {
  return countryByCode.get(code) ?? "";
}

export function locationCountryCode(location: string): string | undefined {
  const lastPart = location.split(",").at(-1)?.trim() ?? "";
  if (!lastPart) return undefined;
  return (
    countries.getAlpha2Code(lastPart, "en") ??
    COUNTRY_OPTIONS.find((option) =>
      option.keywords.some((keyword) => keyword.toLowerCase() === lastPart.toLowerCase()),
    )?.value
  );
}
