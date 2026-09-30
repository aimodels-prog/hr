// Browser-only component fixture. Never imported by application routes or release entry points.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SearchableSelect } from "../../../src/components/ui/searchable-select";
import { SearchablePeopleList } from "../../../src/components/ui/searchable-people-list";
import "../../../src/styles.css";

export function Fixture() {
  const [value, setValue] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const options = Array.from({ length: 150 }, (_, index) => ({
    value: `id-${index}`,
    label: `Alex Smith · VIA-${index}`,
    keywords: [`alex${index}@example.test`],
    disabled: index === 149,
  }));
  return (
    <main className="mx-auto max-w-xl space-y-5 p-4">
      <label htmlFor="person">Employee</label>
      <SearchableSelect
        id="person"
        options={[{ value: "", label: "No person" }, ...options]}
        value={value}
        onValueChange={setValue}
      />
      <output aria-label="Selected ID">{value || "empty"}</output>
      <SearchablePeopleList
        options={options}
        selected={selected}
        onToggle={(id, checked) =>
          setSelected((current) =>
            checked ? [...current, id] : current.filter((item) => item !== id),
          )
        }
      />
    </main>
  );
}
createRoot(document.getElementById("test-root")!).render(<Fixture />);
