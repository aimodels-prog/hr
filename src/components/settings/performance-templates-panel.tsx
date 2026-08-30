import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { PerformanceService } from "@/lib/data/performance-service";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PerformanceTemplatesPanel() {
  const userContext = useCurrentUser();
  const { currentUser, activeRole } = userContext;
  const context = userContext.getActorContext();
  const [perfService] = useState(() => new PerformanceService());
  const [templates, setTemplates] = useState(() => perfService.getTemplates(context));
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [objectiveWeight, setObjectiveWeight] = useState(60);
  const [competencies, setCompetencies] = useState(
    "Collaboration\nQuality and accountability\nCustomer focus",
  );

  const currentActor = currentUser
    ? {
        userId: currentUser.id,
        employeeId: currentUser.employeeId,
        displayName: currentUser.displayName,
        roles: currentUser.roles,
        activeRole,
      }
    : { userId: "system", displayName: "System", roles: [] };

  const refresh = () => setTemplates(perfService.getTemplates(context));

  const deleteTemplate = (id: string) => {
    try {
      perfService.deleteTemplate(id, { actor: currentActor });
      toast.success("Template deleted");
      refresh();
    } catch {
      toast.error("Failed to delete template");
    }
  };

  const createTemplate = () => {
    const competencyItems = competencies
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (
      !name.trim() ||
      !description.trim() ||
      objectiveWeight < 10 ||
      objectiveWeight > 90 ||
      competencyItems.length === 0
    ) {
      toast.error("Complete the template name, description, weighting and competencies.");
      return;
    }
    try {
      perfService.saveTemplate(
        {
          name,
          description,
          isActive: true,
          maxRating: 5,
          employeeCanSeeManagerRatings: true,
          sections: [
            {
              id: crypto.randomUUID(),
              title: "Objectives",
              weight: objectiveWeight,
              items: [
                {
                  id: crypto.randomUUID(),
                  title: "Approved objectives",
                  description:
                    "Assess delivery against approved objectives and supporting evidence.",
                  evidencePrompt: "Refer to objective check-ins and recorded results.",
                  weight: 100,
                },
              ],
            },
            {
              id: crypto.randomUUID(),
              title: "Core behaviours",
              weight: 100 - objectiveWeight,
              items: competencyItems.map((item) => ({
                id: crypto.randomUUID(),
                title: item,
                description: `Assess demonstrated ${item.toLowerCase()} during the review period.`,
                evidencePrompt: "Give a specific example.",
                weight: 100 / competencyItems.length,
              })),
            },
          ],
        },
        context,
      );
      setOpen(false);
      setName("");
      setDescription("");
      refresh();
      toast.success("Performance template created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The template could not be created.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Performance Templates</h3>
          <p className="text-sm text-muted-foreground">
            Manage review templates, sections, rating scales, and weights.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> Create Template
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create performance template</DialogTitle>
            <DialogDescription>
              Define the balance between approved objectives and VIA behaviours.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Template name</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Annual performance review"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Explain when this template should be used."
              />
            </div>
            <div className="space-y-2">
              <Label>Objectives weighting (%)</Label>
              <Input
                type="number"
                min={10}
                max={90}
                value={objectiveWeight}
                onChange={(event) => setObjectiveWeight(Number(event.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Core behaviours will carry the remaining {100 - objectiveWeight}%.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Core behaviours (one per line)</Label>
              <Textarea
                value={competencies}
                onChange={(event) => setCompetencies(event.target.value)}
                rows={5}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createTemplate}>Create template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 gap-6">
        {templates.map((tmpl) => (
          <Card key={tmpl.id}>
            <CardHeader className="pb-3 flex flex-row items-start justify-between bg-muted/20">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  {tmpl.name}
                  {tmpl.isActive ? (
                    <Badge className="bg-emerald-500">Active</Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                </CardTitle>
                <CardDescription className="mt-1">{tmpl.description}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => deleteTemplate(tmpl.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-6">
              <div className="flex gap-4 text-sm">
                <div className="border rounded px-3 py-1 bg-muted/10">
                  <span className="text-muted-foreground mr-2">Max Rating Scale:</span>
                  {tmpl.maxRating}
                </div>
                <div className="border rounded px-3 py-1 bg-muted/10">
                  <span className="text-muted-foreground mr-2">Total Weight:</span>
                  {tmpl.sections.reduce((sum, s) => sum + s.weight, 0)}%
                </div>
              </div>

              {tmpl.sections.map((sec) => (
                <div key={sec.id} className="border rounded-lg overflow-hidden">
                  <div className="bg-muted px-4 py-2 flex justify-between items-center border-b">
                    <span className="font-semibold">{sec.title}</span>
                    <Badge variant="outline">{sec.weight}% Weight</Badge>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Evidence Prompt</TableHead>
                        <TableHead className="text-right">Weight (in Sec)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sec.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.title}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {item.description}
                          </TableCell>
                          <TableCell className="text-sm italic text-muted-foreground">
                            {item.evidencePrompt || "-"}
                          </TableCell>
                          <TableCell className="text-right">{item.weight}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
        {templates.length === 0 && (
          <div className="p-8 text-center border rounded-lg text-muted-foreground">
            No templates found.
          </div>
        )}
      </div>
    </div>
  );
}
