import { useState, useMemo, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  Landmark,
  ShieldCheck,
} from "lucide-react";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MasterDataService, type MasterDataCollection } from "@/lib/data/master-data";
import type { MasterRecord } from "@/lib/data/types";
import { MasterDataTable } from "@/components/settings/master-data-table";
import { MasterDataForm } from "@/components/settings/master-data-form";
import { DataManagement } from "@/components/settings/data-management";
import { toast } from "sonner";
import { LeavePolicyConfig } from "@/components/settings/leave-policy-config";
import { OnboardingTemplatesPanel } from "@/components/settings/onboarding-templates-panel";
import { OffboardingTemplatesPanel } from "@/components/settings/offboarding-templates-panel";
import { InterviewTemplatesPanel } from "@/components/settings/interview-templates-panel";
import { PerformanceTemplatesPanel } from "@/components/settings/performance-templates-panel";
import {
  OrganisationSettingsPanel,
  NumberingSettingsPanel,
} from "@/components/settings/organisation-settings-panel";
import { ProjectsPanel } from "@/components/settings/projects-panel";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type HolidayMasterRecord = MasterRecord & { date?: string };

const SETTINGS_GROUPS = [
  {
    label: "Organisation",
    icon: Building2,
    items: [
      {
        key: "org",
        label: "Company information",
        description: "Company identity and working week",
      },
      { key: "numbering", label: "Employee numbering", description: "Employee number sequences" },
      { key: "departments", label: "Departments", description: "Organisation departments" },
      { key: "locations", label: "Locations", description: "Offices and work locations" },
      { key: "positions", label: "Positions", description: "Job positions used across VIA" },
      { key: "grades", label: "Grades", description: "Employee grades and levels" },
      {
        key: "employmentTypes",
        label: "Employment types",
        description: "Permanent, temporary and other arrangements",
      },
    ],
  },
  {
    label: "Time, leave and attendance",
    icon: CalendarClock,
    items: [
      { key: "workingTimes", label: "Working times", description: "Schedules and standard hours" },
      { key: "publicHolidays", label: "Public holidays", description: "Company holiday calendar" },
      {
        key: "leavePolicies",
        label: "Leave policies",
        description: "Entitlements and request rules",
      },
    ],
  },
  {
    label: "Recruitment and lifecycle",
    icon: ClipboardCheck,
    items: [
      {
        key: "interviewTemplates",
        label: "Interview scorecards",
        description: "Interview stages and scoring criteria",
      },
      {
        key: "onboardingTemplates",
        label: "Onboarding checklists",
        description: "New-joiner tasks and responsibilities",
      },
      {
        key: "offboardingTemplates",
        label: "Offboarding checklists",
        description: "Handover and clearance requirements",
      },
      {
        key: "performanceTemplates",
        label: "Performance templates",
        description: "Objectives and review criteria",
      },
    ],
  },
  {
    label: "Finance references",
    icon: Landmark,
    items: [
      { key: "projects", label: "Projects", description: "Active projects and assignments" },
      { key: "costCentres", label: "Cost centres", description: "Finance reporting codes" },
      { key: "activityCodes", label: "Activity codes", description: "Timesheet activity choices" },
      { key: "currencies", label: "Currencies", description: "Supported payment currencies" },
    ],
  },
  {
    label: "Administration",
    icon: ShieldCheck,
    items: [
      {
        key: "data",
        label: "Data management",
        description: "Protected backups, recovery and retention",
      },
    ],
  },
] as const;

type SettingsSection = (typeof SETTINGS_GROUPS)[number]["items"][number]["key"];
type SettingsItem = { key: SettingsSection; label: string; description: string };
const SETTINGS_ITEMS: SettingsItem[] = SETTINGS_GROUPS.reduce<SettingsItem[]>(
  (items, group) => [...items, ...group.items],
  [],
);

function isSettingsSection(value: unknown): value is SettingsSection {
  return SETTINGS_ITEMS.some((item) => item.key === value);
}

export const Route = createFileRoute("/staff/settings")({
  component: SettingsRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    section: isSettingsSection(search["section"]) ? search["section"] : "org",
  }),
});

