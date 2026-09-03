import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { AssetService } from "@/lib/data/asset-service";
import { useCurrentUser } from "@/lib/auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { Plus, Laptop } from "lucide-react";
import type { AssetType, AssetCondition } from "@/lib/data/asset-types";

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
  assetTag: z.string().min(2, "Asset tag or serial number is required"),
  description: z.string().min(1, "Description is required"),
  assignedDate: z.string().min(1),
  conditionAtAssignment: z.enum(["New", "Good", "Fair", "Damaged"]),
});

const returnSchema = z.object({
  returnCondition: z.enum(["New", "Good", "Fair", "Damaged"]),
  notes: z.string().optional(),
});

export function EquipmentTab({ employeeId }: { employeeId: string }) {
  const { can, activeRole, getActorContext } = useCurrentUser();
  const [assetService] = useState(() => new AssetService());
  const [, setRefresh] = useState(0);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [returningId, setReturningId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to assign asset");
    }
  };

  const onReturn = async (values: z.infer<typeof returnSchema>) => {
    if (!returningId) return;
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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to record return");
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
            <Dialog open={isAssignOpen} onOpenChange={setIsAssignOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-2" /> Assign Asset
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign Equipment</DialogTitle>
                </DialogHeader>
                <Form {...assignForm}>
                  <form onSubmit={assignForm.handleSubmit(onAssign)} className="space-y-4">
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
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={assignForm.control}
                        name="assignedDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Assigned Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
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
                    </div>
                    <DialogFooter>
                      <Button type="submit">Assign</Button>
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
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {a.status === "Assigned" && (
                          <Dialog
                            open={returningId === a.id}
                            onOpenChange={(o) => setReturningId(o ? a.id : null)}
                          >
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline">
                                Return
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Record Asset Return</DialogTitle>
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
                                    <Button type="submit">Confirm Return</Button>
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
