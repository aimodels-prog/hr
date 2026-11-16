import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useCurrentUser } from "@/lib/auth";
import { saveCandidateRemarkFn } from "@/lib/server-functions/candidate.server";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface CandidateRemarkTarget {
  id: string;
  name: string;
  remarks?: string | null | undefined;
}

export function CandidateRemarkDialog({
  candidate,
  onOpenChange,
  onSaved,
}: {
  candidate: CandidateRemarkTarget | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (remark: string) => Promise<void> | void;
}) {
  const currentUser = useCurrentUser();
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setRemark(candidate?.remarks ?? ""), [candidate?.id, candidate?.remarks]);

  const save = async () => {
    if (!candidate || saving) return;
    const value = remark.trim();
    if (!value || value === (candidate.remarks ?? "").trim()) return;
    setSaving(true);
    try {
      await saveCandidateRemarkFn({
        data: {
          actor: {
            actorId: currentUser.userId,
            ...(currentUser.workspaceEmail ? { actorEmail: currentUser.workspaceEmail } : {}),
            activeRole: currentUser.activeRole,
          },
          candidateId: candidate.id,
          remark: value,
        },
      });
      await onSaved(value);
      onOpenChange(false);
      toast.success("HR remark saved for this candidate.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the HR remark.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(candidate)} onOpenChange={(open) => !saving && onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>HR remark for {candidate?.name}</DialogTitle>
          <DialogDescription>
            This note stays in the candidate record. It is not sent to the candidate or added to an
            interview invitation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="candidate-hr-remark">Remark</Label>
          <Textarea
            id="candidate-hr-remark"
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            maxLength={5000}
            rows={6}
            placeholder="Add your note about this candidate..."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={
              !remark.trim() || remark.trim() === (candidate?.remarks ?? "").trim() || saving
            }
          >
            {saving ? "Saving..." : "Save remark"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CandidateRemarkInline({
  candidate,
  onSaved,
  canEdit,
}: {
  candidate: CandidateRemarkTarget;
  onSaved: (remark: string) => Promise<void> | void;
  canEdit: boolean;
}) {
  const currentUser = useCurrentUser();
  const [editing, setEditing] = useState(false);
  const [remark, setRemark] = useState(candidate.remarks ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setRemark(candidate.remarks ?? "");
  }, [candidate.remarks, editing]);

  const save = async () => {
    if (saving) return;
    const value = remark.trim();
    if (!value || value === (candidate.remarks ?? "").trim()) return;
    setSaving(true);
    try {
      await saveCandidateRemarkFn({
        data: {
          actor: {
            actorId: currentUser.userId,
            ...(currentUser.workspaceEmail ? { actorEmail: currentUser.workspaceEmail } : {}),
            activeRole: currentUser.activeRole,
          },
          candidateId: candidate.id,
          remark: value,
        },
      });
      await onSaved(value);
      setEditing(false);
      toast.success("Remark saved. Other recruitment reviewers can see it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the remark.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="mt-2 max-w-xl"
      onClick={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {candidate.remarks && (
        <p className="whitespace-pre-wrap rounded-md bg-muted/60 px-3 py-2 text-sm text-foreground">
          <span className="font-medium">HR remark:</span> {candidate.remarks}
        </p>
      )}
      {canEdit &&
        (editing ? (
          <div className="mt-2 space-y-2">
            <Label htmlFor={`candidate-remark-${candidate.id}`} className="sr-only">
              Remark for {candidate.name}
            </Label>
            <Textarea
              id={`candidate-remark-${candidate.id}`}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
              maxLength={5000}
              rows={2}
              placeholder="Write a private remark for your recruitment team..."
              disabled={saving}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void save()}
                disabled={
                  saving || !remark.trim() || remark.trim() === (candidate.remarks ?? "").trim()
                }
              >
                {saving ? "Saving..." : "Save remark"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setRemark(candidate.remarks ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="link"
            className="h-auto px-0 py-1"
            onClick={() => setEditing(true)}
          >
            {candidate.remarks ? "Edit remark" : "Add remark"}
          </Button>
        ))}
    </div>
  );
}
