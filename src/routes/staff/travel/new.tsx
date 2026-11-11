import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { TravelService } from "@/lib/data/travel-service";
import { travelRequestNotes } from "@/lib/data/travel-request-notes";
import { getMasterDataRepository, getProjectRepository } from "@/lib/data/master-data";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { Info, Paperclip } from "lucide-react";
import { SearchablePeopleList } from "@/components/ui/searchable-people-list";

export const Route = createFileRoute("/staff/travel/new")({
  component: NewTravelRequestRoute,
});

function NewTravelRequestRoute() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const travelService = useMemo(() => new TravelService(), []);

  const activeProjects = getProjectRepository()
    .list()
    .filter((p) => p.isActive);
  const activeCostCentres = getMasterDataRepository("costCentres")
    .list()
    .filter((c) => c.isActive);
  const activeCurrencies = getMasterDataRepository("currencies")
    .list()
    .filter((item) => item.isActive && item.code);

  const [purpose, setPurpose] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [projectId, setProjectId] = useState<string>("none");
  const [costCentreId, setCostCentreId] = useState<string>("none");
  const [currency, setCurrency] = useState(
    () =>
      activeCurrencies.find((item) => item.code === "OMR")?.code ?? activeCurrencies[0]?.code ?? "",
  );

  const [estTransport, setEstTransport] = useState<number>(0);
  const [estAccommodation, setEstAccommodation] = useState<number>(0);
  const [estPerDiem, setEstPerDiem] = useState<number>(0);
  const [estOther, setEstOther] = useState<number>(0);
  const [needsCompanyBooking, setNeedsCompanyBooking] = useState<boolean | null>(null);
  const [notes, setNotes] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const total = estTransport + estAccommodation + estPerDiem + estOther;

  const isFormValid = Boolean(
    purpose.trim().length >= 3 &&
    destination.trim().length >= 2 &&
    startDate &&
    endDate &&
    endDate >= startDate &&
    activeCurrencies.some((item) => item.code === currency) &&
    needsCompanyBooking !== null &&
    (!needsCompanyBooking || total > 0),
  );

  const handleSubmit = async () => {
    if (!isFormValid) return;
    setIsSubmitting(true);
    try {
      const actorContext = currentUser.getActorContext();
      await travelService.submitRequest(
        {
          employeeId: currentUser!.employeeId!,
          purpose,
          participants: participantIds.map((employeeId) => ({
            employeeId,
            name: "",
            managerId: "",
            status: "Pending",
          })),
          destination,
          startDate,
          endDate,
          ...(projectId !== "none" ? { projectId } : {}),
          ...(costCentreId !== "none" ? { costCentreId } : {}),
          currency,
          estTransport,
          estAccommodation,
          estPerDiem,
          estOther,
          notes: travelRequestNotes(needsCompanyBooking === true, notes),
        },
        actorContext,
        evidenceFile ?? undefined,
      );
      toast.success("Travel request sent for approval");
      navigate({ to: "/staff/travel" });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Travel request could not be sent.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RequirePermission permission="travel:request_self" resourceName="New Travel Request">
      <div className="flex flex-col gap-6 max-w-[800px] mx-auto pb-10">
        <PageHeader
          title="New Travel Request"
          description="Tell us where you are going and what you need."
        />

        <Alert className="bg-blue-50 text-blue-900 border-blue-200">
          <Info className="w-4 h-4 text-blue-600" />
          <AlertTitle>Before you book</AlertTitle>
          <AlertDescription>
            Wait for your trip to be approved. Your request shows who needs to decide next.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Travel Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Business Purpose</label>
              <Input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Annual Client Summit"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Destination</label>
              <Input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="City, Country"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Start Date</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">End Date</label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <details className="rounded-lg border px-3 py-2">
              <summary className="min-h-9 cursor-pointer py-2 font-medium text-primary">
                Add colleagues travelling with you{" "}
                {participantIds.length > 0 ? `(${participantIds.length})` : "(optional)"}
              </summary>
              <SearchablePeopleList
                label="Search colleagues"
                options={currentUser.allEmployees
                  .filter((e) => e.id !== currentUser.employeeId && !e.archivedAt)
                  .map((e) => ({
                    value: e.id,
                    label: e.preferredName,
                    keywords: [e.department ?? ""],
                  }))}
                selected={participantIds}
                onToggle={(id, checked) =>
                  setParticipantIds((ids) =>
                    checked ? [...new Set([...ids, id])] : ids.filter((v) => v !== id),
                  )
                }
              />
            </details>
            <details className="rounded-lg border px-3 py-2">
              <summary className="min-h-9 cursor-pointer py-2 font-medium text-primary">
                Project and cost centre (optional)
              </summary>
              <div className="grid grid-cols-1 gap-4 pb-2 pt-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Project Allocation</label>
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None / Corporate</SelectItem>
                      {activeProjects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Cost Centre</label>
                  <Select value={costCentreId} onValueChange={setCostCentreId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Cost Centre" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No cost centre selected</SelectItem>
                      {activeCostCentres.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </details>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Booking and costs</CardTitle>
            <CardDescription>
              Include what VIA should book or reimburse. Add receipts after the trip.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">
                Will VIA need to arrange a car, flight or hotel? <span aria-hidden="true">*</span>
              </legend>
              <div className="flex flex-wrap gap-3">
                {[true, false].map((answer) => (
                  <label
                    key={String(answer)}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <input
                      type="radio"
                      name="needs-company-booking"
                      required
                      checked={needsCompanyBooking === answer}
                      onChange={() => {
                        setNeedsCompanyBooking(answer);
                      }}
                    />
                    {answer ? "Yes, VIA will arrange it" : "No, no booking needed"}
                  </label>
                ))}
              </div>
            </fieldset>

            {needsCompanyBooking !== null && (
              <details
                key={String(needsCompanyBooking)}
                open={needsCompanyBooking || undefined}
                className="rounded-lg border p-4"
              >
                <summary className="min-h-9 cursor-pointer font-medium text-primary">
                  Estimated trip costs{" "}
                  {needsCompanyBooking ? "(required)" : "(if you will claim expenses)"}
                  {total > 0 ? ` · ${total.toLocaleString()} ${currency}` : ""}
                </summary>
                <div className="space-y-4 pt-3">
                  <p className="text-sm text-muted-foreground">
                    Include all costs you expect VIA to book or reimburse. Finance checks your
                    receipts against this estimate after the trip.
                  </p>
                  <div className="max-w-[200px] space-y-2">
                    <label className="text-sm font-medium">Currency</label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {activeCurrencies.map((item) => (
                          <SelectItem key={item.id} value={item.code!}>
                            {item.code} {item.symbol ? `(${item.symbol})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Transport (Flights, Train, etc)</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={estTransport || ""}
                        onChange={(e) => setEstTransport(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Accommodation</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={estAccommodation || ""}
                        onChange={(e) => setEstAccommodation(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Per Diem / Meals</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={estPerDiem || ""}
                        onChange={(e) => setEstPerDiem(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Other Costs</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={estOther || ""}
                        onChange={(e) => setEstOther(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t flex justify-between items-center mt-4">
                    <span className="text-lg font-medium">Estimated trip costs:</span>
                    <span className="text-2xl font-bold">
                      {total.toLocaleString()} {currency}
                    </span>
                  </div>
                </div>
              </details>
            )}
            {needsCompanyBooking && total <= 0 && (
              <p className="text-sm text-destructive" role="status">
                Add an estimated amount before sending this for approval.
              </p>
            )}

            <details className="rounded-lg border px-3 py-2">
              <summary className="min-h-9 cursor-pointer py-2 font-medium text-primary">
                Supporting notes and files (optional)
              </summary>
              <div className="space-y-4 pb-2 pt-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Supporting Notes</label>
                  <Textarea
                    placeholder="Any links to intended flights, conference details, etc..."
                    value={notes}
                    maxLength={3900}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-1 text-sm font-medium">
                    <Paperclip className="h-3.5 w-3.5" /> Supporting Evidence (PDF or image, up to
                    10 MB)
                  </label>
                  <Input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (file && file.size > 10 * 1024 * 1024) {
                        toast.error("Supporting evidence must be 10 MB or smaller.");
                        e.currentTarget.value = "";
                        setEvidenceFile(null);
                        return;
                      }
                      setEvidenceFile(file);
                    }}
                  />
                </div>
              </div>
            </details>
          </CardContent>
          <CardFooter className="flex justify-between bg-muted/20 border-t py-4">
            <Button variant="outline" onClick={() => navigate({ to: "/staff/travel" })}>
              Cancel
            </Button>
            <Button onClick={() => handleSubmit()} disabled={!isFormValid || isSubmitting}>
              {isSubmitting ? "Submitting..." : "Send for Approval"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </RequirePermission>
  );
}
