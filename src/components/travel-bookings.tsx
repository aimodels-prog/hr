import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/auth";
import {
  changeTravelBookingFn,
  getTravelBookingQueueFn,
  readTravelFileFn,
} from "@/lib/server-functions/travel.server";
import type { TravelBooking, TravelRequest } from "@/lib/data/travel-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { encodeUploadFile } from "@/lib/upload-payload";

export function TravelBookings({
  trip,
  onChanged,
}: {
  trip?: TravelRequest;
  onChanged?: () => void;
}) {
  const user = useCurrentUser();
  const [rows, setRows] = useState<
    Array<{
      id: string;
      destination: string;
      currency: string;
      startDate: string;
      endDate: string;
      bookings: TravelBooking[];
      travellers?: string[];
    }>
  >([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<TravelBooking["kind"]>("Car");
  const [name, setName] = useState("");
  const [details, setDetails] = useState("");
  const [estimate, setEstimate] = useState("0");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File>>({});
  const canQueue = ["Travel Admin", "Accounts", "HR", "Super Admin"].includes(user.activeRole);
  useEffect(() => {
    if (trip || !canQueue) return;
    let cancelled = false;
    getTravelBookingQueueFn({
      data: {
        actor: {
          actorId: user.userId,
          actorEmail: user.workspaceEmail,
          activeRole: user.activeRole,
        },
      },
    })
      .then((result) => {
        if (!cancelled) {
          setRows(result);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Bookings could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [trip, canQueue, user.userId, user.workspaceEmail, user.activeRole, revision]);
  if (!trip && !canQueue) return null;
  const visible = trip
    ? [{ ...trip, bookings: trip.bookings ?? [], travellers: [] as string[] }]
    : rows;
  const canRequest =
    trip &&
    trip.employeeId === user.employeeId &&
    trip.managerApprovalStatus === "Approved" &&
    trip.hrApprovalStatus === "Approved" &&
    ["Pending HR and Accounts", "Pre-authorised"].includes(trip.status);
  const change = async (
    requestId: string,
    action: "request" | "approve" | "reject" | "confirm",
    bookingId?: string,
  ) => {
    setBusy(true);
    try {
      const file = bookingId && action === "confirm" ? files[bookingId] : undefined;
      if (file && !["application/pdf", "image/jpeg", "image/png"].includes(file.type))
        throw new Error("Attach a PDF, JPG or PNG document.");
      await changeTravelBookingFn({
        data: {
          actor: {
            actorId: user.userId,
            actorEmail: user.workspaceEmail,
            activeRole: user.activeRole,
          },
          requestId,
          action,
          ...(file
            ? {
                document: {
                  fileName: file.name,
                  mimeType: file.type as "application/pdf" | "image/jpeg" | "image/png",
                  bytes: await encodeUploadFile(file),
                },
              }
            : {}),
          ...(bookingId
            ? { bookingId, confirmation: comments[bookingId] ?? "" }
            : {
                kind,
                name: name.trim() || (kind === "Other" ? "" : kind),
                details,
                estimate: Number(estimate),
              }),
        },
      });
      toast.success(action === "request" ? "Sent to Finance" : "Arrangement updated");
      setName("");
      setDetails("");
      setRevision((n) => n + 1);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update arrangement.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{trip ? "Travel arrangements" : "Booking desk"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert">{error}</p>}
        {visible.map((row) => (
          <div key={row.id} className="space-y-3">
            {!trip && (
              <h3 className="font-medium">
                {row.destination} · {row.startDate} – {row.endDate}
              </h3>
            )}
            {!trip && <p className="text-sm">{row.travellers?.join(", ")}</p>}
            {row.bookings.map((b) => (
              <div key={b.id} className="rounded-lg border p-4 space-y-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{b.name}</strong>
                  <span>{b.status}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{b.details}</p>
                <p className="text-sm">
                  {row.currency} {b.estimate.toFixed(2)}
                </p>
                {b.confirmation && <p className="text-sm whitespace-pre-wrap">{b.confirmation}</p>}
                {b.documentFileId && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        const result = await readTravelFileFn({
                          data: {
                            actor: {
                              actorId: user.userId,
                              actorEmail: user.workspaceEmail,
                              activeRole: user.activeRole,
                            },
                            requestId: row.id,
                            bookingId: b.id,
                          },
                        });
                        const url = URL.createObjectURL(
                          new Blob([Uint8Array.from(result.bytes)], {
                            type: result.metadata.mimeType,
                          }),
                        );
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = result.metadata.name;
                        link.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Download failed.");
                      }
                    }}
                  >
                    Download booking document
                  </Button>
                )}
                {((user.activeRole === "Accounts" && b.status === "Pending Finance") ||
                  (user.activeRole === "Travel Admin" && b.status === "Approved")) && (
                  <div className="space-y-2">
                    {user.activeRole === "Travel Admin" && (
                      <label className="block text-sm">
                        Ticket or booking document (optional, up to 10 MB)
                        <Input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setFiles({ ...files, [b.id]: file });
                          }}
                        />
                      </label>
                    )}
                    <Textarea
                      aria-label={`Booking details for ${b.name}`}
                      placeholder={
                        user.activeRole === "Travel Admin"
                          ? "Booking reference, pickup / flight / hotel details and instructions"
                          : "Note (required if declining)"
                      }
                      value={comments[b.id] ?? ""}
                      onChange={(e) => setComments({ ...comments, [b.id]: e.target.value })}
                    />
                    {user.activeRole === "Accounts" ? (
                      <div className="flex gap-2">
                        <Button
                          disabled={busy}
                          onClick={() => void change(row.id, "approve", b.id)}
                        >
                          Approve cost
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => void change(row.id, "reject", b.id)}
                        >
                          Decline
                        </Button>
                      </div>
                    ) : (
                      <Button disabled={busy} onClick={() => void change(row.id, "confirm", b.id)}>
                        Confirm booking
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        {!visible.some((r) => r.bookings.length) && (
          <p className="text-sm text-muted-foreground">No arrangements requested.</p>
        )}
        {canRequest && (
          <form
            className="space-y-3 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void change(trip.databaseId ?? trip.id, "request");
            }}
          >
            <h3 className="font-medium">Request an arrangement</h3>
            <label className="block text-sm">
              Arrangement
              <select
                className="block min-h-11 w-full rounded-md border bg-background px-3"
                value={kind}
                onChange={(e) => setKind(e.target.value as TravelBooking["kind"])}
              >
                {["Car", "Flight", "Hotel", "Other"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Name
              <Input
                required={kind === "Other"}
                maxLength={150}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Details
              <Textarea
                required
                maxLength={2000}
                placeholder="Dates, times, pickup location and who this is for"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Estimated cost ({trip.currency})
              <Input
                required
                type="number"
                min="0"
                step="0.01"
                value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
              />
            </label>
            <Button disabled={busy} type="submit">
              Send to Finance
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
