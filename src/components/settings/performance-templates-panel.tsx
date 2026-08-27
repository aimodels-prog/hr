import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { PerformanceService } from "@/lib/data/performance-service";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth";

export function PerformanceTemplatesPanel() {
  const { currentUser, activeRole } = useCurrentUser();
  const [perfService] = useState(() => new PerformanceService());
  const [templates, setTemplates] = useState(() => perfService.getTemplates());

  const currentActor = currentUser
    ? {
        userId: currentUser.id,
        employeeId: currentUser.employeeId,
        displayName: currentUser.displayName,
        roles: currentUser.roles,
        activeRole,
      }
    : { userId: "system", displayName: "System", roles: [] };

  const refresh = () => setTemplates(perfService.getTemplates());

  const deleteTemplate = (id: string) => {
    try {
      perfService.deleteTemplate(id, { actor: currentActor });
      toast.success("Template deleted");
      refresh();
    } catch {
      toast.error("Failed to delete template");
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
        <Button>
          <Plus className="w-4 h-4 mr-2" /> Create Template
        </Button>
      </div>

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
                          <TableCell className="text-sm text-muted-foreground">{item.description}</TableCell>
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
          <div className="p-8 text-center border rounded-lg text-muted-foreground">No templates found.</div>
        )}
      </div>
    </div>
  );
}
