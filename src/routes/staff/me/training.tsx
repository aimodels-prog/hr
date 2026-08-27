import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useCurrentUser } from "@/lib/auth";
import { TrainingService } from "@/lib/data/training-service";
import type { TrainingRecord } from "@/lib/data/training-types";
import { GraduationCap, Upload, FileText, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/staff/me/training")({
  component: MyTrainingRoute,
});

function MyTrainingRoute() {
  const currentUser = useCurrentUser();
  const [trainingService] = useState(() => new TrainingService());
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [completionDate, setCompletionDate] = useState(new Date().toISOString().split("T")[0]!);
  const [expiryDate, setExpiryDate] = useState("");
  const [certificateFileId, setCertificateFileId] = useState("file-xyz-123");

  useEffect(() => {
    if (currentUser?.employeeId) {
      setRecords(trainingService.getRecordsForUser(currentUser.employeeId));
    }
  }, [currentUser, trainingService]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser?.employeeId) return;
    try {
      setIsSubmitting(true);
      const result = trainingService.addRecord(
        {
          employeeId: currentUser.employeeId,
          title,
          provider,
          completionDate,
          ...(expiryDate ? { expiryDate } : {}),
          ...(certificateFileId ? { certificateFileId } : {}),
        },
        {
          actor: {
            userId: currentUser.userId,
            displayName: currentUser.displayName,
            roles: currentUser.roles,
          },
        },
      );
      setRecords([...records, result]);
      toast.success("Certification added");
      setOpen(false);
      // Reset
      setTitle("");
      setProvider("");
      setExpiryDate("");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-[1000px] mx-auto pb-10">
      <div className="flex items-center justify-between">
        <PageHeader
          title="My Certifications"
          description="Log completed training and upload your certificates."
        />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Upload className="w-4 h-4 mr-2" /> Add Certification
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Training or Certification</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 pt-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Training Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="e.g. First Aid Level 1"
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Provider / Institution</label>
                <Input
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  required
                  placeholder="e.g. Red Cross"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Completion Date</label>
                  <Input
                    type="date"
                    value={completionDate}
                    onChange={(e) => setCompletionDate(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Expiry Date (Optional)</label>
                  <Input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                  />
                </div>
              </div>

              <div
                className="space-y-1 border-2 border-dashed rounded-md p-6 text-center hover:bg-muted/50 cursor-pointer transition-colors mt-2"
                onClick={() => setCertificateFileId("file-xyz-123")}
              >
                <GraduationCap className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <div className="text-sm font-medium">Click to upload certificate</div>
                <div className="text-xs text-muted-foreground mt-1">PDF, JPG or PNG (max 5MB)</div>
                {certificateFileId && (
                  <div className="mt-3 flex items-center justify-center text-emerald-600 bg-emerald-50 py-1 px-2 rounded text-xs font-medium w-fit mx-auto border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Document attached
                  </div>
                )}
              </div>

              <div className="text-xs text-muted-foreground">
                Note: If an expiry date is provided, you will be automatically reminded before it
                expires.
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" type="button" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || !title || !provider}>
                  {isSubmitting ? "Saving..." : "Save Record"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {records.length === 0 ? (
          <Card className="border-dashed bg-muted/20">
            <CardContent className="flex flex-col items-center justify-center p-12 text-muted-foreground text-center">
              <GraduationCap className="w-12 h-12 mb-4 opacity-50" />
              <h3 className="text-lg font-medium text-foreground">No Certifications Logged</h3>
              <p>You haven't added any training records yet.</p>
            </CardContent>
          </Card>
        ) : (
          records.map((record) => (
            <Card key={record.id}>
              <CardContent className="p-6 flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{record.title}</h3>
                  <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                    <span>{record.provider}</span>
                    <span>•</span>
                    <span>Completed: {new Date(record.completionDate).toLocaleDateString()}</span>
                  </div>
                  {record.expiryDate && (
                    <div className="text-sm text-rose-600 font-medium mt-2">
                      Expires: {new Date(record.expiryDate).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {record.hrVerified && (
                    <div className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-200 flex items-center">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Verified
                    </div>
                  )}
                  {record.certificateFileId && (
                    <Button variant="outline" size="sm">
                      <FileText className="w-4 h-4 mr-2" /> View Certificate
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
