import { SafeForm } from "@/components/ui/safe-form";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo, useRef } from "react";
import { RequirementFields } from "@/components/documents/requirement-fields";
import {
  validateDocumentAnswers,
  type DocumentRequirement,
} from "@/lib/data/document-requirements";
import { getDocumentRequirementsFn } from "@/lib/server-functions/document-requirements.server";
import { getApplicationDataServices } from "@/lib/data/application-data";
import { missingDependantInformation } from "@/lib/data/dependants";
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
import { Label } from "@/components/ui/label";
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
import type { EmployeeDocument, DocumentVisibility } from "@/lib/data/types";
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
      "insurance_card",
      "insurance_benefits",
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

export function DocumentsTab({
  employeeId,
  dependants = [],
}: {
  employeeId: string;
  dependants?: import("@/lib/data/dependants").Dependant[];
}) {
  const currentUser = useCurrentUser();
  const documentService = useMemo(() => new DocumentService(), []);
  const [requirements, setRequirements] = useState<DocumentRequirement[]>([]);
  const [requirementId, setRequirementId] = useState("other");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reviewAnswers, setReviewAnswers] = useState<Record<string, string>>({});
  const [replacementRequirement, setReplacementRequirement] = useState<DocumentRequirement>();
  const selectedRequirement =
    replacementRequirement ?? requirements.find((r) => r.id === requirementId);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isReplacing, setIsReplacing] = useState<string | null>(null);
  const [dependantId, setDependantId] = useState("employee");
  const [dependantDocumentKind, setDependantDocumentKind] = useState<
    "passport" | "national_id" | "visa"
  >("passport");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [rejectingDocumentId, setRejectingDocumentId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [verifyingDocument, setVerifyingDocument] = useState<EmployeeDocument | null>(null);
  const [verificationDetails, setVerificationDetails] = useState({
    documentNumber: "",
    issuingAuthority: "",
    issuingCountry: "",
    issueDate: "",
    expiryDate: "",
    notes: "",
    visibility: "Restricted" as DocumentVisibility,
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void documentService
      .hydrateCompatibilityCache(currentUser.getActorContext())
      .then(async () => {
        if (
          ["HR", "Super Admin"].includes(currentUser.activeRole) ||
          currentUser.employeeId === employeeId
        ) {
          const employee = getApplicationDataServices()
            .storage.readCollection<{ id: string; databaseId?: string }>("employees")
            .find((e) => e.id === employeeId);
          const result = await getDocumentRequirementsFn({
            data: {
              actor: {
                actorId: currentUser.id,
                actorEmail: currentUser.workspaceEmail,
                activeRole: currentUser.activeRole,
              },
              employeeId: employee?.databaseId ?? employeeId,
            },
          });
          if (active) setRequirements(result.definitions);
        }
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

  const documentLocation = useLocation();
  const navigateToDocuments = useNavigate();
  const linkedDocumentId = new URLSearchParams(documentLocation.hash).get("document");
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
  const accessibleDocs = allDocs
    .filter((doc) => {
      if (doc.visibility === "Restricted" && !isHrOrAdmin && !isSelf) return false;
      return true;
    })
    .map((doc) => ({ ...doc, computedStatus: computeStatus(doc) }));
  const visibleDocs = accessibleDocs.filter(
    (doc) => !linkedDocumentId || doc.id === linkedDocumentId,
  );

  // Identify missing mandatory docs
  const missingDocs = requirements
    .filter((r) => r.required)
    .filter(
      (r) =>
        !accessibleDocs.some(
          (d) =>
            (d.requirementId === r.id ||
              (!d.requirementId && d.type === r.type && r.id === r.type)) &&
            ["Valid", "Pending Verification", "Expiring"].includes(d.computedStatus),
        ),
    )
    .map((r) => r.name);

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
      visibility: "Restricted",
    },
  });
  const selectedDocumentType = form.watch("type");
  const isInsuranceDocument = selectedDocumentType.startsWith("insurance_");
  useEffect(() => {
    if (isInsuranceDocument) form.setValue("visibility", "Restricted");
  }, [isInsuranceDocument, form]);
  const hrCompletesVisaDetails =
    isSelf && (selectedDocumentType === "visa" || selectedDocumentType === "work_permit");

  const getActorContext = (reason: string) => ({
    ...currentUser.getActorContext(),
    reason,
  });

  const onSubmit = async (values: z.infer<typeof documentSchema>) => {
    try {
      if (!selectedFile) throw new Error("A file must be selected");
      if (!isReplacing && dependantId === "employee" && !selectedRequirement)
        throw new Error("Choose a document requirement first.");
      if (selectedFile.size > MAX_FILE_SIZE) throw new Error("File exceeds the 10 MB limit");
      if (!ALLOWED_FILE_TYPES.has(selectedFile.type)) {
        throw new Error("Choose a PDF, JPG or PNG file");
      }

      const fileBlob = new Blob([await selectedFile.arrayBuffer()], { type: selectedFile.type });

      const metadata = {
        ...(selectedRequirement && dependantId === "employee"
          ? {
              requirementId: selectedRequirement.id,
              answers: validateDocumentAnswers(selectedRequirement, answers, isHrOrAdmin),
            }
          : {}),
        type: values.type,
        ...(dependantId !== "employee"
          ? { type: "other" as const, dependantId, dependantDocumentKind }
          : {}),
        visibility: "Restricted" as const,
        ...(!hrCompletesVisaDetails && values.documentNumber
          ? { documentNumber: values.documentNumber }
          : {}),
        ...(!hrCompletesVisaDetails && values.issueDate ? { issueDate: values.issueDate } : {}),
        ...(!hrCompletesVisaDetails && values.expiryDate ? { expiryDate: values.expiryDate } : {}),
        ...(!hrCompletesVisaDetails && values.issuingAuthority
          ? { issuingAuthority: values.issuingAuthority }
          : {}),
        ...(!hrCompletesVisaDetails && values.issuingCountry
          ? { issuingCountry: values.issuingCountry }
          : {}),
        ...(!hrCompletesVisaDetails && values.notes ? { notes: values.notes } : {}),
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
        const document = allDocs.find((item) => item.id === id);
        if (!document) throw new Error("The document could not be loaded.");
        setVerificationDetails({
          documentNumber: document.documentNumber || "",
          issuingAuthority: document.issuingAuthority || "",
          issuingCountry: document.issuingCountry || "",
          issueDate: document.issueDate || "",
          expiryDate: document.expiryDate || "",
          notes: document.notes || "",
          visibility: document.visibility,
        });
        setVerifyingDocument(document);
        setReviewAnswers(document.answers ?? {});
        return;
      } else {
        setRejectingDocumentId(id);
        return;
      }
      setRefresh((value) => value + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Verification action failed");
    }
  };

  const confirmVerification = async () => {
    if (!verifyingDocument) return;
    const requiresOfficialDetails =
      !!verifyingDocument.dependantId ||
      ["passport", "visa", "national_id", "work_permit"].includes(verifyingDocument.type);
    if (
      requiresOfficialDetails &&
      !verifyingDocument.requirementSnapshot &&
      (!verificationDetails.documentNumber.trim() ||
        !verificationDetails.issuingAuthority.trim() ||
        !verificationDetails.issueDate ||
        !verificationDetails.expiryDate)
    ) {
      toast.error("Complete all required official document details before verifying.");
      return;
    }
    if (
      verificationDetails.issueDate &&
      verificationDetails.expiryDate &&
      verificationDetails.expiryDate < verificationDetails.issueDate
    ) {
      toast.error("Expiry date cannot be before the issue date.");
      return;
    }
    try {
      await documentService.verifyDocumentAsync(
        verifyingDocument.id,
        getActorContext("HR verified the document and confirmed its official details"),
        {
          ...(verifyingDocument.requirementSnapshot
            ? {
                answers: validateDocumentAnswers(
                  verifyingDocument.requirementSnapshot,
                  reviewAnswers,
                  true,
                  true,
                ),
              }
            : {}),
          ...(verificationDetails.documentNumber.trim()
            ? { documentNumber: verificationDetails.documentNumber.trim() }
            : {}),
          ...(verificationDetails.issuingAuthority.trim()
            ? { issuingAuthority: verificationDetails.issuingAuthority.trim() }
            : {}),
          ...(verificationDetails.issuingCountry.trim()
            ? { issuingCountry: verificationDetails.issuingCountry.trim() }
            : {}),
          ...(verificationDetails.issueDate ? { issueDate: verificationDetails.issueDate } : {}),
          ...(verificationDetails.expiryDate ? { expiryDate: verificationDetails.expiryDate } : {}),
          ...(verificationDetails.notes.trim() ? { notes: verificationDetails.notes.trim() } : {}),
          visibility: verificationDetails.visibility,
        },
      );
      toast.success("Document details saved and verified");
      setVerifyingDocument(null);
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
    if (doc.requirementSnapshot) {
      setReplacementRequirement(doc.requirementSnapshot);
      setRequirementId(doc.requirementSnapshot.id);
      setAnswers(
        Object.fromEntries(
          Object.entries(doc.answers ?? {}).filter(
            ([k]) =>
              isHrOrAdmin ||
              doc.requirementSnapshot!.fields.find((f) => f.key === k)?.owner !== "HR",
          ),
        ),
      );
    } else {
      setReplacementRequirement(undefined);
      setRequirementId("");
      setAnswers({});
    }
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
      {linkedDocumentId && (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <p>
            {!loading && !loadError && visibleDocs.length === 0
              ? "This document is no longer available, or you do not have access."
              : "Selected document — view, download or use the available action below."}
          </p>
          <Button
            variant="outline"
            onClick={() =>
              navigateToDocuments({
                to: documentLocation.pathname,
                hash: "section=documents",
                search: (previous) => previous,
              })
            }
          >
            All documents
          </Button>
        </div>
      )}
      {!loading &&
        !loadError &&
        (isSelf || isHrOrAdmin) &&
        dependants.some((d) => missingDependantInformation(d, allDocs).length) && (
          <Card>
            <CardHeader>
              <CardTitle>Complete family information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {dependants.map((d) => {
                const missing = missingDependantInformation(d, allDocs);
                return missing.length ? (
                  <p key={d.id ?? d.name}>
                    <strong>{d.name}:</strong> {missing.join(", ")}.{" "}
                  </p>
                ) : null;
              })}
              <p className="text-muted-foreground">
                Update contact details under Personal. For documents, choose Upload Document and
                select the dependant. Files awaiting HR verification do not need uploading again.
              </p>
            </CardContent>
          </Card>
        )}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Digital Employee File</h3>
        {(isSelf || isHrOrAdmin) && (
          <a className="text-sm text-primary underline" href="/staff/company-library">
            Insurance benefits
          </a>
        )}
        {(isSelf || isHrOrAdmin) && (
          <Dialog
            open={isUploadOpen}
            onOpenChange={(open) => {
              setIsUploadOpen(open);
              if (!open) {
                setIsReplacing(null);
                setReplacementRequirement(undefined);
                setRequirementId("other");
                setAnswers({});
                setSelectedFile(null);
                form.reset();
                setDependantId("employee");
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
                <DialogTitle>
                  {isReplacing ? "Submit document revision" : "Upload Document"}
                </DialogTitle>
                {isReplacing && (
                  <p className="text-sm text-muted-foreground">
                    HR will review this version. Any approved version stays current until the
                    replacement is approved.
                  </p>
                )}
              </DialogHeader>
              <Form {...form}>
                <SafeForm onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  {!isReplacing && (
                    <div className="space-y-2">
                      <Label htmlFor="document-person">Who is this document for?</Label>
                      <select
                        id="document-person"
                        className="h-10 w-full rounded-md border bg-background px-3"
                        value={dependantId}
                        onChange={(e) => {
                          setDependantId(e.target.value);
                          if (e.target.value !== "employee") form.setValue("type", "other");
                        }}
                      >
                        <option value="employee">Employee</option>
                        {dependants
                          .filter((d) => d.id)
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} ({d.relationship})
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                  {!isReplacing && dependantId !== "employee" && (
                    <div className="space-y-2">
                      <Label htmlFor="family-document-kind">Family document</Label>
                      <select
                        id="family-document-kind"
                        className="h-10 w-full rounded-md border bg-background px-3"
                        value={dependantDocumentKind}
                        onChange={(e) =>
                          setDependantDocumentKind(e.target.value as typeof dependantDocumentKind)
                        }
                      >
                        <option value="passport">Passport</option>
                        <option value="national_id">ID card</option>
                        <option value="visa">Visa</option>
                      </select>
                      <p className="text-xs text-muted-foreground">
                        Only you and HR can access this document. HR verifies the official details.
                      </p>
                    </div>
                  )}
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Document Type *</FormLabel>
                        <Select
                          onValueChange={(id) => {
                            const r = requirements.find((r) => r.id === id);
                            if (r) {
                              setRequirementId(id);
                              setAnswers({});
                              form.reset({ type: r.type, visibility: "Restricted" });
                              field.onChange(r.type);
                            }
                          }}
                          value={requirementId || field.value}
                          disabled={!!isReplacing || dependantId !== "employee"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {requirements
                              .filter((r) => r.uploadBy !== "HR" || isHrOrAdmin)
                              .map((r) => (
                                <SelectItem key={r.id} value={r.id}>
                                  {r.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {selectedRequirement && dependantId === "employee" && (
                    <RequirementFields
                      requirement={selectedRequirement}
                      answers={answers}
                      onChange={setAnswers}
                      isHr={isHrOrAdmin}
                    />
                  )}
                  {!selectedRequirement && hrCompletesVisaDetails && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                      Upload the visa or work-permit file only. HR will complete all official
                      document details and confirm them during verification.
                    </div>
                  )}

                  {(!selectedRequirement || dependantId !== "employee") &&
                    !hrCompletesVisaDetails && (
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
                        {isHrOrAdmin && (
                          <FormField
                            control={form.control}
                            name="visibility"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Visibility</FormLabel>
                                <Select
                                  onValueChange={field.onChange}
                                  value={field.value as string}
                                  disabled={isInsuranceDocument}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="Public">Standard (Public)</SelectItem>
                                    <SelectItem value="Restricted">
                                      Restricted (employee & HR)
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                      </div>
                    )}

                  {(!selectedRequirement || dependantId !== "employee") &&
                    !hrCompletesVisaDetails && (
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
                    )}

                  {(!selectedRequirement || dependantId !== "employee") &&
                    !hrCompletesVisaDetails && (
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
                    )}

                  {(!selectedRequirement || dependantId !== "employee") &&
                    !hrCompletesVisaDetails && (
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
                    )}

                  <div>
                    <Label>File Attachment (Max 10 MB) *</Label>
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
                </SafeForm>
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
                    <div className="font-medium capitalize">
                      {doc.dependantId
                        ? `Family ${doc.dependantDocumentKind?.replace("_", " ") ?? "document"}`
                        : (doc.requirementSnapshot?.name ?? doc.type.replace("_", " "))}
                    </div>
                    {doc.dependantId && (
                      <div className="text-xs text-muted-foreground">
                        {dependants.find((d) => d.id === doc.dependantId)?.name ?? "Dependant"}
                      </div>
                    )}
                    {doc.visibility === "Restricted" && (
                      <div className="text-xs text-orange-600">Restricted</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{doc.documentNumber || "-"}</div>
                    {doc.requirementSnapshot?.fields
                      .filter(
                        (f) =>
                          !["documentNumber", "issueDate", "expiryDate"].includes(f.key) &&
                          doc.answers?.[f.key],
                      )
                      .map((f) => (
                        <div key={f.key} className="mt-1 text-sm">
                          <span className="text-muted-foreground">{f.label}: </span>
                          {doc.answers?.[f.key]}
                        </div>
                      ))}
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
                      (isHrOrAdmin ||
                        (isSelf && !["work_permit", "insurance_benefits"].includes(doc.type))) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Submit a corrected or renewed version for HR review"
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
        open={Boolean(verifyingDocument)}
        onOpenChange={(open) => {
          if (!open) setVerifyingDocument(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Complete and verify document</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Check the uploaded file, enter the official details, then verify the record. These
            details are completed by HR.
          </p>
          {verifyingDocument?.requirementSnapshot && (
            <RequirementFields
              requirement={verifyingDocument.requirementSnapshot}
              answers={reviewAnswers}
              onChange={setReviewAnswers}
              isHr
            />
          )}
          <div
            hidden={!!verifyingDocument?.requirementSnapshot}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="verify-document-number">Document number *</Label>
              <Input
                id="verify-document-number"
                value={verificationDetails.documentNumber}
                onChange={(event) =>
                  setVerificationDetails((current) => ({
                    ...current,
                    documentNumber: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="verify-authority">Issuing authority *</Label>
              <Input
                id="verify-authority"
                value={verificationDetails.issuingAuthority}
                onChange={(event) =>
                  setVerificationDetails((current) => ({
                    ...current,
                    issuingAuthority: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="verify-country">Issuing country</Label>
              <Input
                id="verify-country"
                value={verificationDetails.issuingCountry}
                onChange={(event) =>
                  setVerificationDetails((current) => ({
                    ...current,
                    issuingCountry: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Access</Label>
              <Select
                value={verificationDetails.visibility}
                onValueChange={(value: DocumentVisibility) =>
                  setVerificationDetails((current) => ({ ...current, visibility: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Restricted">Restricted to employee and HR</SelectItem>
                  <SelectItem value="Public">Standard employee document</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="verify-issue-date">Issue date *</Label>
              <Input
                id="verify-issue-date"
                type="date"
                value={verificationDetails.issueDate}
                onChange={(event) =>
                  setVerificationDetails((current) => ({
                    ...current,
                    issueDate: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="verify-expiry-date">Expiry date *</Label>
              <Input
                id="verify-expiry-date"
                type="date"
                min={verificationDetails.issueDate || undefined}
                value={verificationDetails.expiryDate}
                onChange={(event) =>
                  setVerificationDetails((current) => ({
                    ...current,
                    expiryDate: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="verify-notes">HR notes</Label>
            <Textarea
              id="verify-notes"
              value={verificationDetails.notes}
              onChange={(event) =>
                setVerificationDetails((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyingDocument(null)}>
              Cancel
            </Button>
            <Button onClick={() => confirmVerification()}>Save and verify</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <Label htmlFor="document-rejection-reason">Reason</Label>
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
