import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/auth";
import { getApplicationDataServices } from "@/lib/data/application-data";
import {
  documentRequirementSchema,
  defaultDocumentRequirements,
  type DocumentRequirement,
} from "@/lib/data/document-requirements";
import {
  getDocumentRequirementsFn,
  saveDocumentRequirementsFn,
} from "@/lib/server-functions/document-requirements.server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function DocumentRequirementsPanel() {
  const user = useCurrentUser();
  const actorKey = JSON.stringify({
    actorId: user.id,
    actorEmail: user.workspaceEmail,
    activeRole: user.activeRole,
  });
  const [definitions, setDefinitions] = useState<DocumentRequirement[]>([]);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void getDocumentRequirementsFn({ data: { actor: JSON.parse(actorKey) } })
      .then((r) => {
        if (active) {
          setDefinitions(r.definitions);
          setVersion(r.version);
          setSelected(r.definitions[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [actorKey]);
  const current = definitions.find((r) => r.id === selected);
  const change = (patch: Partial<DocumentRequirement>) =>
    setDefinitions((all) => all.map((r) => (r.id === selected ? { ...r, ...patch } : r)));
  const collection =
    current?.audience === "Department"
      ? "departments"
      : current?.audience === "Position"
        ? "positions"
        : current?.audience === "Location"
          ? "locations"
          : "employees";
  const options = getApplicationDataServices()
    .storage.readCollection<{
      id: string;
      databaseId?: string;
      name?: string;
      legalName?: string;
      archivedAt?: string;
    }>(collection)
    .filter(
      (o) =>
        !o.archivedAt && (o.name ?? o.legalName ?? "").toLowerCase().includes(search.toLowerCase()),
    );
  if (!version) return <p role="status">{error || "Loading document requirements…"}</p>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Document requirements</h2>
          <p className="text-sm text-muted-foreground">
            Choose what staff upload and which details they complete.
          </p>
        </div>
        <Button
          onClick={() => {
            const r: DocumentRequirement = {
              id: crypto.randomUUID(),
              name: "New document",
              type: "other",
              enabled: true,
              required: false,
              multiple: false,
              uploadBy: "Employee",
              audience: "All",
              audienceIds: [],
              fields: [],
            };
            setDefinitions([...definitions, r]);
            setSelected(r.id);
          }}
        >
          Add document
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <label className="lg:hidden">
          Choose a document
          <select
            className="mt-2 h-10 w-full rounded-md border bg-background px-3"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setSearch("");
            }}
          >
            {definitions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {!r.enabled ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="Document requirements" className="hidden space-y-1 lg:block">
          {definitions.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setSelected(r.id);
                setSearch("");
              }}
              className={`w-full rounded-lg p-3 text-left text-sm ${r.id === selected ? "bg-primary text-primary-foreground" : "bg-muted/40"}`}
            >
              {r.name}
              {!r.enabled ? " (inactive)" : ""}
            </button>
          ))}
        </nav>
        {current && (
          <div className="space-y-5 rounded-xl border bg-card p-5">
            <label className="block space-y-2">
              Document name
              <Input value={current.name} onChange={(e) => change({ name: e.target.value })} />
            </label>
            <label className="block space-y-2">
              Document category
              <select
                className="h-10 w-full rounded-md border bg-background px-3"
                value={current.type}
                onChange={(e) => {
                  const preset = defaultDocumentRequirements().find(
                    (r) => r.type === e.target.value,
                  );
                  if (preset)
                    change({ type: preset.type, fields: preset.fields, uploadBy: preset.uploadBy });
                }}
              >
                {defaultDocumentRequirements()
                  .filter((r, i, a) => a.findIndex((o) => o.type === r.type) === i)
                  .map((r) => (
                    <option key={r.type} value={r.type}>
                      {r.type === "other" ? "Other / custom document" : r.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-5">
              {(
                [
                  ["enabled", "Available for upload"],
                  ["required", "Required"],
                  ["multiple", "Allow multiple documents"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={current[key]}
                    onChange={(e) => change({ [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                Uploaded by
                <select
                  className="mt-2 h-10 w-full rounded-md border bg-background px-3"
                  value={current.uploadBy}
                  onChange={(e) => change({ uploadBy: e.target.value as "Employee" | "HR" })}
                >
                  <option>Employee</option>
                  <option>HR</option>
                </select>
              </label>
              <label>
                Who needs it?
                <select
                  className="mt-2 h-10 w-full rounded-md border bg-background px-3"
                  value={current.audience}
                  onChange={(e) =>
                    change({
                      audience: e.target.value as DocumentRequirement["audience"],
                      audienceIds: [],
                    })
                  }
                >
                  {["All", "Department", "Position", "Location", "Employee"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            {current.audience !== "All" && (
              <div className="space-y-2">
                <Input
                  aria-label="Search people or groups"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="max-h-48 overflow-auto rounded-lg border p-3">
                  {options.map((o) => {
                    const id = o.databaseId ?? o.id;
                    return (
                      <label key={id} className="flex gap-2 py-2">
                        <input
                          type="checkbox"
                          checked={current.audienceIds.includes(id)}
                          onChange={(e) =>
                            change({
                              audienceIds: e.target.checked
                                ? [...current.audienceIds, id]
                                : current.audienceIds.filter((v) => v !== id),
                            })
                          }
                        />
                        {o.name ?? o.legalName}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <h3 className="font-medium">Details to collect</h3>
            {current.fields.map((f, index) => (
              <div key={f.key} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                <label>
                  Field label
                  <Input
                    value={f.label}
                    onChange={(e) =>
                      change({
                        fields: current.fields.map((v, i) =>
                          i === index ? { ...v, label: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Answer type
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3"
                    value={f.kind}
                    onChange={(e) =>
                      change({
                        fields: current.fields.map((v, i) =>
                          i === index ? { ...v, kind: e.target.value as typeof f.kind } : v,
                        ),
                      })
                    }
                  >
                    <option value="text">Text</option>
                    <option value="date">Date</option>
                    <option value="year">Year</option>
                  </select>
                </label>
                <label>
                  Completed by
                  <select
                    className="h-10 w-full rounded-md border bg-background px-3"
                    value={f.owner}
                    onChange={(e) =>
                      change({
                        fields: current.fields.map((v, i) =>
                          i === index ? { ...v, owner: e.target.value as typeof f.owner } : v,
                        ),
                      })
                    }
                  >
                    <option>Employee</option>
                    <option>HR</option>
                  </select>
                </label>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) =>
                        change({
                          fields: current.fields.map((v, i) =>
                            i === index ? { ...v, required: e.target.checked } : v,
                          ),
                        })
                      }
                    />
                    Required
                  </label>
                  <Button
                    variant="ghost"
                    onClick={() => change({ fields: current.fields.filter((_, i) => i !== index) })}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                change({
                  fields: [
                    ...current.fields,
                    {
                      key: `field_${crypto.randomUUID().replaceAll("-", "")}`,
                      label: "New field",
                      kind: "text",
                      required: false,
                      owner: "Employee",
                    },
                  ],
                })
              }
            >
              Add field
            </Button>
            <div className="text-sm text-muted-foreground">
              <label className="mb-3 block">
                Add a standard detail
                <select
                  value=""
                  className="mt-2 h-10 w-full rounded-md border bg-background px-3"
                  onChange={(e) => {
                    const [key, label] = e.target.value.split("|");
                    if (!key || !label) return;
                    change({
                      fields: [
                        ...current.fields,
                        {
                          key,
                          label,
                          kind: key.endsWith("Date") ? "date" : "text",
                          required: false,
                          owner: ["visa", "work_permit"].includes(current.type) ? "HR" : "Employee",
                        },
                      ],
                    });
                  }}
                >
                  <option value="">Choose a detail…</option>
                  {[
                    ["documentNumber", "Document number"],
                    ["issueDate", "Issue date"],
                    ["expiryDate", "Expiry date"],
                    ["issuingAuthority", "Issuing authority"],
                    ["issuingCountry", "Issuing country"],
                  ]
                    .filter(([key]) => !current.fields.some((f) => f.key === key))
                    .map(([key, label]) => (
                      <option key={key} value={`${key}|${label}`}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
              Documents are restricted. Existing uploads keep their original details. Turn off a
              requirement to retire it without deleting documents.
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <Button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              const validated = definitions.map((r) => documentRequirementSchema.parse(r));
              const result = await saveDocumentRequirementsFn({
                data: { actor: JSON.parse(actorKey), definitions: validated, version },
              });
              setDefinitions(result.definitions);
              setVersion(result.version);
              toast.success("Document requirements saved");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not save requirements");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Saving…" : "Save requirements"}
        </Button>
      </div>
    </div>
  );
}
