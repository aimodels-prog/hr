import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { CandidateService } from "@/lib/data/candidate-service";
import { OfferService } from "@/lib/data/offer-service";
import { ConversionService } from "@/lib/data/conversion-service";
import { HireIdentityFields } from "@/components/offers/hire-identity-fields";
import type { HireIdentityInput } from "@/lib/recruitment/hire-identity";

export const Route = createFileRoute("/staff/candidates/$candidateId/convert")({
  component: ConversionWizardRoute,
});

function ConversionWizardRoute() {
  const { candidateId } = Route.useParams();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const candidates = useMemo(() => new CandidateService(), []);
  const offers = useMemo(() => new OfferService(), []);
  const conversion = useMemo(() => new ConversionService(), []);
  const [identity, setIdentity] = useState<HireIdentityInput>({});
  const [saving, setSaving] = useState(false);
  const candidate = candidates.getCandidate(candidateId, user.getActorContext());
  const acceptedOffers = offers
    .getOffersForCandidate(candidateId, user.getActorContext())
    .filter((offer) => offer.status === "Accepted");
  const offer = acceptedOffers.find((item) => !item.convertedToEmployeeId) ?? acceptedOffers[0];
  if (!candidate) return <p>Candidate not found.</p>;
  if (!offer) return <p>An accepted offer is required before linking an employee profile.</p>;
  if (offer.convertedToEmployeeId)
    return (
      <Button
        onClick={() =>
          navigate({
            to: "/staff/employees/$employeeId",
            params: { employeeId: offer.convertedToEmployeeId! },
          })
        }
      >
        View employee profile
      </Button>
    );
  const linkedEmployeeId =
    candidates
      .getApplicationRepository()
      .list()
      .find((item) => item.candidateId === candidateId && item.vacancyId === offer.vacancyId)
      ?.internalApplicantEmployeeId ?? candidate.convertedToEmployeeId;

  const submit = async () => {
    setSaving(true);
    try {
      const employeeId = await conversion.convertCandidateToEmployee(
        candidate.id,
        offer.id,
        {},
        user.getActorContext(),
        identity,
      );
      toast.success("Employee profile linked");
      await navigate({ to: "/staff/employees/$employeeId", params: { employeeId } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not link the employee profile.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <RequirePermission
      permission="recruitment:manage_candidates"
      resourceName="Link employee profile"
    >
      <div className="mx-auto max-w-2xl space-y-5 pb-10">
        <Button
          variant="ghost"
          onClick={() =>
            navigate({ to: "/staff/candidates/$candidateId", params: { candidateId } })
          }
        >
          Back to candidate
        </Button>
        <PageHeader
          title="Link employee profile"
          description={`${candidate.firstName} ${candidate.lastName}`}
        />
        <Card>
          <CardHeader>
            <CardTitle>Accepted offer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p>
              {offer.position} · {offer.location} · {offer.startDate}
            </p>
            <HireIdentityFields
              linkedEmployeeId={linkedEmployeeId}
              value={identity}
              onChange={setIdentity}
              disabled={saving}
            />
            <Button
              onClick={() => submit()}
              disabled={
                saving ||
                (!linkedEmployeeId &&
                  (!identity.identityConfirmed ||
                    (!identity.existingEmployeeId && !identity.workspaceEmail?.trim())))
              }
            >
              {saving ? "Saving…" : "Confirm employee profile"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </RequirePermission>
  );
}
