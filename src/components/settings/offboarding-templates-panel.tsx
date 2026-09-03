import { useCallback, useEffect, useState } from "react";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { OffboardingService } from "@/lib/data/offboarding-service";
import type {
  OffboardingTemplate,
  OffboardingTemplateTask,
  OffboardingTaskGroup,
} from "@/lib/data/offboarding-types";
import type { Role } from "@/lib/data/types";

const GROUPS: OffboardingTaskGroup[] = [
  "Manager Handover",
  "Project Reassignment",
  "IT & Assets",
  "Access & Security",
  "Visa & Work Permit Cancellation",
  "Leave & Attendance Reconciliation",
  "Expenses & Advances",
  "Final Payroll Input",
  "Exit Interview",
  "Service Documents",
];
const OWNERS: Role[] = ["Employee", "Line Manager", "HR", "Accounts", "IT", "Super Admin"];
const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function OffboardingTemplatesPanel({ onChanged }: { onChanged?: () => void }) {
  const currentUser = useCurrentUser();
  const [service] = useState(() => new OffboardingService());
  const [employeeService] = useState(() => new EmployeeService());
  const [templates, setTemplates] = useState(() =>
    service.getTemplates(currentUser.getActorContext()),
  );
  const [editing, setEditing] = useState<OffboardingTemplate | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<OffboardingTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const users = employeeService
    .getUsers(currentUser.getActorContext())
    .filter((user) => user.status === "Active");
  const refresh = useCallback(() => {
    setTemplates(service.getTemplates(currentUser.getActorContext()));
    onChanged?.();
  }, [currentUser, onChanged, service]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      employeeService.hydrateCompatibilityCache(currentUser.getActorContext()),
      service.hydrateCompatibilityCache(currentUser.getActorContext()),
    ])
      .then(() => {
        if (active) refresh();
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Checklists could not be loaded."),
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser, employeeService, refresh, service]);
  const blankTemplate = (): OffboardingTemplate => {
    const now = new Date().toISOString();
    return {
      id: newId(),
      name: "",
      description: "",
      isActive: true,
      departments: [],
      employmentTypes: [],
      tasks: [],
      createdAt: now,
      createdBy: currentUser.userId,
      updatedAt: now,
      updatedBy: currentUser.userId,
      recordVersion: 1,
    };
  };
  const blankTask = (): OffboardingTemplateTask => ({
    id: newId(),
    title: "",
    group: "IT & Assets",
    ownerRole: "HR",
    offsetDaysFromLastWorkingDate: 0,
    isMandatory: true,
    requiresEvidence: false,
    dependsOnTaskIds: [],
  });
  const updateTask = (taskId: string, changes: Partial<OffboardingTemplateTask>) =>
    setEditing((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === taskId ? { ...task, ...changes } : task,
            ),
          }
        : current,
    );

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await service.saveTemplateAsync(editing, {
        ...currentUser.getActorContext(),
        reason: "Saved offboarding clearance template",
      });
      toast.success("Clearance template saved");
      setEditing(null);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Template could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  const archive = async () => {
    if (!archiveTarget) return;
    try {
      await service.archiveTemplateAsync(
        archiveTarget.id,
        "Archived offboarding clearance template",
        currentUser.getActorContext(),
      );
      toast.success("Clearance template archived");
      setArchiveTarget(null);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Template could not be archived.");
    }
  };

  return (
    <div className="space-y-6">
      {loading && <p className="text-sm text-muted-foreground">Loading clearance templates...</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Offboarding clearance templates</h2>
          <p className="text-sm text-muted-foreground">
            Set the clearance tasks, owners and timing used when a departing employee's offboarding
            case is started.
          </p>
        </div>
        <Button onClick={() => setEditing(blankTemplate())}>
          <Plus className="h-4 w-4" /> New template
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {templates.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {template.name}
                    <Badge variant={template.isActive ? "default" : "secondary"}>
                      {template.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="mt-1">{template.description}</CardDescription>
                </div>
                <div className="flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${template.name}`}
                    onClick={() => setEditing(structuredClone(template))}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Copy ${template.name}`}
                    onClick={() => {
                      const copy = structuredClone(template);
                      copy.id = newId();
                      copy.name = `${copy.name} Copy`;
                      copy.createdAt = new Date().toISOString();
                      copy.updatedAt = copy.createdAt;
                      copy.recordVersion = 1;
                      copy.tasks = copy.tasks.map((task) => ({
                        ...task,
                        id: newId(),
                        dependsOnTaskIds: [],
                      }));
                      setEditing(copy);
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Archive ${template.name}`}
                    onClick={() => setArchiveTarget(template)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{template.tasks.length} tasks</Badge>
                <Badge variant="outline">
                  {template.tasks.filter((task) => task.isMandatory).length} required
                </Badge>
                <Badge variant="outline">
                  {template.departments.length
                    ? template.departments.join(", ")
                    : "All departments"}
                </Badge>
                <Badge variant="outline">
                  {template.employmentTypes.length
                    ? template.employmentTypes.join(", ")
                    : "All employment types"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {templates.some((template) => template.id === editing?.id)
                ? "Edit clearance template"
                : "Create clearance template"}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Template name">
                  <Input
                    value={editing.name}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  />
                </Field>
                <Field label="Status">
                  <label className="flex h-10 items-center gap-2 rounded-md border px-3">
                    <Checkbox
                      checked={editing.isActive}
                      onCheckedChange={(checked) =>
                        setEditing({ ...editing, isActive: checked === true })
                      }
                    />{" "}
                    Available for new offboarding cases
                  </label>
                </Field>
                <Field label="Description" wide>
                  <Textarea
                    value={editing.description}
                    onChange={(event) =>
                      setEditing({ ...editing, description: event.target.value })
                    }
                  />
                </Field>
              </div>
              <div>
                <h3 className="font-semibold">Who uses this template</h3>
                <p className="mb-3 text-sm text-muted-foreground">
                  Leave a field empty when the template applies to everyone.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <CsvField
                    label="Departments"
                    value={editing.departments}
                    onChange={(departments) => setEditing({ ...editing, departments })}
                  />
                  <CsvField
                    label="Employment types"
                    value={editing.employmentTypes}
                    onChange={(employmentTypes) => setEditing({ ...editing, employmentTypes })}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Clearance tasks</h3>
                    <p className="text-sm text-muted-foreground">
                      Tasks are copied into each employee's offboarding case, due relative to their
                      last working date.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setEditing({ ...editing, tasks: [...editing.tasks, blankTask()] })
                    }
                  >
                    <Plus className="h-4 w-4" /> Add task
                  </Button>
                </div>
                {editing.tasks.length === 0 && (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Add the first clearance task.
                  </div>
                )}
                {editing.tasks.map((task, index) => (
                  <Card key={task.id}>
                    <CardContent className="space-y-4 p-4">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">Task {index + 1}</div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setEditing({
                              ...editing,
                              tasks: editing.tasks
                                .filter((item) => item.id !== task.id)
                                .map((item) => ({
                                  ...item,
                                  dependsOnTaskIds: item.dependsOnTaskIds?.filter(
                                    (id) => id !== task.id,
                                  ),
                                })),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" /> Remove
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Task title" wide>
                          <Input
                            value={task.title}
                            onChange={(event) => updateTask(task.id, { title: event.target.value })}
                          />
                        </Field>
                        <Field label="Group">
                          <Select
                            value={task.group}
                            onValueChange={(value) =>
                              updateTask(task.id, { group: value as OffboardingTaskGroup })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {GROUPS.map((group) => (
                                <SelectItem key={group} value={group}>
                                  {group}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Owner">
                          <Select
                            value={task.ownerRole}
                            onValueChange={(value) =>
                              updateTask(task.id, {
                                ownerRole: value as Role,
                                assignedUserId: undefined,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {OWNERS.map((owner) => (
                                <SelectItem key={owner} value={owner}>
                                  {owner}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Named owner">
                          <Select
                            value={task.assignedUserId || "role"}
                            onValueChange={(value) =>
                              updateTask(task.id, {
                                assignedUserId: value === "role" ? undefined : value,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="role">Anyone with this responsibility</SelectItem>
                              {users
                                .filter((user) => user.roles.includes(task.ownerRole))
                                .map((user) => (
                                  <SelectItem key={user.id} value={user.id}>
                                    {user.displayName}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Due date">
                          <Input
                            type="number"
                            min={-365}
                            max={365}
                            value={task.offsetDaysFromLastWorkingDate}
                            onChange={(event) =>
                              updateTask(task.id, {
                                offsetDaysFromLastWorkingDate: Number(event.target.value),
                              })
                            }
                          />
                          <p className="text-xs text-muted-foreground">
                            Days before (-) or after (+) the last working date
                          </p>
                        </Field>
                        <Field label="Depends on">
                          <Select
                            value={task.dependsOnTaskIds?.[0] || "none"}
                            onValueChange={(value) =>
                              updateTask(task.id, {
                                dependsOnTaskIds: value === "none" ? [] : [value],
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No earlier task</SelectItem>
                              {editing.tasks
                                .filter((item) => item.id !== task.id)
                                .map((item) => (
                                  <SelectItem key={item.id} value={item.id}>
                                    {item.title || "Untitled task"}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Requirements">
                          <div className="flex h-10 flex-wrap items-center gap-4 rounded-md border px-3">
                            <label className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={task.isMandatory}
                                onCheckedChange={(checked) =>
                                  updateTask(task.id, { isMandatory: checked === true })
                                }
                              />{" "}
                              Required
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={task.requiresEvidence}
                                onCheckedChange={(checked) =>
                                  updateTask(task.id, { requiresEvidence: checked === true })
                                }
                              />{" "}
                              Evidence
                            </label>
                          </div>
                        </Field>
                        <Field label="Instructions" wide>
                          <Textarea
                            value={task.instructions || ""}
                            onChange={(event) =>
                              updateTask(task.id, { instructions: event.target.value })
                            }
                          />
                        </Field>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={save}>
              {saving ? "Saving..." : "Save template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this template?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Existing offboarding cases will remain unchanged. This template will no longer be
            available for new cases.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveTarget(null)}>
              Keep template
            </Button>
            <Button variant="destructive" onClick={archive}>
              Archive template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <div className="text-sm font-medium">{label}</div>
      {children}
    </div>
  );
}
function CsvField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <Field label={label}>
      <Input
        value={value.join(", ")}
        onChange={(event) => onChange(list(event.target.value))}
        placeholder="All"
      />
      <p className="text-xs text-muted-foreground">Separate multiple values with commas</p>
    </Field>
  );
}
