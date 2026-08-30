import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OfferService } from "@/lib/data/offer-service";
import type { JobOffer, JobOfferStatus } from "@/lib/data/types";
import { useCurrentUser } from "@/lib/auth";
import { toast } from "sonner";
import { FileText, Send, CheckCircle, XCircle } from "lucide-react";
import { VacancyService } from "@/lib/data/vacancy-service";

interface OfferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vacancyId: string;
  candidateId: string;
  onSuccess?: () => void;
}

export function OfferDialog({
  open,
  onOpenChange,
  vacancyId,
  candidateId,
  onSuccess,
}: OfferDialogProps) {
  const currentUser = useCurrentUser();
  const offerService = useMemo(() => new OfferService(), []);

  const [offer, setOffer] = useState<JobOffer | null>(null);

  // Form State
  const [template, setTemplate] = useState("Standard Employment Contract");
  const [position, setPosition] = useState("");
  const [grade, setGrade] = useState("");
  const [salary, setSalary] = useState("0");
  const [currency, setCurrency] = useState("OMR");
  const [allowances, setAllowances] = useState("");
  const [benefits, setBenefits] = useState("");
  const [startDate, setStartDate] = useState("");
  const [probation, setProbation] = useState("6 Months");
  const [location, setLocation] = useState("HQ");
  const [conditions, setConditions] = useState("Subject to reference checks.");
  const [responseDeadline, setResponseDeadline] = useState("");

  const [declineReason, setDeclineReason] = useState("");
  const [isDeclining, setIsDeclining] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canViewComp = currentUser.activeRole === "Super Admin" || currentUser.activeRole === "HR";

  useEffect(() => {
    if (open) {
      const existing = offerService
        .getOffersForCandidate(candidateId, currentUser.getActorContext())
        .find((o) => o.vacancyId === vacancyId);
      if (existing) {
        setOffer(existing);
        setTemplate(existing.template);
        setPosition(existing.position);
        setGrade(existing.grade);
        setSalary(existing.salary.toString());
        setCurrency(existing.currency || "OMR");
        setAllowances(existing.allowances);
        setBenefits(existing.benefits);
        setStartDate(existing.startDate);
        setProbation(existing.probation);
        setLocation(existing.location);
        setConditions(existing.conditions);
        setResponseDeadline(existing.responseDeadline || "");
      } else {
        const vacancy = new VacancyService().getVacancyRepository().getById(vacancyId);
        setOffer(null);
        setPosition(vacancy?.position || vacancy?.title || "");
        setGrade(vacancy?.grade || "");
        setLocation(vacancy?.location || "");
        setStartDate(vacancy?.targetStartDate || "");
        setSalary(vacancy?.salaryRange?.min?.toString() || "0");
        setCurrency(vacancy?.salaryRange?.currency || "OMR");
      }
    }
  }, [open, candidateId, vacancyId, offerService]);

  const handleSaveDraft = () => {
    try {
      const payload = {
        candidateId,
        vacancyId,
        template,
        position,
        grade,
        salary: parseFloat(salary) || 0,
        currency,
        allowances,
        benefits,
        startDate,
        probation,
        location,
        conditions,
        responseDeadline,
      };

      if (offer) {
        const updated = offerService.updateOffer(offer.id, payload, {
          ...currentUser.getActorContext(),
          reason: "Updated draft offer details",
        });
        setOffer(updated);
        toast.success("Draft offer updated");
      } else {
        const newOffer = offerService.createOffer(payload, currentUser.getActorContext());
        setOffer(newOffer);
        toast.success("Draft offer created");
      }
      onSuccess?.();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not save the offer");
    }
  };

  const handleGeneratePDF = () => {
    if (!offer) return;
    const content = `
      OFFICIAL JOB OFFER
      ------------------
      Date: ${new Date().toLocaleDateString()}
      Position: ${offer.position}
      Grade: ${offer.grade}
      Location: ${offer.location}
      
      Start Date: ${offer.startDate}
      Probation: ${offer.probation}
      
      COMPENSATION
      ------------
      Base Salary: ${offer.salary.toLocaleString()} ${offer.currency || "OMR"}
      Allowances: ${offer.allowances}
      Benefits: ${offer.benefits}
      
      CONDITIONS
      ----------
      ${offer.conditions}
      
      Please respond by: ${offer.responseDeadline}
    `
      .trim()
      .replace(/^\s+/gm, "");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Job_Offer_${offer.position.replace(/\s+/g, "_")}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Offer document generated");
  };

  const handleStatusChange = async (newStatus: JobOfferStatus, reason?: string) => {
    if (!offer) return;
    setIsSaving(true);
    try {
      const updated = await offerService.transitionOffer(offer.id, newStatus, reason, {
        ...currentUser.getActorContext(),
        reason: reason || `Offer moved to ${newStatus}`,
      });
      setOffer(updated);
      setIsDeclining(false);
      setDeclineReason("");
      toast.success(`Offer marked as ${newStatus}`);
      onSuccess?.();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Could not update the offer");
    } finally {
      setIsSaving(false);
    }
  };

  const isReadOnly = !!offer && offer.status !== "Draft";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row justify-between items-start border-b pb-4">
          <div>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" /> Job Offer Details
            </DialogTitle>
            <DialogDescription>
              Draft and manage the official offer for the candidate.
            </DialogDescription>
          </div>
          {offer && (
            <Badge
              variant={
                offer.status === "Accepted"
                  ? "default"
                  : offer.status === "Declined"
                    ? "destructive"
                    : "secondary"
              }
              className="text-sm px-3 py-1"
            >
              {offer.status}
            </Badge>
          )}
        </DialogHeader>

        <Tabs defaultValue="details" className="mt-4">
          <TabsList>
            <TabsTrigger value="details">Role & Logistics</TabsTrigger>
            <TabsTrigger value="compensation">Compensation & Benefits</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Offer Template</Label>
                <Input
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  disabled={isReadOnly}
                />
              </div>
              <div className="space-y-2">
                <Label>Position Title</Label>
                <Input
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  disabled={isReadOnly}
                />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  disabled={isReadOnly}
                />
              </div>
              <div className="space-y-2">
                <Label>Expected Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={isReadOnly}
                />
              </div>
              <div className="space-y-2">
                <Label>Probation Period</Label>
                <Select value={probation} onValueChange={setProbation} disabled={isReadOnly}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3 Months">3 Months</SelectItem>
                    <SelectItem value="6 Months">6 Months</SelectItem>
                    <SelectItem value="None">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Response Deadline</Label>
                <Input
                  type="date"
                  value={responseDeadline}
                  onChange={(e) => setResponseDeadline(e.target.value)}
                  disabled={isReadOnly}
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Special Conditions</Label>
                <Textarea
                  value={conditions}
                  onChange={(e) => setConditions(e.target.value)}
                  disabled={isReadOnly}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="compensation" className="space-y-4 pt-4">
            {!canViewComp ? (
              <div className="p-8 text-center text-muted-foreground bg-muted/30 rounded-lg">
                You do not have permission to view or edit compensation details.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Job Grade / Band</Label>
                  <Input
                    value={grade}
                    onChange={(e) => setGrade(e.target.value)}
                    disabled={isReadOnly}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Annual Salary (Base)</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={salary}
                      onChange={(e) => setSalary(e.target.value)}
                      disabled={isReadOnly}
                    />
                    <Select value={currency} onValueChange={setCurrency} disabled={isReadOnly}>
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OMR">OMR</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="AED">AED</SelectItem>
                        <SelectItem value="SAR">SAR</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>Allowances</Label>
                  <Textarea
                    value={allowances}
                    onChange={(e) => setAllowances(e.target.value)}
                    disabled={isReadOnly}
                    placeholder="Housing, Transport, etc."
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>Benefits</Label>
                  <Textarea
                    value={benefits}
                    onChange={(e) => setBenefits(e.target.value)}
                    disabled={isReadOnly}
                    placeholder="Health Insurance, Flight Tickets..."
                  />
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="pt-4">
            {offer?.history ? (
              <div className="space-y-4">
                {offer.history.map((h, i) => (
                  <div key={i} className="p-3 bg-muted/20 border rounded-md text-sm">
                    <div className="flex justify-between text-muted-foreground mb-1">
                      <span>
                        {new Date(h.date).toLocaleString()} by {h.actor}
                      </span>
                    </div>
                    <div>
                      <strong>{h.action}</strong>: {h.details}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No history yet.</p>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-6 border-t pt-4 sm:justify-between">
          <div>
            {offer?.status === "Draft" && (
              <Button
                variant="outline"
                disabled={isSaving}
                onClick={() => void handleStatusChange("Pending Approval")}
              >
                Request Approval
              </Button>
            )}
            {offer?.status === "Pending Approval" && canViewComp && (
              <Button
                variant="outline"
                disabled={isSaving}
                className="text-emerald-600"
                onClick={() => void handleStatusChange("Approved")}
              >
                Approve Offer
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {(!offer || offer.status === "Draft") && (
              <Button disabled={isSaving} onClick={handleSaveDraft}>
                {offer ? "Save Draft" : "Create Draft"}
              </Button>
            )}
            {offer?.status === "Approved" && (
              <Button
                disabled={isSaving}
                onClick={() => void handleStatusChange("Ready to Send")}
                className="gap-2"
              >
                <CheckCircle className="h-4 w-4" /> Mark Ready to Send
              </Button>
            )}
            {offer?.status === "Ready to Send" && (
              <Button
                disabled={isSaving}
                onClick={() => void handleStatusChange("Sent")}
                className="gap-2"
              >
                <Send className="h-4 w-4" /> Send Offer
              </Button>
            )}
            {offer?.status === "Sent" && !isDeclining && (
              <>
                <Button
                  variant="outline"
                  disabled={isSaving}
                  onClick={() => void handleStatusChange("Expired")}
                >
                  Mark Expired
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setIsDeclining(true)}
                  className="gap-2"
                >
                  <XCircle className="h-4 w-4" /> Candidate Declined
                </Button>
                <Button
                  disabled={isSaving}
                  className="bg-emerald-600 hover:bg-emerald-700 gap-2"
                  onClick={() => void handleStatusChange("Accepted")}
                >
                  <CheckCircle className="h-4 w-4" /> Accept & Start Onboarding
                </Button>
              </>
            )}
            {offer && ["Approved", "Ready to Send", "Sent", "Accepted"].includes(offer.status) && (
              <Button
                variant="outline"
                disabled={isSaving}
                onClick={handleGeneratePDF}
                className="gap-2"
              >
                <FileText className="h-4 w-4" /> Download Document
              </Button>
            )}
            {offer &&
              !isWithdrawing &&
              ["Draft", "Pending Approval", "Approved", "Ready to Send", "Sent"].includes(
                offer.status,
              ) && (
                <Button variant="ghost" disabled={isSaving} onClick={() => setIsWithdrawing(true)}>
                  Withdraw
                </Button>
              )}
            {isWithdrawing && (
              <div className="flex gap-2 items-center bg-destructive/10 p-2 rounded">
                <Input
                  value={withdrawReason}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                  placeholder="Reason for withdrawing..."
                  className="w-64"
                />
                <Button variant="outline" onClick={() => setIsWithdrawing(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={!withdrawReason.trim() || isSaving}
                  onClick={() => void handleStatusChange("Withdrawn", withdrawReason)}
                >
                  Confirm Withdraw
                </Button>
              </div>
            )}
            {isDeclining && (
              <div className="flex gap-2 items-center bg-destructive/10 p-2 rounded">
                <Input
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Reason for declining..."
                  className="w-64"
                />
                <Button variant="outline" onClick={() => setIsDeclining(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={!declineReason || isSaving}
                  onClick={() => void handleStatusChange("Declined", declineReason)}
                >
                  Confirm Decline
                </Button>
              </div>
            )}
          </div>
        </DialogFooter>
        {offer?.convertedToEmployeeId && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            Onboarding started automatically.{" "}
            <a
              className="font-medium underline"
              href={`/staff/employees/${offer.convertedToEmployeeId}`}
            >
              Open employee record
            </a>
            .
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
