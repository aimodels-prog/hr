import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { CandidateService } from "@/lib/data/candidate-service";
import { OfferService } from "@/lib/data/offer-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { ConversionService } from "@/lib/data/conversion-service";
import { VacancyService } from "@/lib/data/vacancy-service";
import { AlertTriangle, ArrowLeft, CheckCircle2, UserPlus } from "lucide-react";

export const Route = createFileRoute("/staff/candidates/$candidateId/convert")({
  component: ConversionWizardRoute,
});

function ConversionWizardRoute() {
  const { candidateId } = Route.useParams();
  const navigate = useNavigate();
  const currentUser = useCurrentUser();

  const candidateService = useMemo(() => new CandidateService(), []);
  const offerService = useMemo(() => new OfferService(), []);
  const empService = useMemo(() => new EmployeeService(), []);
  const conversionService = useMemo(() => new ConversionService(), []);
  const vacancyService = useMemo(() => new VacancyService(), []);

  const candidate = candidateService.getCandidate(candidateId, currentUser.getActorContext());
  const offers = offerService.getOffersForCandidate(candidateId, currentUser.getActorContext());
  const acceptedOffer = offers.find((o) => o.status === "Accepted");
  const acceptedVacancy = acceptedOffer
    ? vacancyService.getVacancyRepository().getById(acceptedOffer.vacancyId)
    : null;

  const allEmployees = empService.getEmployees(currentUser.getActorContext());

  const [employeeData, setEmployeeData] = useState({
    employeeNumber: `EMP-${Math.floor(Math.random() * 10000)}`,
    legalName: candidate ? `${candidate.firstName} ${candidate.lastName}` : "",
    preferredName: candidate?.firstName || "",
    workEmail: candidate?.email || "",
    department: acceptedVacancy?.department || "",
    position: acceptedOffer?.position || "",
    grade: acceptedOffer?.grade || "G1",
    location: acceptedOffer?.location || "HQ",
    employmentType: "Full-time",
    startDate: acceptedOffer?.startDate || "",
    probationEndDate: acceptedOffer?.probation || "",
    workspaceEmail: "",
  });

  if (!candidate) return <div className="p-8">Candidate not found.</div>;
  if (candidate.convertedToEmployeeId) {
    return (
      <div className="p-8 text-center max-w-xl mx-auto space-y-4">
        <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto" />
        <h2 className="text-2xl font-bold">Already Converted</h2>
        <p className="text-muted-foreground">
          This candidate has already been converted to an employee.
        </p>
        <Button
          onClick={() => navigate({ to: `/staff/employees/${candidate.convertedToEmployeeId}` })}
        >
          View Employee Profile
        </Button>
      </div>
    );
  }

  if (!acceptedOffer) {
    return (
      <div className="p-8 max-w-xl mx-auto border border-amber-200 bg-amber-50 rounded-lg text-amber-900 mt-10">
        <h3 className="font-bold mb-2 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" /> Conversion Blocked
        </h3>
        <p>
          This candidate does not have an Accepted offer. Only candidates with an officially
          accepted offer can be converted to an employee.
        </p>
        <Button
          variant="outline"
          className="mt-4 bg-white"
          onClick={() => navigate({ to: `/staff/candidates/${candidateId}` })}
        >
          Back to Candidate
        </Button>
      </div>
    );
  }

  // Duplicate Check
  const duplicateName = allEmployees.find(
    (e) => e.legalName.toLowerCase() === employeeData.legalName.toLowerCase(),
  );
  const duplicateEmail = allEmployees.find(
    (e) => e.workEmail.toLowerCase() === employeeData.workEmail.toLowerCase(),
  );
  const hasDuplicateWarning = !!duplicateName || !!duplicateEmail;

  const handleConvert = async () => {
    try {
      if (
        !employeeData.employeeNumber ||
        !employeeData.legalName ||
        !employeeData.workEmail ||
        !employeeData.startDate
      ) {
        toast.error("Please fill all required fields.");
        return;
      }
      const newEmpId = await conversionService.convertCandidateToEmployee(
        candidate.id,
        acceptedOffer.id,
        employeeData,
        currentUser!.getActorContext(),
      );
      toast.success("Employee profile created");
      navigate({ to: "/staff/employees/$employeeId", params: { employeeId: newEmpId } });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <RequirePermission permission="system:settings_manage" resourceName="Convert Candidate">
      <div className="flex flex-col gap-6 max-w-[1000px] mx-auto pb-10">
        <div className="flex items-center gap-2 mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: `/staff/candidates/${candidateId}` })}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Candidate
          </Button>
        </div>

        <PageHeader
          title="Convert Candidate to Employee"
          description={`Verify details and onboard ${candidate.firstName} ${candidate.lastName}.`}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-1 border-emerald-200">
            <CardHeader className="bg-emerald-50/50 pb-4">
              <CardTitle className="text-emerald-900">Offer Facts</CardTitle>
              <CardDescription>Source of truth from accepted offer.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4 text-sm">
              <div>
                <span className="text-muted-foreground block mb-1 text-xs uppercase">Position</span>
                <span className="font-medium">{acceptedOffer.position}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1 text-xs uppercase">
                  Department
                </span>
                <span className="font-medium">{acceptedVacancy?.department || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1 text-xs uppercase">Location</span>
                <span className="font-medium">{acceptedOffer.location}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1 text-xs uppercase">Grade</span>
                <span className="font-medium">{acceptedOffer.grade}</span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1 text-xs uppercase">
                  Agreed Start Date
                </span>
                <span className="font-medium">{acceptedOffer.startDate}</span>
              </div>
              <div className="pt-4 border-t">
                <Badge
                  variant="outline"
                  className="bg-emerald-100 text-emerald-800 border-emerald-300"
                >
                  Offer Accepted: {acceptedOffer.updatedAt.split("T")[0]}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Employee Creation Profile</CardTitle>
              <CardDescription>
                Review and finalize the internal HR profile attributes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {hasDuplicateWarning && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-md text-amber-900 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <div className="text-sm">
                    <strong>Duplicate Warning:</strong> A potential duplicate employee was found.
                    {duplicateName && (
                      <div>
                        • Name match: {duplicateName.legalName} ({duplicateName.employeeNumber})
                      </div>
                    )}
                    {duplicateEmail && (
                      <div>
                        • Email match: {duplicateEmail.workEmail} ({duplicateEmail.employeeNumber})
                      </div>
                    )}
                    Verify carefully before converting to prevent ghost records.
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <label className="font-medium text-xs uppercase text-muted-foreground">
                    Employee ID / Number <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={employeeData.employeeNumber}
                    onChange={(e) =>
                      setEmployeeData({ ...employeeData, employeeNumber: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-xs uppercase text-muted-foreground">
                    Employment Type <span className="text-destructive">*</span>
                  </label>
                  <Select
                    value={employeeData.employmentType}
                    onValueChange={(v) => setEmployeeData({ ...employeeData, employmentType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Full-time">Full-time</SelectItem>
                      <SelectItem value="Part-time">Part-time</SelectItem>
                      <SelectItem value="Contract">Contract</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-xs uppercase text-muted-foreground">
                    Legal Name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={employeeData.legalName}
                    onChange={(e) =>
                      setEmployeeData({ ...employeeData, legalName: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-xs uppercase text-muted-foreground">
                    Preferred Name
                  </label>
                  <Input
                    value={employeeData.preferredName}
                    onChange={(e) =>
                      setEmployeeData({ ...employeeData, preferredName: e.target.value })
                    }
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-xs uppercase text-muted-foreground">
                    Primary Contact Email <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={employeeData.workEmail}
                    onChange={(e) =>
                      setEmployeeData({ ...employeeData, workEmail: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-xs uppercase text-muted-foreground">
                    Workspace Email Mapping (Future)
                  </label>
                  <Input
                    value={employeeData.workspaceEmail}
                    onChange={(e) =>
                      setEmployeeData({ ...employeeData, workspaceEmail: e.target.value })
                    }
                    placeholder="e.g. john.doe@company.com"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    This will be used later for Google Workspace / Active Directory provisioning.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-xs uppercase text-muted-foreground">
                    Department <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={employeeData.department}
                    onChange={(e) =>
                      setEmployeeData({ ...employeeData, department: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-xs uppercase text-muted-foreground">
                    Position <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={employeeData.position}
                    onChange={(e) => setEmployeeData({ ...employeeData, position: e.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-xs uppercase text-muted-foreground">
                    Grade <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={employeeData.grade}
                    onChange={(e) => setEmployeeData({ ...employeeData, grade: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-xs uppercase text-muted-foreground">
                    Location <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={employeeData.location}
                    onChange={(e) => setEmployeeData({ ...employeeData, location: e.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-xs uppercase text-muted-foreground">
                    Start Date <span className="text-destructive">*</span>
                  </label>
                  <Input
                    type="date"
                    value={employeeData.startDate}
                    onChange={(e) =>
                      setEmployeeData({ ...employeeData, startDate: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-xs uppercase text-muted-foreground">
                    Probation End Date
                  </label>
                  <Input
                    type="date"
                    value={employeeData.probationEndDate}
                    onChange={(e) =>
                      setEmployeeData({ ...employeeData, probationEndDate: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="flex justify-end pt-6 border-t">
                <Button onClick={handleConvert} className="w-full sm:w-auto" size="lg">
                  <UserPlus className="w-5 h-5 mr-2" /> Complete Conversion
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </RequirePermission>
  );
}