function SettingsRoute() {
  const currentUser = useCurrentUser();
  const navigate = Route.useNavigate();
  const { section } = Route.useSearch();
  if (!currentUser.can("system:settings_manage")) {
    return (
      <RequirePermission permission="leave:admin_all" resourceName="Leave Policies">
        <div className="flex max-w-7xl flex-col gap-6 mx-auto">
          <PageHeader
            title="Leave Policies"
            description="Manage leave allowances, evidence requirements and notice rules."
            breadcrumbs={[{ label: "Time & Travel" }, { label: "Leave Policies" }]}
          />
          <LeavePolicyConfig />
        </div>
      </RequirePermission>
    );
  }
  return (
    <RequirePermission permission="system:settings_manage" resourceName="Settings">
      <div className="flex flex-col gap-6 max-w-7xl mx-auto">
        <PageHeader
          title="Company Setup"
          description="Manage company information, people structures, workflow templates and reference lists."
          breadcrumbs={[{ label: "System" }, { label: "Company Setup" }]}
        />

        <div className="lg:hidden">
          <label className="mb-2 block text-sm font-medium" htmlFor="settings-section">
            Settings section
          </label>
          <Select
            value={section}
            onValueChange={(value) =>
              void navigate({ search: { section: value as SettingsSection }, replace: true })
            }
          >
            <SelectTrigger id="settings-section" className="w-full bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SETTINGS_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.items.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="items-start gap-6 lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl border border-border/80 bg-card p-3 shadow-sm lg:block">
            <nav aria-label="Company setup sections" className="space-y-5">
              {SETTINGS_GROUPS.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <section key={group.label}>
                    <div className="mb-1.5 flex items-center gap-2 px-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      <GroupIcon className="h-3.5 w-3.5" />
                      {group.label}
                    </div>
                    <div className="space-y-0.5">
                      {group.items.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() =>
                            void navigate({ search: { section: item.key }, replace: true })
                          }
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                            section === item.key
                              ? "bg-primary/10 font-semibold text-primary"
                              : "text-foreground/80 hover:bg-muted hover:text-foreground",
                          )}
                          aria-current={section === item.key ? "page" : undefined}
                        >
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {section === item.key ? <ChevronRight className="h-4 w-4" /> : null}
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </nav>
          </aside>

          <main className="mt-5 min-w-0 lg:mt-0">
            <div className="mb-5 border-b border-border/70 pb-4">
              <h2 className="text-xl font-bold tracking-tight">
                {SETTINGS_ITEMS.find((item) => item.key === section)?.label}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {SETTINGS_ITEMS.find((item) => item.key === section)?.description}
              </p>
            </div>
            <SettingsSectionContent section={section} />
          </main>
        </div>
      </div>
    </RequirePermission>
  );
}

function SettingsSectionContent({ section }: { section: SettingsSection }) {
  switch (section) {
    case "org":
      return <OrganisationSettingsPanel />;
    case "numbering":
      return <NumberingSettingsPanel />;
    case "departments":
      return <MasterDataSection collection="departments" title="Departments" />;
    case "locations":
      return <MasterDataSection collection="locations" title="Locations" />;
    case "projects":
      return <ProjectsPanel />;
    case "costCentres":
      return <MasterDataSection collection="costCentres" title="Cost Centres" />;
    case "activityCodes":
      return <MasterDataSection collection="activityCodes" title="Activity Codes" />;
    case "positions":
      return <MasterDataSection collection="positions" title="Positions" />;
    case "grades":
      return <MasterDataSection collection="grades" title="Grades" />;
    case "employmentTypes":
      return <MasterDataSection collection="employmentTypes" title="Employment Types" />;
    case "workingTimes":
      return <MasterDataSection collection="workingTimes" title="Working Times" />;
    case "currencies":
      return <MasterDataSection collection="currencies" title="Currencies" />;
    case "publicHolidays":
      return <MasterDataSection collection="publicHolidays" title="Public Holidays" />;
    case "leavePolicies":
      return <LeavePolicyConfig />;
    case "onboardingTemplates":
      return <OnboardingTemplatesPanel />;
    case "offboardingTemplates":
      return <OffboardingTemplatesPanel />;
    case "interviewTemplates":
      return <InterviewTemplatesPanel />;
    case "performanceTemplates":
      return <PerformanceTemplatesPanel />;
    case "data":
      return <DataManagement />;
  }
}

