import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { COUNTRY_OPTIONS, countryName, locationCountryCode } from "@/lib/recruitment/countries";

type Props = {
  value: string;
  onChange: (value: string) => void;
};

/** Keeps the existing single location value while standardising new country choices. */
export function LocationFields({ value, onChange }: Props) {
  const countryCode = locationCountryCode(value);
  const area = countryCode
    ? value.includes(",")
      ? value.slice(0, value.lastIndexOf(",")).trim()
      : ""
    : value;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <SearchableSelect
        options={COUNTRY_OPTIONS}
        value={countryCode ?? ""}
        onValueChange={(code) => onChange(`${area}, ${countryName(code)}`)}
        placeholder="Select a country"
        searchPlaceholder="Search countries"
        aria-label="Country"
      />
      <Input
        value={area}
        onChange={(event) =>
          onChange(
            countryCode ? `${event.target.value}, ${countryName(countryCode)}` : event.target.value,
          )
        }
        placeholder="City, state or province"
        aria-label="City, state or province"
      />
    </div>
  );
}
