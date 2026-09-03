import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Plus, Trash2, Pencil, Eye, EyeOff } from "lucide-react";
import { ScorecardService } from "@/lib/data/scorecard-service";
import type { InterviewTemplate, ScorecardCriterion } from "@/lib/data/types";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth";
import { CandidateService } from "@/lib/data/candidate-service";

type DraftCriterion = ScorecardCriterion;

function newCriterion(): DraftCriterion {
  return {
    id: `c-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: "",
    description: "",
    requiresEvidence: false,
    weight: 100,
  };
}

export function InterviewTemplatesPanel() {
  const { getActorContext } = useCurrentUser();
  const [scorecardService] = useState(() => new ScorecardService());
  const [templates, setTemplates] = useState(() => scorecardService.getTemplates());

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<InterviewTemplate | null>(null);
  const [name, setName] = useState("");
  const [blindScoring, setBlindScoring] = useState(false);
  const [criteria, setCriteria] = useState<DraftCriterion[]>([newCriterion()]);
  const [vacancyId, setVacancyId] = useState("");
  const [stageName, setStageName] = useState("");
  const [aiDecisionWeight, setAiDecisionWeight] = useState(40);
  const [interviewDecisionWeight, setInterviewDecisionWeight] = useState(60);
  const [deleteTarget, setDeleteTarget] = useState<InterviewTemplate | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = () => setTemplates(scorecardService.getTemplates());

  useEffect(() => {
    let cancelled = false;
    void new CandidateService()
      .hydrateCompatibilityCache(getActorContext())
      .then(() => {
        if (!cancelled) refresh();
      })
      .catch((error: unknown) => {
        if (!cancelled)
          toast.error(
            error instanceof Error ? error.message : "Could not load scorecard templates",
          );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The panel is only mounted inside an authenticated HR settings session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scorecardService]);

  const openCreate = () => {
    setEditingTemplate(null);
    setName("");
    setBlindScoring(false);
    setCriteria([newCriterion()]);
    setVacancyId("");
    setStageName("");
    setAiDecisionWeight(40);
    setInterviewDecisionWeight(60);
    setIsFormOpen(true);
  };

  const openEdit = (tmpl: InterviewTemplate) => {
    setEditingTemplate(tmpl);
    setName(tmpl.name);
    setBlindScoring(tmpl.blindScoring);
    setCriteria(tmpl.criteria.map((c) => ({ ...c })));
    setVacancyId(tmpl.vacancyId || "");
    setStageName(tmpl.stageName || "");
    setAiDecisionWeight(tmpl.aiDecisionWeight ?? 40);
    setInterviewDecisionWeight(tmpl.interviewDecisionWeight ?? 60);
    setIsFormOpen(true);
  };

  const updateCriterion = (id: string, patch: Partial<DraftCriterion>) => {
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const addCriterion = () => setCriteria((prev) => [...prev, newCriterion()]);
  const removeCriterion = (id: string) => setCriteria((prev) => prev.filter((c) => c.id !== id));

  const handleSave = async () => {
    const cleanCriteria = criteria
      .map((c) => ({ ...c, name: c.name.trim(), description: c.description.trim() }))
      .filter((c) => c.name.length > 0);

    try {
      await scorecardService.saveTemplateAsync(
        {
          name: name.trim(),
          blindScoring,
          criteria: cleanCriteria,
          vacancyId: vacancyId || undefined,
          stageName: stageName || undefined,
          aiDecisionWeight,
          interviewDecisionWeight,
        },
        getActorContext(),
        editingTemplate ?? undefined,
      );
      toast.success(editingTemplate ? "Template updated" : "Template created");
      setIsFormOpen(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    }
  };

  const handleDelete = async (tmpl: InterviewTemplate) => {
    try {
      await scorecardService.deleteTemplateAsync(tmpl.id, {
        ...getActorContext(),
        reason: `Archived ${tmpl.name}`,
      });
      toast.success("Template deleted");
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete template");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Interview Scorecard Templates</h3>
          <p className="text-sm text-muted-foreground">
            Define the criteria panelists score candidates against when scheduling an interview.
            Every interview picks one of these templates, so the questions asked here are exactly
            what a panelist sees when they score.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" /> Create Template
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {isLoading && (
          <div className="p-8 text-center border rounded-lg text-muted-foreground">
            Loading scorecard templates…
          </div>
        )}
        {!isLoading &&
          templates.map((tmpl) => (
            <Card key={tmpl.id}>
              <CardHeader className="pb-3 flex flex-row items-start justify-between bg-muted/20">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {tmpl.name}
                    <Badge variant="outline" className="gap-1 font-normal">
                      {tmpl.blindScoring ? (
                        <EyeOff className="h-3 w-3" />
                      ) : (
                        <Eye className="h-3 w-3" />
                      )}
                      {tmpl.blindScoring ? "Blind scoring" : "Open scoring"}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {tmpl.criteria.length} criteria · AI {tmpl.aiDecisionWeight ?? 40}% / interview{" "}
                    {tmpl.interviewDecisionWeight ?? 60}%
                  </CardDescription>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(tmpl)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(tmpl)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  {tmpl.criteria.map((c) => (
                    <div key={c.id} className="border rounded-md p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{c.name}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {c.weight ?? 0}%
                        </Badge>
                        {c.requiresEvidence && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            Evidence required
                          </Badge>
                        )}
                      </div>
                      {c.description && (
                        <p className="text-xs text-muted-foreground mt-1">{c.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        {!isLoading && templates.length === 0 && (
          <div className="p-8 text-center border rounded-lg text-muted-foreground">
            No scorecard templates yet. Interviews cannot be scored until at least one exists.
          </div>
        )}
      </div>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "Edit Template" : "Create Template"}</DialogTitle>
            <DialogDescription>
              Panelists will score every criterion below on a 1-5 scale when they fill out this
              scorecard for an interview.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Template Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Leadership Panel"
                className="mt-1.5"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">Vacancy ID (optional)</label>
                <Input
                  value={vacancyId}
                  onChange={(e) => setVacancyId(e.target.value)}
                  placeholder="Blank applies to all vacancies"
                  className="mt-1.5"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Interview Stage (optional)</label>
                <Input
                  value={stageName}
                  onChange={(e) => setStageName(e.target.value)}
                  placeholder="e.g. Technical Interview"
                  className="mt-1.5"
                />
              </div>
              <div>
                <label className="text-sm font-medium">AI Decision Weight %</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={aiDecisionWeight}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setAiDecisionWeight(value);
                    setInterviewDecisionWeight(100 - value);
                  }}
                  className="mt-1.5"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Interview Decision Weight %</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={interviewDecisionWeight}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setInterviewDecisionWeight(value);
                    setAiDecisionWeight(100 - value);
                  }}
                  className="mt-1.5"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Blind Scoring</p>
                <p className="text-xs text-muted-foreground">
                  Panelists cannot see each other&rsquo;s scores until everyone has submitted.
                </p>
              </div>
              <Switch checked={blindScoring} onCheckedChange={setBlindScoring} />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Criteria</label>
                <Button variant="outline" size="sm" onClick={addCriterion}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Criterion
                </Button>
              </div>

              {criteria.map((c) => (
                <div key={c.id} className="border rounded-md p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <Input
                      value={c.name}
                      onChange={(e) => updateCriterion(c.id, { name: e.target.value })}
                      placeholder="Criterion name, e.g. Problem Solving"
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCriterion(c.id)}
                      disabled={criteria.length === 1}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                  <Textarea
                    value={c.description}
                    onChange={(e) => updateCriterion(c.id, { description: e.target.value })}
                    placeholder="What a panelist should look for when scoring this..."
                    className="text-sm"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-medium">Weight %</label>
                      <Input
                        type="number"
                        min="1"
                        max="100"
                        value={c.weight}
                        onChange={(e) => updateCriterion(c.id, { weight: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium">Minimum Score</label>
                      <Input
                        type="number"
                        min="1"
                        max="5"
                        value={c.minimumScore || ""}
                        onChange={(e) =>
                          updateCriterion(c.id, {
                            minimumScore: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={c.isCritical === true}
                      onCheckedChange={(checked) =>
                        updateCriterion(c.id, { isCritical: checked === true })
                      }
                    />
                    Critical criterion — failing the minimum is flagged in the hiring decision
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={c.requiresEvidence}
                      onCheckedChange={(checked) =>
                        updateCriterion(c.id, { requiresEvidence: checked === true })
                      }
                    />
                    Require written evidence before a panelist can submit a score for this
                  </label>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save Template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this scorecard template?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `“${deleteTarget.name}” will no longer be available for new interviews. Existing interview records remain intact.`
                : "This template will no longer be available for new interviews."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep template</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && void handleDelete(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Archive template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
