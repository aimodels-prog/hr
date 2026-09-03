import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Lock, MessageSquareText } from "lucide-react";
import { toast } from "sonner";

import { AuditViewer } from "@/components/audit-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { EmployeeService } from "@/lib/data/employee-service";
import { PerformanceService } from "@/lib/data/performance-service";
import type { PerformanceReview, ReviewSectionInstance } from "@/lib/data/performance-types";

export const Route = createFileRoute("/staff/performance/reviews/$reviewId")({
  component: PerformanceReviewDetailRoute,
});

function PerformanceReviewDetailRoute() {
  return (
    <RequirePermission permission="performance:view_self" resourceName="Performance Review">
      <PerformanceReviewPage />
    </RequirePermission>
  );
}

function PerformanceReviewPage() {
  const { reviewId } = Route.useParams();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const context = currentUser.getActorContext();
  const service = useMemo(() => new PerformanceService(), []);
  const employeeService = useMemo(() => new EmployeeService(), []);
  const initialReview = service.getReviewById(reviewId, context);
  const [review, setReview] = useState<PerformanceReview | null>(initialReview);
  const [sections, setSections] = useState<ReviewSectionInstance[]>(() =>
    structuredClone(initialReview?.sections ?? []),
  );
  const [managerSummary, setManagerSummary] = useState(initialReview?.managerSummaryComment ?? "");
  const [developmentPlan, setDevelopmentPlan] = useState(initialReview?.developmentPlan ?? "");
  const [moderationComment, setModerationComment] = useState("");
  const [discussionDate, setDiscussionDate] = useState(new Date().toISOString().slice(0, 10));
  const [discussionNotes, setDiscussionNotes] = useState("");
  const [agrees, setAgrees] = useState<"yes" | "no">("yes");
  const [acknowledgementComment, setAcknowledgementComment] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");

  if (!review)
    return (
      <div className="mx-auto max-w-3xl rounded-xl border p-10 text-center">
        This performance review was not found or is not available to you.
      </div>
    );
  const cycle = service.getCycleById(review.cycleId, context);
  const template = service.getTemplateById(review.templateId, context);
  const employee = employeeService.getById(review.employeeId, context);
  if (!cycle || !template || !employee)
    return (
      <div className="mx-auto max-w-3xl rounded-xl border p-10 text-center">
        The review details could not be loaded.
      </div>
    );

  const isEmployee =
    currentUser.activeRole === "Employee" && currentUser.employeeId === review.employeeId;
  const isManager =
    currentUser.activeRole === "Line Manager" && currentUser.employeeId === employee.lineManagerId;
  const isHr = currentUser.activeRole === "HR" || currentUser.activeRole === "Super Admin";
  const showManagerAssessment =
    !isEmployee ||
    template.employeeCanSeeManagerRatings ||
    ["Acknowledgement Pending", "Acknowledged", "Locked", "Corrected"].includes(review.status);
  const updateItem = (
    sectionIndex: number,
    itemIndex: number,
    field: "selfRating" | "selfComment" | "managerRating" | "managerComment",
    value: number | string,
  ) =>
    setSections((current) =>
      current.map((section, currentSection) =>
        currentSection !== sectionIndex
          ? section
          : {
              ...section,
              items: section.items.map((item, currentItem) =>
                currentItem !== itemIndex ? item : { ...item, [field]: value },
              ),
            },
      ),
    );
  const act = async (action: () => Promise<PerformanceReview>, message: string) => {
    try {
      const updated = await action();
      setReview(updated);
      setSections(structuredClone(updated.sections));
      setManagerSummary(updated.managerSummaryComment ?? "");
      setDevelopmentPlan(updated.developmentPlan ?? "");
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The review could not be updated.");
    }
  };

  return (
    <div className="mx-auto max-w-[1050px] space-y-6 pb-10">
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          navigate({
            to: isManager
              ? "/staff/performance/team"
              : isHr
                ? "/staff/performance/cycles"
                : "/staff/me/performance",
          })
        }
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>
      <PageHeader
        title={`${employee.preferredName || employee.legalName} · ${cycle.name}`}
        description="A structured record of objectives, feedback, discussion and acknowledgement."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
            <Badge className="mt-2" variant="outline">
              {review.status}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Self score</p>
            <p className="mt-1 text-2xl font-semibold">
              {review.overallSelfScore?.toFixed(1) ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Supervisor score
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {showManagerAssessment && review.overallManagerScore !== undefined
                ? review.overallManagerScore.toFixed(1)
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {sections.map((section, sectionIndex) => (
        <Card key={section.templateSectionId}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{section.title}</CardTitle>
              <Badge variant="secondary">{section.weight}%</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {section.items.map((item, itemIndex) => (
              <div key={item.templateItemId} className="rounded-xl border p-4">
                <div className="mb-4">
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                  {item.evidencePrompt && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Evidence to consider: {item.evidencePrompt}
                    </p>
                  )}
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Employee rating (1–{template.maxRating})</Label>
                    <Input
                      type="number"
                      min={1}
                      max={template.maxRating}
                      disabled={!isEmployee || review.status !== "Self Assessment Pending"}
                      value={item.selfRating ?? ""}
                      onChange={(event) =>
                        updateItem(
                          sectionIndex,
                          itemIndex,
                          "selfRating",
                          Number(event.target.value),
                        )
                      }
                    />
                    <Textarea
                      disabled={!isEmployee || review.status !== "Self Assessment Pending"}
                      value={item.selfComment ?? ""}
                      onChange={(event) =>
                        updateItem(sectionIndex, itemIndex, "selfComment", event.target.value)
                      }
                      placeholder="Describe results and evidence"
                    />
                  </div>
                  {showManagerAssessment && (
                    <div className="space-y-2">
                      <Label>Supervisor rating (1–{template.maxRating})</Label>
                      <Input
                        type="number"
                        min={1}
                        max={template.maxRating}
                        disabled={!isManager || review.status !== "Manager Review Pending"}
                        value={item.managerRating ?? ""}
                        onChange={(event) =>
                          updateItem(
                            sectionIndex,
                            itemIndex,
                            "managerRating",
                            Number(event.target.value),
                          )
                        }
                      />
                      <Textarea
                        disabled={!isManager || review.status !== "Manager Review Pending"}
                        value={item.managerComment ?? ""}
                        onChange={(event) =>
                          updateItem(sectionIndex, itemIndex, "managerComment", event.target.value)
                        }
                        placeholder="Give specific, constructive feedback"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {isEmployee && review.status === "Self Assessment Pending" && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div>
              <p className="font-medium">Ready to send your assessment?</p>
              <p className="text-sm text-muted-foreground">
                All ratings and comments are required.
              </p>
            </div>
            <Button
              onClick={() =>
                void act(
                  () => service.submitSelfAssessmentAsync(review.id, sections, context),
                  "Self-assessment sent to your supervisor",
                )
              }
            >
              Submit self-assessment
            </Button>
          </CardContent>
        </Card>
      )}
      {(isManager || managerSummary || developmentPlan) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Supervisor summary and development plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Overall summary</Label>
              <Textarea
                disabled={!isManager || review.status !== "Manager Review Pending"}
                value={managerSummary}
                onChange={(event) => setManagerSummary(event.target.value)}
                placeholder="Summarise performance, strengths and priorities"
              />
            </div>
            <div className="space-y-2">
              <Label>Development plan</Label>
              <Textarea
                disabled={!isManager || review.status !== "Manager Review Pending"}
                value={developmentPlan}
                onChange={(event) => setDevelopmentPlan(event.target.value)}
                placeholder="Record development actions, support and expected timing"
              />
            </div>
            {isManager && review.status === "Manager Review Pending" && (
              <div className="flex justify-end">
                <Button
                  onClick={() =>
                    void act(
                      () =>
                        service.submitManagerReviewAsync(
                          review.id,
                          sections,
                          managerSummary,
                          developmentPlan,
                          context,
                        ),
                      "Supervisor assessment submitted",
                    )
                  }
                >
                  Submit supervisor assessment
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {isHr && review.status === "Moderation Pending" && (
        <ActionCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          title="HR moderation"
          description="Review scoring consistency and record the moderation outcome."
        >
          <Textarea
            value={moderationComment}
            onChange={(event) => setModerationComment(event.target.value)}
            placeholder="Moderation outcome and any calibration decision"
          />
          <Button
            onClick={() =>
              void act(
                () => service.approveModerationAsync(review.id, moderationComment, context),
                "Moderation completed",
              )
            }
          >
            Complete moderation
          </Button>
        </ActionCard>
      )}
      {isManager && review.status === "Discussion Pending" && (
        <ActionCard
          icon={<MessageSquareText className="h-5 w-5" />}
          title="Record the review discussion"
          description="Record when the conversation happened and the key points agreed."
        >
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="discussion-date">Discussion date</Label>
              <Input
                id="discussion-date"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={discussionDate}
                onChange={(event) => setDiscussionDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="discussion-notes">Discussion notes</Label>
              <Textarea
                id="discussion-notes"
                value={discussionNotes}
                onChange={(event) => setDiscussionNotes(event.target.value)}
              />
            </div>
          </div>
          <Button
            onClick={() =>
              void act(
                () =>
                  service.recordDiscussionAsync(
                    review.id,
                    discussionDate,
                    discussionNotes,
                    context,
                  ),
                "Discussion recorded; employee acknowledgement requested",
              )
            }
          >
            Record discussion
          </Button>
        </ActionCard>
      )}
      {review.discussionNotes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Review discussion</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{review.discussionNotes}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              Held{" "}
              {review.discussionHeldAt
                ? new Date(review.discussionHeldAt).toLocaleDateString()
                : "—"}
            </p>
          </CardContent>
        </Card>
      )}
      {isEmployee && review.status === "Acknowledgement Pending" && (
        <ActionCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          title="Acknowledge your review"
          description="Acknowledgement confirms receipt; you may record that you do not agree."
        >
          <RadioGroup value={agrees} onValueChange={(value) => setAgrees(value as "yes" | "no")}>
            <label className="flex items-center gap-2">
              <RadioGroupItem value="yes" />I agree with the review
            </label>
            <label className="flex items-center gap-2">
              <RadioGroupItem value="no" />I do not agree with the review
            </label>
          </RadioGroup>
          <Textarea
            value={acknowledgementComment}
            onChange={(event) => setAcknowledgementComment(event.target.value)}
            placeholder={agrees === "no" ? "Explain your concern" : "Optional comment"}
          />
          <Button
            onClick={() =>
              void act(
                () =>
                  service.acknowledgeReviewAsync(
                    review.id,
                    agrees === "yes",
                    acknowledgementComment || undefined,
                    context,
                  ),
                "Review acknowledged",
              )
            }
          >
            Submit acknowledgement
          </Button>
        </ActionCard>
      )}
      {review.employeeAcknowledgedAt && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Employee acknowledgement</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={review.employeeAgreesWithReview ? "secondary" : "destructive"}>
              {review.employeeAgreesWithReview ? "Agreed" : "Did not agree"}
            </Badge>
            {review.employeeAcknowledgementComment && (
              <p className="mt-3 text-sm">{review.employeeAcknowledgementComment}</p>
            )}
          </CardContent>
        </Card>
      )}
      {isHr && review.status === "Acknowledged" && (
        <ActionCard
          icon={<Lock className="h-5 w-5" />}
          title="Finalise this review"
          description="Lock the acknowledged review as the official record."
        >
          <Button
            onClick={() =>
              void act(
                () => service.lockReviewAsync(review.id, context),
                "Review finalised and locked",
              )
            }
          >
            Finalise and lock
          </Button>
        </ActionCard>
      )}
      {isHr && review.status === "Locked" && (
        <ActionCard
          icon={<Lock className="h-5 w-5" />}
          title="Correct a locked review"
          description="A correction preserves this record and creates a linked corrected version."
        >
          <Textarea
            value={correctionReason}
            onChange={(event) => setCorrectionReason(event.target.value)}
            placeholder="Detailed reason for the correction"
          />
          <Button
            variant="outline"
            onClick={() => {
              void service
                .correctReviewAsync(
                  review.id,
                  sections,
                  managerSummary,
                  developmentPlan,
                  correctionReason,
                  context,
                )
                .then((corrected) => {
                  toast.success("Corrected review created");
                  navigate({ to: `/staff/performance/reviews/${corrected.id}`, replace: true });
                  setReview(corrected);
                })
                .catch((error) => {
                  toast.error(
                    error instanceof Error ? error.message : "The correction could not be saved.",
                  );
                });
            }}
          >
            Create corrected record
          </Button>
        </ActionCard>
      )}
      <AuditViewer entityType="performance-review" entityId={review.id} />
    </div>
  );
}

function ActionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {icon}
          {title}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
