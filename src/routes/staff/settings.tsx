import { useState, useMemo, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Building, Settings2, FileDigit, Database, Download, Users } from "lucide-react";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { UserManagementPanel } from "@/components/settings/user-management-panel";
import { ProjectsPanel } from "@/components/settings/projects-panel";
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

export const Route = createFileRoute("/staff/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const currentUser = useCurrentUser();
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
          title="System Settings & Master Data"
          description="Configure organisation parameters and manage foundational lookup data."
          breadcrumbs={[{ label: "System" }, { label: "Settings" }]}
        />

        <Tabs defaultValue="users" className="w-full">
          <div className="overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
            <TabsList className="inline-flex h-auto p-1 flex-wrap items-center justify-start gap-1 w-full sm:w-auto">
              <TabsTrigger value="users" className="gap-2">
                <Users className="h-4 w-4" /> Users
              </TabsTrigger>
              <TabsTrigger value="org" className="gap-2">
                <Building className="h-4 w-4" /> Organisation
              </TabsTrigger>
              <TabsTrigger value="numbering" className="gap-2">
                <FileDigit className="h-4 w-4" /> Numbering
              </TabsTrigger>
              <TabsTrigger value="departments" className="gap-2">
                <Database className="h-4 w-4" /> Departments
              </TabsTrigger>
              <TabsTrigger value="locations" className="gap-2">
                Locations
              </TabsTrigger>
              <TabsTrigger value="projects" className="gap-2">
                Projects
              </TabsTrigger>
              <TabsTrigger value="costCentres" className="gap-2">
                Cost Centres
              </TabsTrigger>
              <TabsTrigger value="activityCodes" className="gap-2">
                Activity Codes
              </TabsTrigger>
              <TabsTrigger value="positions" className="gap-2">
                Positions
              </TabsTrigger>
              <TabsTrigger value="grades" className="gap-2">
                Grades
              </TabsTrigger>
              <TabsTrigger value="employmentTypes" className="gap-2">
                Employment Types
              </TabsTrigger>
              <TabsTrigger value="workingTimes" className="gap-2">
                Working Times
              </TabsTrigger>
              <TabsTrigger value="currencies" className="gap-2">
                Currencies
              </TabsTrigger>
              <TabsTrigger value="publicHolidays" className="gap-2">
                Public Holidays
              </TabsTrigger>
              <TabsTrigger value="leavePolicies" className="gap-2">
                Leave Policies
              </TabsTrigger>
              <TabsTrigger value="onboardingTemplates" className="gap-2">
                Onboarding Templates
              </TabsTrigger>
              <TabsTrigger value="offboardingTemplates" className="gap-2">
                Offboarding Templates
              </TabsTrigger>
              <TabsTrigger value="interviewTemplates" className="gap-2">
                Interview Scorecards
              </TabsTrigger>
              <TabsTrigger value="performanceTemplates" className="gap-2">
                Performance Templates
              </TabsTrigger>
              <TabsTrigger value="data" className="gap-2">
                <Download className="h-4 w-4" /> Data Management
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="mt-6">
            <TabsContent value="users">
              <UserManagementPanel />
            </TabsContent>

            <TabsContent value="org">
              <OrganisationSettingsPanel />
            </TabsContent>

            <TabsContent value="numbering">
              <NumberingSettingsPanel />
            </TabsContent>

            <TabsContent value="departments">
              <MasterDataSection collection="departments" title="Departments" />
            </TabsContent>

            <TabsContent value="locations">
              <MasterDataSection collection="locations" title="Locations" />
            </TabsContent>

            <TabsContent value="projects">
              <ProjectsPanel />
            </TabsContent>

            <TabsContent value="costCentres">
              <MasterDataSection collection="costCentres" title="Cost Centres" />
            </TabsContent>

            <TabsContent value="activityCodes">
              <MasterDataSection collection="activityCodes" title="Activity Codes" />
            </TabsContent>

            <TabsContent value="positions">
              <MasterDataSection collection="positions" title="Positions" />
            </TabsContent>

            <TabsContent value="grades">
              <MasterDataSection collection="grades" title="Grades" />
            </TabsContent>

            <TabsContent value="employmentTypes">
              <MasterDataSection collection="employmentTypes" title="Employment Types" />
            </TabsContent>

            <TabsContent value="workingTimes">
              <MasterDataSection collection="workingTimes" title="Working Times" />
            </TabsContent>

            <TabsContent value="currencies">
              <MasterDataSection collection="currencies" title="Currencies" />
            </TabsContent>

            <TabsContent value="publicHolidays">
              <MasterDataSection collection="publicHolidays" title="Public Holidays" />
            </TabsContent>

            <TabsContent value="leavePolicies">
              <LeavePolicyConfig />
            </TabsContent>

            <TabsContent value="onboardingTemplates">
              <OnboardingTemplatesPanel />
            </TabsContent>

            <TabsContent value="offboardingTemplates">
              <OffboardingTemplatesPanel />
            </TabsContent>

            <TabsContent value="interviewTemplates">
              <InterviewTemplatesPanel />
            </TabsContent>

            <TabsContent value="performanceTemplates">
              <PerformanceTemplatesPanel />
            </TabsContent>

            <TabsContent value="data">
              <DataManagement />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </RequirePermission>
  );
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
