import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Archive, ArchiveRestore, Edit2, FolderKanban, Plus } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth";
import { getMasterDataRepository, getProjectRepository } from "@/lib/data/master-data";
import { EmployeeService } from "@/lib/data/employee-service";
import type { Project } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

const projectFormSchema = z
  .object({
    name: z.string().min(1, "Project name is required"),
    code: z.string().optional(),
    client: z.string().optional(),
    type: z.string().optional(),
    location: z.string().optional(),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().optional(),
    costCentreId: z.string().optional(),
    managerId: z.string().optional(),
  })
  .refine((data) => !data.startDate || !data.endDate || data.endDate > data.startDate, {
    message: "End date must be after the start date",
    path: ["endDate"],
  });

type ProjectFormValues = z.infer<typeof projectFormSchema>;

const emptyFormValues: ProjectFormValues = {
  name: "",
  code: "",
  client: "",
  type: "",
  location: "",
  startDate: "",
  endDate: "",
  costCentreId: "",
  managerId: "",
};

export function ProjectsPanel() {
  const { getActorContext } = useCurrentUser();
  const employeeService = useMemo(() => new EmployeeService(), []);

  const repo = useMemo(() => getProjectRepository(), []);
  const [projects, setProjects] = useState<Project[]>(() => repo.list({ includeArchived: true }));

  const locations = useMemo(() => getMasterDataRepository("locations").list(), []);
  const costCentres = useMemo(
    () =>
      getMasterDataRepository("costCentres")
        .list()
        .filter((c) => c.isActive),
    [],
  );
  // Includes archived employees so a project's historical manager still resolves to a name.
  const allEmployees = useMemo(
    () => employeeService.getEmployees(getActorContext(), { includeArchived: true }),
    [employeeService, getActorContext],
  );
  const activeEmployees = useMemo(
    () => allEmployees.filter((e) => e.status !== "Archived"),
    [allEmployees],
  );

  const employeeName = (id?: string) => {
    if (!id) return "-";
    const employee = allEmployees.find((e) => e.id === id);
    return employee ? employee.preferredName : "-";
  };

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: emptyFormValues,
  });

  useEffect(() => {
    if (!isFormOpen) return;
    if (editingProject) {
      form.reset({
        name: editingProject.name,
        code: editingProject.code || "",
        client: editingProject.client || "",
        type: editingProject.type || "",
        location: editingProject.location || "",
        startDate: editingProject.startDate || "",
        endDate: editingProject.endDate || "",
        costCentreId: editingProject.costCentreId || "",
        managerId: editingProject.managerId || "",
      });
    } else {
      form.reset(emptyFormValues);
    }
  }, [isFormOpen, editingProject, form]);

  const refresh = () => setProjects(repo.list({ includeArchived: true }));

  const handleAdd = () => {
    setEditingProject(null);
    setIsFormOpen(true);
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setIsFormOpen(true);
  };

  const handleArchive = (project: Project) => {
    if (
      !confirm(
        `Are you sure you want to archive "${project.name}"? It will no longer be available for new assignments.`,
      )
    ) {
      return;
    }
    try {
      repo.archive(project.id, getActorContext());
      toast.success("Project archived");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to archive project");
    }
  };

  const handleRestore = (project: Project) => {
    try {
      repo.restore(project.id, getActorContext());
      toast.success("Project restored");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to restore project");
    }
  };

  const onSubmit = (values: ProjectFormValues) => {
    try {
      const payload = {
        name: values.name.trim(),
        code: values.code?.trim() || undefined,
        client: values.client?.trim() || undefined,
        type: values.type?.trim() || undefined,
        location: values.location || undefined,
        startDate: values.startDate || undefined,
        endDate: values.endDate || undefined,
        costCentreId: values.costCentreId || undefined,
        managerId: values.managerId || undefined,
      };

      if (editingProject) {
        repo.update(editingProject.id, payload, getActorContext());
        toast.success("Project updated");
      } else {
        repo.create({ ...payload, isActive: true, orderIndex: projects.length }, getActorContext());
        toast.success("Project created");
      }
      setIsFormOpen(false);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save project");
    }
  };

  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <FilterBar>
        <div>
          <h3 className="text-lg font-semibold">Projects</h3>
          <p className="text-sm text-muted-foreground">
            Client engagements and internal projects employees can be assigned to.
          </p>
        </div>
        <Button onClick={handleAdd} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" /> New Project
        </Button>
      </FilterBar>

      {sorted.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create a project to make it available for employee and timesheet assignment."
          action={
            <Button onClick={handleAdd}>
              <Plus className="mr-2 h-4 w-4" /> New Project
            </Button>
          }
        />
      ) : (
        <DataTableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-[100px]">Code</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((project) => (
                <TableRow
                  key={project.id}
                  className={project.archivedAt ? "opacity-60 bg-muted/50" : ""}
                >
                  <TableCell className="font-medium">{project.name}</TableCell>
                  <TableCell>{project.code || "-"}</TableCell>
                  <TableCell>{project.client || "-"}</TableCell>
                  <TableCell>{project.type || "-"}</TableCell>
                  <TableCell>{project.location || "-"}</TableCell>
                  <TableCell>{employeeName(project.managerId)}</TableCell>
                  <TableCell>
                    {project.startDate ? new Date(project.startDate).toLocaleDateString() : "-"}
                  </TableCell>
                  <TableCell>
                    {project.endDate ? new Date(project.endDate).toLocaleDateString() : "-"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={
                        project.archivedAt ? "Archived" : project.isActive ? "Active" : "Inactive"
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(project)}>
                        <Edit2 className="h-4 w-4" />
                        <span className="sr-only">Edit</span>
                      </Button>
                      {project.archivedAt ? (
                        <Button variant="ghost" size="icon" onClick={() => handleRestore(project)}>
                          <ArchiveRestore className="h-4 w-4" />
                          <span className="sr-only">Restore</span>
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleArchive(project)}
                          className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
                        >
                          <Archive className="h-4 w-4" />
                          <span className="sr-only">Archive</span>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DataTableShell>
      )}

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>{editingProject ? "Edit Project" : "New Project"}</DialogTitle>
                <DialogDescription>
                  {editingProject
                    ? "Update the details for this project."
                    : "Create a project that employees and timesheets can be assigned to."}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Project Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Downtown Tower Redevelopment" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. PRJ-014" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="client"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Acme Holdings" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Fixed Price, Retainer" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Location (Optional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {locations.map((l) => (
                            <SelectItem key={l.id} value={l.name}>
                              {l.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="managerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Manager</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Manager (Optional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {activeEmployees.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.preferredName} ({e.position})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="costCentreId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cost Centre</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select Cost Centre (Optional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {costCentres.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save Changes</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
