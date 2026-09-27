import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AssetService } from "@/lib/data/asset-service";
import { useCurrentUser } from "@/lib/auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Plus, Laptop } from "lucide-react";
import type { AssetType, AssetCondition, AvailableCompanyAsset } from "@/lib/data/asset-types";

const ASSET_TYPES: AssetType[] = [
  "Laptop",
  "Desktop",
  "Monitor",
  "Phone",
  "SIM Card",
  "Access Card",
  "Vehicle",
  "Other",
];
const CONDITIONS: AssetCondition[] = ["New", "Good", "Fair", "Damaged"];

const assignSchema = z.object({
  assetType: z.enum([
    "Laptop",
    "Desktop",
    "Monitor",
    "Phone",
    "SIM Card",
    "Access Card",
    "Vehicle",
    "Other",
  ]),
  assetTag: z.string().trim().min(2, "Asset tag or serial number is required").max(100),
  description: z.string().trim().min(3, "Enter at least 3 characters").max(500),
  assignedDate: z.string().date(),
  conditionAtAssignment: z.enum(["New", "Good", "Fair"]),
});

const returnSchema = z.object({
  returnCondition: z.enum(["New", "Good", "Fair", "Damaged"]),
  notes: z.string().optional(),
});

export function EquipmentTab({ employeeId }: { employeeId: string }) {
  const { id: userId, can, activeRole, getActorContext } = useCurrentUser();
  const [assetService] = useState(() => new AssetService());
  const [, setRefresh] = useState(0);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<AvailableCompanyAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void assetService
      .hydrateCompatibilityCache(getActorContext())
      .then(() => {
        if (active) setRefresh((value) => value + 1);
      })
      .catch((error) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : "Equipment could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeRole, assetService, employeeId, getActorContext]);

  const assets = assetService.getAssignmentsForEmployee(employeeId);
  const active = assets.filter((a) => a.status === "Assigned");

  const canManage = can("employee:manage_all") && ["HR", "Super Admin"].includes(activeRole);
  const available = useQuery({
    queryKey: ["available-equipment", userId, activeRole],
    queryFn: () => assetService.listAvailableAssetsAsync(getActorContext()),
    enabled: canManage && isAssignOpen,
    retry: false,
  });

  const assignForm = useForm<z.infer<typeof assignSchema>>({
    resolver: zodResolver(assignSchema),
    defaultValues: {
      assetType: "Laptop",
      assetTag: "",
      description: "",
      assignedDate: new Date().toISOString().split("T")[0]!,
      conditionAtAssignment: "New",
    },
  });

  const returnForm = useForm<z.infer<typeof returnSchema>>({
    resolver: zodResolver(returnSchema),
    defaultValues: { returnCondition: "Good", notes: "" },
  });

  const onAssign = async (values: z.infer<typeof assignSchema>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await assetService.assignAssetAsync(
        {
          employeeId,
          assetType: values.assetType,
          assetTag: values.assetTag,
          description: values.description,
          assignedDate: values.assignedDate,
          conditionAtAssignment: values.conditionAtAssignment,
        },
        getActorContext(),
      );
      toast.success("Asset assigned");
      setIsAssignOpen(false);
      assignForm.reset();
      setRefresh((r) => r + 1);
      await queryClient.invalidateQueries({ queryKey: ["available-equipment"] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to assign asset");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const onAssignAvailable = async () => {
    if (!selectedAsset || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await assetService.assignAvailableAssetAsync(
        {
          employeeId,
          assetId: selectedAsset.id,
          expectedVersion: selectedAsset.recordVersion,
          assignedDate: assignForm.getValues("assignedDate"),
        },
        getActorContext(),
      );
      toast.success("Equipment reassigned. Previous history kept.");
      setIsAssignOpen(false);
      setSelectedAsset(null);
      assignForm.reset();
      setRefresh((value) => value + 1);
      await queryClient.invalidateQueries({ queryKey: ["available-equipment"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Equipment could not be assigned.");
      setSelectedAsset(null);
      await available.refetch();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  const onReturn = async (values: z.infer<typeof returnSchema>) => {
    if (!returningId || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await assetService.closeAssignmentAsync(
        returningId,
        "Returned",
        values.returnCondition,
        values.notes || undefined,
        getActorContext(),
      );
      toast.success("Asset marked as returned");
      setReturningId(null);
      returnForm.reset();
      setRefresh((r) => r + 1);
      await queryClient.invalidateQueries({ queryKey: ["available-equipment"] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to record return");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {loading && <p className="text-sm text-muted-foreground">Loading assigned equipment...</p>}
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Laptop className="h-4 w-4" /> Equipment & Assets
          </CardTitle>
          {canManage && (
            <Dialog
              open={isAssignOpen}
              onOpenChange={(open) => {
                if (saving) return;
                setIsAssignOpen(open);
                setSelectedAsset(null);
                assignForm.reset();
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" disabled={saving || loading || !!loadError}>
                  <Plus className="w-4 h-4 mr-2" /> Assign Asset
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Assign Equipment</DialogTitle>
                  <DialogDescription>
                    Choose returned equipment or register a new item.
                  </DialogDescription>
                </DialogHeader>
                <Form {...assignForm}>
                  <form
                    onSubmit={(event) => {
                      if (selectedAsset) {
                        event.preventDefault();
                        void onAssignAvailable();
                      } else void assignForm.handleSubmit(onAssign)(event);
                    }}
                    className="space-y-4"
                  >
                    <div className="space-y-2">
                      <Label htmlFor="available-equipment">Equipment</Label>
                      <select
                        id="available-equipment"
                        className="h-10 w-full min-w-0 rounded-md border bg-background px-3"
                        disabled={saving}
                        value={selectedAsset?.id ?? "new"}
                        onChange={(event) =>
                          setSelectedAsset(
                            available.data?.find((item) => item.id === event.target.value) ?? null,
                          )
                        }
                      >
                        <option value="new">Register new equipment</option>
                        {available.data?.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.assetTag} — {item.description}
                          </option>
                        ))}
                      </select>
                      {available.isPending && (
                        <p role="status" className="text-sm text-muted-foreground">
                          Loading available equipment…
                        </p>
                      )}
                      {available.isError && (
                        <p role="alert" className="text-sm">
                          Available equipment could not be loaded.{" "}
                          <Button
                            type="button"
                            variant="link"
                            onClick={() => void available.refetch()}
                          >
                            Retry
                          </Button>
                        </p>
                      )}
                      {available.data?.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No equipment is available for reassignment.
                        </p>
                      )}
                    </div>
                    {selectedAsset ? (
                      <div className="rounded-md border p-3 text-sm">
                        <p className="font-medium break-words">{selectedAsset.description}</p>
                        <p>
                          {selectedAsset.assetType} · {selectedAsset.currentCondition}
                        </p>
                        {selectedAsset.lastReturnedDate && (
                          <p>Returned {selectedAsset.lastReturnedDate}</p>
                        )}
                      </div>
                    ) : (
                      <>
                        <FormField
                          control={assignForm.control}
                          name="assetType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Asset Type</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {ASSET_TYPES.map((t) => (
                                    <SelectItem key={t} value={t}>
                                      {t}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={assignForm.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Description</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g. Dell Latitude 5440" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={assignForm.control}
                          name="assetTag"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Asset Tag / Serial Number</FormLabel>
                              <FormControl>
                                <Input {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={assignForm.control}
                        name="assignedDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Assigned Date</FormLabel>
                            <FormControl>
                              <Input
                                type="date"
                                required
                                disabled={saving}
                                min={selectedAsset?.lastReturnedDate ?? undefined}
                                max={
                                  selectedAsset ? new Date().toISOString().slice(0, 10) : undefined
                                }
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {!selectedAsset && (
                        <FormField
                          control={assignForm.control}
                          name="conditionAtAssignment"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Condition</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {CONDITIONS.filter((c) => c !== "Damaged").map((c) => (
                                    <SelectItem key={c} value={c}>
                                      {c}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </div>
                    <DialogFooter>
                      <Button
                        type="submit"
                        disabled={saving || (selectedAsset !== null && available.isError)}
                      >
                        {saving ? "Assigning…" : "Assign"}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 6 : 5}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No equipment assigned to this employee.
                  </TableCell>
                </TableRow>
              ) : (
                assets.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-sm">{a.assetType}</TableCell>
                    <TableCell className="text-sm">{a.description}</TableCell>
                    <TableCell className="text-sm font-mono text-xs">{a.assetTag || "-"}</TableCell>
                    <TableCell className="text-sm">{a.assignedDate}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          a.status === "Assigned"
                            ? "default"
                            : a.status === "Returned"
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {a.status}
                      </Badge>
                      {a.returnedDate && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {a.returnedDate} · {a.returnCondition}
                        </p>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {a.status === "Assigned" && (
                          <Dialog
                            open={returningId === a.id}
                            onOpenChange={(o) => {
                              if (!saving) {
                                setReturningId(o ? a.id : null);
                                returnForm.reset();
                              }
                            }}
                          >
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline" disabled={saving}>
                                Return
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Record Asset Return</DialogTitle>
                                <DialogDescription>
                                  Undamaged returns become available for reassignment.
                                </DialogDescription>
                              </DialogHeader>
                              <Form {...returnForm}>
                                <form
                                  onSubmit={returnForm.handleSubmit(onReturn)}
                                  className="space-y-4"
                                >
                                  <FormField
                                    control={returnForm.control}
                                    name="returnCondition"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Condition on Return</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                          <FormControl>
                                            <SelectTrigger>
                                              <SelectValue />
                                            </SelectTrigger>
                                          </FormControl>
                                          <SelectContent>
                                            {CONDITIONS.map((c) => (
                                              <SelectItem key={c} value={c}>
                                                {c}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                  <FormField
                                    control={returnForm.control}
                                    name="notes"
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Notes</FormLabel>
                                        <FormControl>
                                          <Textarea {...field} />
                                        </FormControl>
                                        <FormMessage />
                                      </FormItem>
                                    )}
                                  />
                                  <DialogFooter>
                                    <Button type="submit" disabled={saving}>
                                      {saving ? "Saving…" : "Confirm Return"}
                                    </Button>
                                  </DialogFooter>
                                </form>
                              </Form>
                            </DialogContent>
                          </Dialog>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {active.length > 0 && (
            <p className="text-xs text-muted-foreground mt-4">
              {active.length} {active.length === 1 ? "item is" : "items are"} currently assigned.
              Offboarding automatically adds an equipment-return task for these items.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
