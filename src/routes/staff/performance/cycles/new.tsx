import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { PerformanceService } from "@/lib/data/performance-service";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const generateId = () => Math.random().toString(36).substring(2, 9);

export const Route = createFileRoute("/staff/performance/cycles/new")({
  component: NewCycleRoute,
});

function NewCycleRoute() {
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const [perfService] = useState(() => new PerformanceService());
  const templates = perfService.getTemplates().filter((t) => t.isActive);

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [selfDeadline, setSelfDeadline] = useState("");
  const [managerDeadline, setManagerDeadline] = useState("");
  const [discussDeadline, setDiscussDeadline] = useState("");
  const [requiresModeration, setRequiresModeration] = useState(false);

  const handleLaunch = () => {
    if (!name || !templateId || !selfDeadline || !managerDeadline || !discussDeadline) {
      toast.error("Please fill all required fields");
      return;
    }

    try {
      perfService.createCycle(
        {
          id: generateId(),
          name,
          templateId,
          status: "Active", // Auto-launch
          departments: [], // MVP: Launch for all
          employmentTypes: [],
          selfAssessmentDeadline: selfDeadline,
          managerReviewDeadline: managerDeadline,
          discussionDeadline: discussDeadline,
          requiresModeration,
          createdAt: new Date().toISOString(),
          createdBy: currentUser!.userId,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser!.userId,
          recordVersion: 1,
        },
        {
          actor: {
            userId: currentUser!.userId,
            displayName: currentUser!.displayName,
            roles: currentUser!.roles,
          },
        },
      );

      toast.success("Review cycle started");
      navigate({ to: "/staff/performance/cycles" });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <RequirePermission permission="system:settings_manage" resourceName="Performance Cycles">
      <div className="flex flex-col gap-6 max-w-[800px] mx-auto pb-10">
        <div className="flex items-center gap-2 mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: "/staff/performance/cycles" })}
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
        </div>

        <PageHeader
          title="Launch Review Cycle"
          description="Start a review cycle for the employees included in it."
        />

        <Card>
          <CardContent className="pt-6 space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Cycle Name</label>
              <Input
                placeholder="e.g. Q3 2026 Engineering Review"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Template</label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Self Assessment By</label>
                <Input
                  type="date"
                  value={selfDeadline}
                  onChange={(e) => setSelfDeadline(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Manager Review By</label>
                <Input
                  type="date"
                  value={managerDeadline}
                  onChange={(e) => setManagerDeadline(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Discussion/Acknowledge By</label>
                <Input
                  type="date"
                  value={discussDeadline}
                  onChange={(e) => setDiscussDeadline(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Checkbox
                id="mod"
                checked={requiresModeration}
                onCheckedChange={(c) => setRequiresModeration(!!c)}
              />
              <label
                htmlFor="mod"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Require HR Moderation before Discussion
              </label>
            </div>

            <div className="pt-4 flex justify-end">
              <Button onClick={handleLaunch}>Launch Cycle</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </RequirePermission>
  );
}