function MasterDataSection({
  collection,
  title,
}: {
  collection: MasterDataCollection;
  title: string;
}) {
  const currentUser = useCurrentUser();
  const service = useMemo(() => new MasterDataService(), []);

  // Use state with async loading
  const [data, setData] = useState<MasterRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MasterRecord | null>(null);
  const [recordToArchive, setRecordToArchive] = useState<MasterRecord | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const records = await service.listAsync(collection, true);
      setData(records);
    } catch {
      toast.error("Failed to load records");
    } finally {
      setIsLoading(false);
    }
  }, [collection, service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAdd = () => {
    setEditingRecord(null);
    setIsFormOpen(true);
  };

  const handleEdit = (record: MasterRecord) => {
    setEditingRecord(record);
    setIsFormOpen(true);
  };

  const handleArchive = (record: MasterRecord) => {
    setRecordToArchive(record);
  };

  const confirmArchive = async () => {
    if (!recordToArchive) return;
    try {
      await service.archive(collection, recordToArchive.id, currentUser.getActorContext());
      toast.success(`${title} archived`);
      setRecordToArchive(null);
      await refresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : `Could not archive ${title}`);
    }
  };

  const handleRestore = async (record: MasterRecord) => {
    try {
      await service.restore(collection, record.id, currentUser.getActorContext());
      toast.success(`${title} restored`);
      await refresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : `Could not restore ${title}`);
    }
  };

  const handleSave = async (recordData: Partial<MasterRecord>) => {
    try {
      const holidayData = recordData as Partial<HolidayMasterRecord>;
      if (collection === "publicHolidays" && !holidayData.date) {
        throw new Error("Holiday date is required.");
      }
      if (editingRecord) {
        await service.update(
          collection,
          editingRecord.id,
          recordData,
          currentUser.getActorContext(),
        );
        toast.success(`${title} updated`);
      } else {
        const workingDays = Array.isArray(recordData.workingDays)
          ? recordData.workingDays
          : undefined;
        await service.create(
          collection,
          {
            name: recordData.name?.trim() ?? "",
            code: recordData.code?.trim() || undefined,
            description: recordData.description?.trim() || undefined,
            isActive: recordData.isActive !== false,
            orderIndex: recordData.orderIndex ?? data.length,
            ...(collection === "publicHolidays" ? { date: holidayData.date } : {}),
            ...(collection === "workingTimes"
              ? {
                  startTime: recordData.startTime,
                  endTime: recordData.endTime,
                  breakMinutes: recordData.breakMinutes ?? 0,
                  workingDays,
                }
              : {}),
            ...(collection === "currencies"
              ? {
                  symbol: recordData.symbol,
                  decimalPlaces: recordData.decimalPlaces ?? 2,
                }
              : {}),
          },
          currentUser.getActorContext(),
        );
        toast.success(`${title} created`);
      }
      setIsFormOpen(false);
      await refresh();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : `Could not save ${title}`);
    }
  };

  return (
    <>
      <MasterDataTable
        title={title}
        data={data.sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name))}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onArchive={handleArchive}
        onRestore={handleRestore}
        {...(collection === "publicHolidays"
          ? { columns: [{ key: "date", label: "Holiday Date" }] }
          : collection === "workingTimes"
            ? {
                columns: [
                  { key: "startTime", label: "Starts" },
                  { key: "endTime", label: "Ends" },
                  { key: "breakMinutes", label: "Break (minutes)" },
                ],
              }
            : collection === "currencies"
              ? {
                  columns: [
                    { key: "symbol", label: "Symbol" },
                    { key: "decimalPlaces", label: "Decimal places" },
                  ],
                }
              : {})}
      />

      <MasterDataForm
        title={title}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        initialData={editingRecord}
        onSave={handleSave}
      >
        {({ formData, updateField }) =>
          collection === "publicHolidays" ? (
            <div className="grid gap-2">
              <label htmlFor="holiday-date" className="text-sm font-medium">
                Holiday Date
              </label>
              <Input
                id="holiday-date"
                type="date"
                value={(formData as Partial<HolidayMasterRecord>).date || ""}
                onChange={(event) => updateField("date", event.target.value)}
                required
              />
            </div>
          ) : collection === "workingTimes" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label htmlFor="working-start" className="text-sm font-medium">
                  Start Time
                </label>
                <Input
                  id="working-start"
                  type="time"
                  value={formData.startTime?.slice(0, 5) ?? ""}
                  onChange={(event) => updateField("startTime", event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="working-end" className="text-sm font-medium">
                  End Time
                </label>
                <Input
                  id="working-end"
                  type="time"
                  value={formData.endTime?.slice(0, 5) ?? ""}
                  onChange={(event) => updateField("endTime", event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="working-break" className="text-sm font-medium">
                  Break Minutes
                </label>
                <Input
                  id="working-break"
                  type="number"
                  min={0}
                  max={1439}
                  value={formData.breakMinutes ?? 0}
                  onChange={(event) => updateField("breakMinutes", Number(event.target.value))}
                  required
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="working-days" className="text-sm font-medium">
                  Working Days
                </label>
                <Input
                  id="working-days"
                  value={formData.workingDays?.join(", ") ?? ""}
                  onChange={(event) =>
                    updateField(
                      "workingDays",
                      event.target.value
                        .split(",")
                        .map((value) => Number(value.trim()))
                        .filter((value) => Number.isInteger(value)),
                    )
                  }
                  placeholder="0, 1, 2, 3, 4"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Use 0 for Sunday through 6 for Saturday.
                </p>
              </div>
            </div>
          ) : collection === "currencies" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label htmlFor="currency-symbol" className="text-sm font-medium">
                  Symbol
                </label>
                <Input
                  id="currency-symbol"
                  value={formData.symbol ?? ""}
                  onChange={(event) => updateField("symbol", event.target.value)}
                  maxLength={12}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="currency-decimals" className="text-sm font-medium">
                  Decimal Places
                </label>
                <Input
                  id="currency-decimals"
                  type="number"
                  min={0}
                  max={4}
                  value={formData.decimalPlaces ?? 2}
                  onChange={(event) => updateField("decimalPlaces", Number(event.target.value))}
                  required
                />
              </div>
            </div>
          ) : null
        }
      </MasterDataForm>

      <AlertDialog
        open={Boolean(recordToArchive)}
        onOpenChange={(open) => !open && setRecordToArchive(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {recordToArchive?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It will no longer be available for new assignments. VIA HR will stop the action if
              this record is still used by an active employee or project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
