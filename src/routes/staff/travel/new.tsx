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
  const [notes, setNotes] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const total = estTransport + estAccommodation + estPerDiem + estOther;

  const handleSubmit = async () => {
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
          notes,
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

  const isFormValid = Boolean(
    purpose.trim().length >= 3 &&
    destination.trim().length >= 2 &&
    startDate &&
    endDate &&
    endDate >= startDate &&
    activeCurrencies.some((item) => item.code === currency),
  );

  return (
    <RequirePermission permission="travel:request_self" resourceName="New Travel Request">
      <div className="flex flex-col gap-6 max-w-[800px] mx-auto pb-10">
        <PageHeader
          title="New Travel Request"
          description="Complete this form to request approval before you travel."
        />

        <Alert className="bg-blue-50 text-blue-900 border-blue-200">
          <Info className="w-4 h-4 text-blue-600" />
          <AlertTitle>How approval works</AlertTitle>
          <AlertDescription>
            Your supervisor reviews the business need first, followed by HR and Finance. Do not book
            travel until all three reviews are complete. You can then request any car, flight or
            hotel arrangements you need.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Travel Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <details>
              <summary className="cursor-pointer py-2 font-medium">
                Add colleagues travelling with you
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Financial Estimates</CardTitle>
            <CardDescription>
              Provide your best estimate. You will submit actual expenses after the trip.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 max-w-[200px]">
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
              <span className="text-lg font-medium">Total Estimate:</span>
              <span className="text-2xl font-bold">
                {total.toLocaleString()} {currency}
              </span>
            </div>

            <div className="space-y-2 mt-4">
              <label className="text-sm font-medium">Supporting Notes</label>
              <Textarea
                placeholder="Any links to intended flights, conference details, etc..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="space-y-2 mt-4">
              <label className="text-sm font-medium flex items-center gap-1">
                <Paperclip className="w-3.5 h-3.5" /> Supporting Evidence (optional, PDF or image,
                up to 10 MB)
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
