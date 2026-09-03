import { useEffect, useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileUp,
  Eye,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCcw,
  FileWarning,
  AlertCircle,
} from "lucide-react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useCurrentUser } from "@/lib/auth";
import { format } from "date-fns";
import type { EmployeeDocument, DocumentType, DocumentVisibility } from "@/lib/data/types";
import { DocumentService } from "@/lib/data/document-service";
import { StatusBadge } from "@/components/ui/status-badge";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

const documentSchema = z
  .object({
    type: z.enum([
      "contract",
      "passport",
      "visa",
      "national_id",
      "work_permit",
      "driving_licence",
      "medical",
      "education_certificate",
      "professional_certificate",
      "bank_evidence",
      "other",
    ]),
    documentNumber: z.string().optional(),
    issueDate: z.string().optional(),
    expiryDate: z.string().optional(),
    issuingAuthority: z.string().optional(),
    issuingCountry: z.string().optional(),
    notes: z.string().optional(),
    visibility: z.enum(["Public", "Restricted"]),
  })
  .refine(
    (data) => {
      if (data.issueDate && data.expiryDate) {
        return new Date(data.issueDate) < new Date(data.expiryDate);
      }
      return true;
    },
    {
      message: "Expiry date must be after issue date",
      path: ["expiryDate"],
    },
  );

const MANDATORY_DOCS: DocumentType[] = ["contract", "national_id"];

