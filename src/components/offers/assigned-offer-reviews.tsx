import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/auth";
import {
  listAssignedOfferReviewsFn,
  reviewAssignedOfferFn,
} from "@/lib/server-functions/offer.server";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Review = Awaited<ReturnType<typeof listAssignedOfferReviewsFn>>[number];

export function AssignedOfferReviews() {
  const user = useCurrentUser();
  const [rows, setRows] = useState<Review[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const { id, workspaceEmail, activeRole } = user;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRows([]);
    setError("");
    void listAssignedOfferReviewsFn({
      data: { actor: { actorId: id, actorEmail: workspaceEmail, activeRole } },
    })
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load assigned offers.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, workspaceEmail, activeRole, refresh]);
  async function decide(row: Review, decision: "approve" | "return") {
    setBusy(true);
    setError("");
    try {
      await reviewAssignedOfferFn({
        data: {
          actor: { actorId: id, actorEmail: workspaceEmail, activeRole },
          offerId: row.id,
          expectedVersion: row.recordVersion,
          decision,
          comment: comments[row.id] ?? "",
        },
      });
      setRefresh((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the decision.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 p-6">
      <h2 className="text-xl font-semibold">Offers assigned to me</h2>
      <p>Review the proposed terms, then approve or return the offer to HR with a comment.</p>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading assigned offers…</p>
      ) : !rows.length && !error ? (
        <p>No offers are awaiting your review.</p>
      ) : null}
      <Button
        variant="outline"
        disabled={busy || loading}
        onClick={() => setRefresh((value) => value + 1)}
      >
        Refresh
      </Button>
      {rows.map((row) => (
        <article key={row.id} className="space-y-3 rounded-lg border p-4">
          <h3 className="font-semibold">
            {row.candidateName} — {row.position}
          </h3>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt>Salary</dt>
              <dd>
                {row.salary.toLocaleString()} {row.currency}
              </dd>
            </div>
            <div>
              <dt>Grade / location</dt>
              <dd>
                {row.grade} / {row.location}
              </dd>
            </div>
            <div>
              <dt>Allowances</dt>
              <dd>{row.allowances || "None recorded"}</dd>
            </div>
            <div>
              <dt>Benefits</dt>
              <dd>{row.benefits || "None recorded"}</dd>
            </div>
            <div>
              <dt>Start date</dt>
              <dd>{row.startDate}</dd>
            </div>
            <div>
              <dt>Probation</dt>
              <dd>{row.probation}</dd>
            </div>
            <div>
              <dt>Conditions</dt>
              <dd>{row.conditions}</dd>
            </div>
          </dl>
          <h4 className="font-medium">Interview summary for this vacancy</h4>
          {row.interviewSummary.length ? (
            <ul className="list-disc pl-5">
              {row.interviewSummary.map((item, index) => (
                <li key={index}>
                  {item.stage}: {item.status}
                  {item.outcome ? ` — ${item.outcome}` : ""}
                  {item.recommendation ? `: ${item.recommendation}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>No interview summary recorded.</p>
          )}
          <Textarea
            aria-label={`Decision comment for ${row.candidateName}`}
            value={comments[row.id] ?? ""}
            onChange={(event) =>
              setComments((current) => ({ ...current, [row.id]: event.target.value }))
            }
            placeholder="Explain your approval or the changes HR should make"
            maxLength={2000}
          />
          <div className="flex gap-2">
            <Button
              disabled={busy || (comments[row.id]?.trim().length ?? 0) < 5}
              onClick={() => void decide(row, "approve")}
            >
              Approve offer
            </Button>
            <Button
              variant="outline"
              disabled={busy || (comments[row.id]?.trim().length ?? 0) < 5}
              onClick={() => void decide(row, "return")}
            >
              Return to HR
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
}
