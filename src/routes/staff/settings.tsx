/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Building, Settings2, FileDigit, Database, Download, Users } from "lucide-react";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getMasterDataRepository,
  getProjectRepository,
  type MasterDataCollection,
} from "@/lib/data/master-data";
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
              <TabsTrigger value="positions" className="gap-2">
                Positions
              </TabsTrigger>
              <TabsTrigger value="grades" className="gap-2">
                Grades
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

            <TabsContent value="positions">
              <MasterDataSection collection="positions" title="Positions" />
            </TabsContent>

            <TabsContent value="grades">
              <MasterDataSection collection="grades" title="Grades" />
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
  const { currentUser, activeRole } = useCurrentUser();
  const repo = useMemo(() => getMasterDataRepository(collection), [collection]);

  const currentActor = currentUser
    ? {
        userId: currentUser.id,
        employeeId: currentUser.employeeId,
        displayName: currentUser.displayName,
        roles: currentUser.roles,
        activeRole,
      }
    : { userId: "system", displayName: "System", roles: [] };

  // Use state to force re-renders when data changes
  const [data, setData] = useState<MasterRecord[]>(() => repo.list({ includeArchived: true }));
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MasterRecord | null>(null);

  const refresh = () => setData(repo.list({ includeArchived: true }));

  const handleAdd = () => {
    setEditingRecord(null);
    setIsFormOpen(true);
  };

  const handleEdit = (record: MasterRecord) => {
    setEditingRecord(record);
    setIsFormOpen(true);
  };

  const handleArchive = (record: MasterRecord) => {
    // In a real app, we'd check dependencies here (e.g. "is this department assigned to active employees?")
    if (
      confirm(
        `Are you sure you want to archive ${record.name}? It will no longer be available for new assignments.`,
      )
    ) {
      try {
        repo.archive(record.id, { actor: currentActor as any });
        toast.success(`${title} archived`);
        refresh();
      } catch (e: any) {
        toast.error(e.message);
      }
    }
  };

  const handleRestore = (record: MasterRecord) => {
    try {
      repo.restore(record.id, { actor: currentActor as any });
      toast.success(`${title} restored`);
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleSave = (recordData: Partial<MasterRecord>) => {
    try {
      if (collection === "publicHolidays" && !(recordData as any).date) {
        throw new Error("Holiday date is required.");
      }
      if (editingRecord) {
        repo.update(editingRecord.id, recordData, { actor: currentActor as any });
        toast.success(`${title} updated`);
      } else {
        repo.create(recordData as any, { actor: currentActor as any });
        toast.success(`${title} created`);
      }
      setIsFormOpen(false);
      refresh();
    } catch (e: any) {
      toast.error(e.message);
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
                value={(formData as any).date || ""}
                onChange={(event) => updateField("date" as any, event.target.value)}
                required
              />
            </div>
          ) : null
        }
      </MasterDataForm>
    </>
  );
}