export function DocumentsTab({ employeeId }: { employeeId: string }) {
  const currentUser = useCurrentUser();
  const documentService = useMemo(() => new DocumentService(), []);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isReplacing, setIsReplacing] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [rejectingDocumentId, setRejectingDocumentId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void documentService
      .hydrateCompatibilityCache(currentUser.getActorContext())
      .then(() => {
        if (active) setRefresh((value) => value + 1);
      })
      .catch((error) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : "Documents could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser, documentService, employeeId]);

  const allDocs = documentService
    .getDocuments(currentUser.getActorContext())
    .filter((document) => document.employeeId === employeeId);

  const isHrOrAdmin = currentUser?.activeRole === "HR" || currentUser?.activeRole === "Super Admin";
  const isSelf = currentUser?.employeeId === employeeId;

  // Compute status on the fly (Expiring within 30 days, Expired)
  const computeStatus = (doc: EmployeeDocument) => {
    if (
      doc.status === "Replaced" ||
      doc.status === "Rejected" ||
      doc.status === "Pending Verification"
    )
      return doc.status;
    if (doc.expiryDate) {
      const exp = new Date(doc.expiryDate);
      const now = new Date();
      if (exp < now) return "Expired";
      const thirtyDays = new Date();
      thirtyDays.setDate(now.getDate() + 30);
      if (exp < thirtyDays) return "Expiring";
    }
    return "Valid";
  };

  // Filter restricted docs
  const visibleDocs = allDocs
    .filter((doc) => {
      if (doc.visibility === "Restricted" && !isHrOrAdmin && !isSelf) return false;
      return true;
    })
    .map((doc) => ({ ...doc, computedStatus: computeStatus(doc) }));

  // Identify missing mandatory docs
  const missingDocs = MANDATORY_DOCS.filter(
    (type) =>
      !visibleDocs.some(
        (d) =>
          d.type === type &&
          ["Valid", "Pending Verification", "Expiring"].includes(d.computedStatus),
      ),
  );

  const form = useForm<z.infer<typeof documentSchema>>({
    resolver: zodResolver(documentSchema),
    defaultValues: {
      type: "other",
      documentNumber: "",
      issueDate: "",
      expiryDate: "",
      issuingAuthority: "",
      issuingCountry: "",
      notes: "",
      visibility: "Public",
    },
  });

  const getActorContext = (reason: string) => ({
    ...currentUser.getActorContext(),
    reason,
  });

  const onSubmit = async (values: z.infer<typeof documentSchema>) => {
    try {
      if (!selectedFile) throw new Error("A file must be selected");
      if (selectedFile.size > MAX_FILE_SIZE) throw new Error("File exceeds the 10 MB limit");
      if (!ALLOWED_FILE_TYPES.has(selectedFile.type)) {
        throw new Error("Choose a PDF, JPG or PNG file");
      }

      const fileBlob = new Blob([await selectedFile.arrayBuffer()], { type: selectedFile.type });

      const metadata = {
        type: values.type,
        visibility: values.visibility,
        ...(values.documentNumber ? { documentNumber: values.documentNumber } : {}),
        ...(values.issueDate ? { issueDate: values.issueDate } : {}),
        ...(values.expiryDate ? { expiryDate: values.expiryDate } : {}),
        ...(values.issuingAuthority ? { issuingAuthority: values.issuingAuthority } : {}),
        ...(values.issuingCountry ? { issuingCountry: values.issuingCountry } : {}),
        ...(values.notes ? { notes: values.notes } : {}),
      };

      if (isReplacing) {
        await documentService.replaceDocument(
          isReplacing,
          fileBlob,
          selectedFile.name,
          metadata,
          getActorContext("Document replaced"),
        );
        toast.success("Document replaced");
      } else {
        await documentService.uploadDocument(
          employeeId,
          fileBlob,
          selectedFile.name,
          metadata,
          getActorContext("Document uploaded"),
        );
        toast.success("Document uploaded");
      }

      setIsUploadOpen(false);
      setSelectedFile(null);
      setIsReplacing(null);
      form.reset();
      setRefresh((value) => value + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const handleDownload = async (fileId: string, preview = false) => {
    try {
      const { blob, metadata } = await documentService.downloadFile(
        fileId,
        getActorContext(preview ? "Document previewed" : "Document downloaded"),
      );
      const url = URL.createObjectURL(blob);
      if (preview) {
        window.open(url, "_blank");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = metadata.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      toast.error("Failed to access file");
    }
  };

  const handleVerify = async (id: string, approve: boolean) => {
    try {
      if (approve) {
        await documentService.verifyDocumentAsync(id, getActorContext("HR verification"));
        toast.success("Document verified");
      } else {
        setRejectingDocumentId(id);
        return;
      }
      setRefresh((value) => value + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Verification action failed");
    }
  };

  const rejectDocument = async () => {
    if (!rejectingDocumentId) return;
    try {
      await documentService.rejectDocumentAsync(
        rejectingDocumentId,
        rejectionReason,
        getActorContext(rejectionReason),
      );
      toast.success("Document rejected");
      setRejectingDocumentId(null);
      setRejectionReason("");
      setRefresh((value) => value + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reject the document");
    }
  };

  const openReplace = (doc: EmployeeDocument) => {
    setIsReplacing(doc.id);
    form.reset({
      type: doc.type,
      documentNumber: doc.documentNumber || "",
      issueDate: doc.issueDate || "",
      expiryDate: doc.expiryDate || "",
      issuingAuthority: doc.issuingAuthority || "",
      issuingCountry: doc.issuingCountry || "",
      notes: doc.notes || "",
      visibility: doc.visibility,
    });
    setIsUploadOpen(true);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-6">
      {loading && <p className="text-sm text-muted-foreground">Loading employee documents...</p>}
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Digital Employee File</h3>
        {(isSelf || isHrOrAdmin) && (
          <Dialog
            open={isUploadOpen}
            onOpenChange={(open) => {
              setIsUploadOpen(open);
              if (!open) {
                setIsReplacing(null);
                setSelectedFile(null);
                form.reset();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <FileUp className="mr-2 h-4 w-4" /> Upload Document
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{isReplacing ? "Replace Document" : "Upload Document"}</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Document Type *</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value as string}
                          disabled={!!isReplacing}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {[
                              "contract",
                              "passport",
                              "visa",
                              "national_id",
                              "work_permit",
                              "driving_licence",
                              "medical",
                              "education_certificate",
                              "professional_certificate",
                              "bank_evidence",
                              "other",
                            ].map((t) => (
                              <SelectItem key={t} value={t}>
                                {t.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="documentNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Document ID</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="visibility"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Visibility</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value as string}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Public">Standard (Public)</SelectItem>
                              <SelectItem value="Restricted">Restricted (HR Only)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="issuingAuthority"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Issuing Authority</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="issuingCountry"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Issuing Country</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="issueDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Issue Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="expiryDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Expiry Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div>
                    <FormLabel>File Attachment (Max 10 MB) *</FormLabel>
                    <div className="mt-1 flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Choose File
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {selectedFile ? selectedFile.name : "No file selected"}
                      </span>
                    </div>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                      className="hidden"
                      ref={fileInputRef}
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                    />
                  </div>

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsUploadOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit">Upload</Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {(isSelf || isHrOrAdmin) && missingDocs.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm text-destructive flex items-center">
              <AlertCircle className="mr-2 h-4 w-4" /> Missing Mandatory Documents
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2 px-4 flex gap-2 flex-wrap">
            {missingDocs.map((md) => (
              <div
                key={md}
                className="px-3 py-1 bg-destructive/10 text-destructive text-xs rounded-full capitalize"
              >
                {md.replace("_", " ")}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document Type</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleDocs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No documents found.
                </TableCell>
              </TableRow>
            ) : (
              visibleDocs.map((doc) => (
                <TableRow
                  key={doc.id}
                  className={doc.computedStatus === "Replaced" ? "opacity-50" : ""}
                >
                  <TableCell>
                    <div className="font-medium capitalize">{doc.type.replace("_", " ")}</div>
                    {doc.visibility === "Restricted" && (
                      <div className="text-xs text-orange-600">Restricted</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{doc.documentNumber || "-"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[doc.issuingAuthority, doc.issuingCountry].filter(Boolean).join(", ")}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div>
                      Iss: {doc.issueDate ? format(new Date(doc.issueDate), "MMM d, yy") : "-"}
                    </div>
                    <div
                      className={
                        doc.computedStatus === "Expired" || doc.computedStatus === "Expiring"
                          ? "text-destructive font-medium"
                          : ""
                      }
                    >
                      Exp: {doc.expiryDate ? format(new Date(doc.expiryDate), "MMM d, yy") : "-"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={doc.computedStatus} />
                    {doc.computedStatus === "Rejected" && (
                      <div
                        className="text-xs text-destructive mt-1 max-w-[120px] truncate"
                        title={doc.rejectionReason}
                      >
                        {doc.rejectionReason}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {doc.computedStatus !== "Replaced" &&
                      doc.computedStatus !== "Rejected" &&
                      (isSelf || isHrOrAdmin) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Replace with new version"
                          onClick={() => openReplace(doc)}
                        >
                          <RefreshCcw className="h-4 w-4" />
                        </Button>
                      )}
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Preview"
                      onClick={() => handleDownload(doc.fileId, true)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Download"
                      onClick={() => handleDownload(doc.fileId, false)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    {isHrOrAdmin && doc.computedStatus === "Pending Verification" && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-emerald-600"
                          title="Verify"
                          onClick={() => handleVerify(doc.id, true)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          title="Reject"
                          onClick={() => handleVerify(doc.id, false)}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog
        open={Boolean(rejectingDocumentId)}
        onOpenChange={(open) => {
          if (!open) {
            setRejectingDocumentId(null);
            setRejectionReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject document</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <FormLabel htmlFor="document-rejection-reason">Reason</FormLabel>
            <Textarea
              id="document-rejection-reason"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Explain what must be corrected or replaced"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingDocumentId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rejectionReason.trim().length < 3}
              onClick={rejectDocument}
            >
              Reject document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
