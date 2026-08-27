import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { PerformanceService } from "@/lib/data/performance-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { ArrowLeft, CheckCircle2, Lock, Edit2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ReviewSectionInstance } from "@/lib/data/performance-types";
import { AuditViewer } from "@/components/audit-viewer";
import { format } from "date-fns";

export const Route = createFileRoute("/staff/performance/reviews/$reviewId")({
  component: PerformanceReviewDetailRoute,
});

function PerformanceReviewDetailRoute() {
  const { reviewId } = Route.useParams();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();

  const [perfService] = useState(() => new PerformanceService());
  const [empService] = useState(() => new EmployeeService());

  const [review, setReview] = useState(() => perfService.getReviewById(reviewId));
  const [cycle, setCycle] = useState(() =>
    review ? perfService.getCycleById(review.cycleId) : undefined,
  );
  const [template, setTemplate] = useState(() =>
    review ? perfService.getTemplateById(review.templateId) : undefined,
  );

  // Forms
  const [sections, setSections] = useState<ReviewSectionInstance[]>(() =>
    review ? JSON.parse(JSON.stringify(review.sections)) : [],
  );
  const [managerSummary, setManagerSummary] = useState(review?.managerSummaryComment || "");
  const [ackComment, setAckComment] = useState("");
  const [correctReason, setCorrectReason] = useState("");

  if (!review || !cycle || !template) return <div className="p-8">Review not found</div>;

  const employee = empService.getEmployeeRepository().getById(review.employeeId);
  if (!employee) return <div className="p-8">Employee not found</div>;

  const isSelf = currentUser?.employeeId === employee.id;
  const isManager = employee.lineManagerId === currentUser?.employeeId;
  const isHR = currentUser?.roles.includes("HR") || currentUser?.roles.includes("Super Admin");

  // Accounts should not see sensitive info unless it's their own team
  if (currentUser?.roles.includes("Accounts") && !isManager && !isSelf && !isHR) {
    return (
      <div className="p-8 text-center text-rose-600">
        You do not have permission to view this review.
      </div>
    );
  }

  const handleSelfSubmit = () => {
    try {
      const updated = perfService.submitSelfAssessment(review.id, sections, {
        actor: {
          userId: currentUser!.userId,
          displayName: currentUser!.displayName,
          roles: currentUser!.roles,
        },
      });
      setReview(updated);
      toast.success("Self-assessment sent");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleManagerSubmit = () => {
    try {
      const updated = perfService.submitManagerReview(review.id, sections, managerSummary, {
        actor: {
          userId: currentUser!.userId,
          displayName: currentUser!.displayName,
          roles: currentUser!.roles,
        },
      });
      setReview(updated);
      toast.success("Manager review sent");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleAcknowledge = () => {
    try {
      const updated = perfService.acknowledgeReview(review.id, ackComment, {
        actor: {
          userId: currentUser!.userId,
          displayName: currentUser!.displayName,
          roles: currentUser!.roles,
        },
      });
      setReview(updated);
      toast.success("Review acknowledged");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleApproveModeration = () => {
    try {
      const updated = perfService.approveModeration(review.id, {
        actor: {
          userId: currentUser!.userId,
          displayName: currentUser!.displayName,
          roles: currentUser!.roles,
        },
      });
      setReview(updated);
      toast.success("Moderation approved");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleLock = () => {
    try {
      const updated = perfService.lockReview(review.id, {
        actor: {
          userId: currentUser!.userId,
          displayName: currentUser!.displayName,
          roles: currentUser!.roles,
        },
      });
      setReview(updated);
      toast.success("Review locked");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCorrect = () => {
    try {
      const newReview = perfService.correctReview(
        review.id,
        sections,
        managerSummary,
        correctReason,
        {
          actor: {
            userId: currentUser!.userId,
            displayName: currentUser!.displayName,
            roles: currentUser!.roles,
          },
        },
      );
      toast.success("Review corrected. Old record archived.");
      navigate({ to: `/staff/performance/reviews/${newReview.id}`, replace: true });
      window.location.reload();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const updateSelfRating = (sectionIdx: number, itemIdx: number, val: number) => {
    const next = [...sections];
    next[sectionIdx]!.items[itemIdx]!.selfRating = val;
    setSections(next);
  };
  const updateSelfComment = (sectionIdx: number, itemIdx: number, val: string) => {
    const next = [...sections];
    next[sectionIdx]!.items[itemIdx]!.selfComment = val;
    setSections(next);
  };
  const updateManagerRating = (sectionIdx: number, itemIdx: number, val: number) => {
    const next = [...sections];
    next[sectionIdx]!.items[itemIdx]!.managerRating = val;
    setSections(next);
  };
  const updateManagerComment = (sectionIdx: number, itemIdx: number, val: string) => {
    const next = [...sections];
    next[sectionIdx]!.items[itemIdx]!.managerComment = val;
    setSections(next);
  };

  return (
    <div className="flex flex-col gap-6 max-w-[1000px] mx-auto pb-10">
      <div className="flex items-center gap-2 mb-2">
        <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
      </div>

      <PageHeader
        title={`${cycle.name}: ${employee.legalName}`}
        description={`Status: ${review.status} ${review.correctedReason ? "(Corrected)" : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {isHR && review.status === "Acknowledged" && (
              <Button onClick={handleLock} className="bg-emerald-600 hover:bg-emerald-700">
                <Lock className="w-4 h-4 mr-2" /> Lock Review
              </Button>
            )}
            {isHR && review.status === "Locked" && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="border-rose-200 text-rose-700 hover:bg-rose-50"
                  >
                    <Edit2 className="w-4 h-4 mr-2" /> Correct Record
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>Correct Locked Review</DialogTitle>
                    <CardDescription>
                      This will archive the current record and create a new instance with your
                      changes. Both records will be preserved in the audit trail.
                    </CardDescription>
                  </DialogHeader>
                  <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Correction Reason (Required)</label>
                      <Input
                        value={correctReason}
                        onChange={(e) => setCorrectReason(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Override Manager Summary</label>
                      <Textarea
                        value={managerSummary}
                        onChange={(e) => setManagerSummary(e.target.value)}
                      />
                    </div>
                    {/* For MVP correction, they can just edit summary. In full app, we'd render all rating sliders here too */}
                    <p className="text-sm text-muted-foreground italic">
                      Update any fields below, then confirm correction.
                    </p>
                  </div>
                  <div className="flex justify-end pt-4">
                    <Button onClick={handleCorrect} disabled={!correctReason}>
                      Apply Correction
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />

      {(review.overallSelfScore !== undefined || review.overallManagerScore !== undefined) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-4 text-center">
              <div className="text-3xl font-bold">
                {review.overallSelfScore ? review.overallSelfScore.toFixed(1) : "-"}{" "}
                <span className="text-lg text-muted-foreground">/ {template.maxRating}</span>
              </div>
              <div className="text-sm text-muted-foreground mt-1">Self Score</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center bg-muted/20">
              <div className="text-3xl font-bold">
                {review.overallManagerScore ? review.overallManagerScore.toFixed(1) : "-"}{" "}
                <span className="text-lg text-muted-foreground">/ {template.maxRating}</span>
              </div>
              <div className="text-sm text-muted-foreground mt-1">Manager Score</div>
            </CardContent>
          </Card>
        </div>
      )}

      {isHR && review.status === "Moderation Pending" && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4 flex justify-between items-center">
            <div>
              <p className="font-semibold text-amber-800">HR Moderation Required</p>
              <p className="text-sm text-amber-700">
                Please review the manager's ratings and comments before releasing it for discussion.
              </p>
            </div>
            <Button onClick={handleApproveModeration}>Approve & Release</Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-8">
        {sections.map((sec, secIdx) => (
          <div key={sec.templateSectionId} className="space-y-4">
            <h3 className="text-lg font-semibold border-b pb-2 flex justify-between">
              {sec.title}
              <Badge variant="outline">{sec.weight}% Weight</Badge>
            </h3>
            <div className="grid grid-cols-1 gap-4">
              {sec.items.map((item, itemIdx) => (
                <Card key={item.templateItemId}>
                  <CardContent className="p-4 space-y-4">
                    <div className="flex justify-between">
                      <div>
                        <div className="font-medium">{item.title}</div>
                        <div className="text-sm text-muted-foreground">{item.description}</div>
                        {item.evidencePrompt && (
                          <div className="text-xs text-muted-foreground italic mt-1">
                            Evidence requested: {item.evidencePrompt}
                          </div>
                        )}
                      </div>
                      <Badge variant="secondary">{item.weight}% of section</Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                      {/* Self Assessment Column */}
                      <div className="bg-muted/30 p-4 rounded-lg space-y-3">
                        <div className="font-medium text-sm flex justify-between">
                          Self Assessment
                          {review.status !== "Self Assessment Pending" && item.selfRating && (
                            <span>
                              {item.selfRating} / {template.maxRating}
                            </span>
                          )}
                        </div>
                        {isSelf && review.status === "Self Assessment Pending" ? (
                          <>
                            <div className="flex items-center gap-4">
                              <label className="text-xs font-medium">
                                Rating (1-{template.maxRating})
                              </label>
                              <Input
                                type="number"
                                min={1}
                                max={template.maxRating}
                                step={1}
                                className="w-20"
                                value={item.selfRating || ""}
                                onChange={(e) =>
                                  updateSelfRating(secIdx, itemIdx, parseInt(e.target.value))
                                }
                              />
                            </div>
                            <Textarea
                              placeholder="Comments/Evidence..."
                              className="text-sm"
                              value={item.selfComment || ""}
                              onChange={(e) => updateSelfComment(secIdx, itemIdx, e.target.value)}
                            />
                          </>
                        ) : (
                          <div className="text-sm text-muted-foreground">
                            {item.selfComment || (
                              <span className="italic">No comment provided.</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Manager Assessment Column */}
                      <div className="bg-muted/10 border p-4 rounded-lg space-y-3">
                        <div className="font-medium text-sm flex justify-between">
                          Manager Review
                          {review.status !== "Self Assessment Pending" &&
                            review.status !== "Manager Review Pending" &&
                            item.managerRating && (
                              <span>
                                {item.managerRating} / {template.maxRating}
                              </span>
                            )}
                        </div>
                        {(isManager || (isHR && review.status === "Locked")) &&
                        (review.status === "Manager Review Pending" ||
                          review.status === "Locked") ? (
                          <>
                            <div className="flex items-center gap-4">
                              <label className="text-xs font-medium">
                                Rating (1-{template.maxRating})
                              </label>
                              <Input
                                type="number"
                                min={1}
                                max={template.maxRating}
                                step={1}
                                className="w-20"
                                value={item.managerRating || ""}
                                onChange={(e) =>
                                  updateManagerRating(secIdx, itemIdx, parseInt(e.target.value))
                                }
                              />
                            </div>
                            <Textarea
                              placeholder="Comments..."
                              className="text-sm"
                              value={item.managerComment || ""}
                              onChange={(e) =>
                                updateManagerComment(secIdx, itemIdx, e.target.value)
                              }
                            />
                          </>
                        ) : (
                          <div className="text-sm text-muted-foreground">
                            {item.managerComment || <span className="italic">Pending/Hidden</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}

        {/* Manager Summary */}
        {(review.status === "Manager Review Pending" && isManager) ||
        review.managerSummaryComment ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Manager Summary</CardTitle>
            </CardHeader>
            <CardContent>
              {isManager && review.status === "Manager Review Pending" ? (
                <Textarea
                  placeholder="Overall feedback and goals for next period..."
                  value={managerSummary}
                  onChange={(e) => setManagerSummary(e.target.value)}
                />
              ) : (
                <div className="text-sm">{review.managerSummaryComment}</div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Acknowledgement */}
        {review.status === "Discussion Pending" && isSelf && (
          <Card className="border-blue-200 bg-blue-50">
            <CardHeader>
              <CardTitle className="text-lg text-blue-800">Employee Acknowledgement</CardTitle>
              <CardDescription className="text-blue-700">
                Acknowledge that you have received and discussed this review. Acknowledgement does
                not indicate agreement with the contents.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Optional comments regarding the discussion..."
                value={ackComment}
                onChange={(e) => setAckComment(e.target.value)}
              />
              <Button onClick={handleAcknowledge} className="bg-blue-600 hover:bg-blue-700">
                Sign & Acknowledge
              </Button>
            </CardContent>
          </Card>
        )}

        {review.employeeAcknowledgedAt && (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="py-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <div>
                <div className="font-medium text-emerald-800">Acknowledged by Employee</div>
                <div className="text-sm text-emerald-700">
                  {format(new Date(review.employeeAcknowledgedAt), "MMM d, yyyy HH:mm")}
                </div>
                {review.employeeAcknowledgementComment && (
                  <div className="text-sm text-emerald-600 mt-1 italic">
                    "{review.employeeAcknowledgementComment}"
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end pt-4 mb-4">
          {isSelf && review.status === "Self Assessment Pending" && (
            <Button onClick={handleSelfSubmit}>Submit Self Assessment</Button>
          )}
          {isManager && review.status === "Manager Review Pending" && (
            <Button onClick={handleManagerSubmit}>Submit Manager Review</Button>
          )}
        </div>

        <div className="mt-8 min-h-[400px]">
          <AuditViewer entityId={review.id} entityType="performanceReview" />
        </div>
      </div>
    </div>
  );
}
