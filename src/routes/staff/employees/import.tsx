import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { UploadCloud, ArrowRight, ArrowLeft, CheckCircle2, AlertTriangle } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { RequirePermission, useCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

import {
  EmployeeImportService,
  STANDARD_FIELDS,
  type EmployeeImportResult,
  type ImportMapping,
  type NormalizedEmployeeRow,
  type ResolvedImportRow,
  type SheetPreview,
} from "@/lib/data/employee-import-service";
import { EmployeeService } from "@/lib/data/employee-service";
import { OnboardingService } from "@/lib/data/onboarding-service";

export const Route = createFileRoute("/staff/employees/import")({
  component: EmployeeImportWizard,
});

function EmployeeImportWizard() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [importService] = useState(() => new EmployeeImportService());
  const [employeeService] = useState(() => new EmployeeService());
  const [onboardingService] = useState(() => new OnboardingService());

  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetPreview[]>([]);
  const [selectedSheetNames, setSelectedSheetNames] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, ImportMapping>>({});

  const [resolvedRows, setResolvedRows] = useState<ResolvedImportRow[]>([]);
  const [isCommitting, setIsCommitting] = useState(false);
  const [results, setResults] = useState<EmployeeImportResult | null>(null);

  const resetWizard = () => {
    setStep(1);
    setFile(null);
    setSheets([]);
    setSelectedSheetNames([]);
    setMappings({});
    setResolvedRows([]);
    setResults(null);
  };

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const nextFile = acceptedFiles[0];
      if (!nextFile) return;
      setFile(nextFile);

      try {
        const parsedSheets = await importService.parseWorkbook(nextFile);
        setSheets(parsedSheets);
        setSelectedSheetNames(parsedSheets.map((s) => s.name));

        const initialMappings: Record<string, ImportMapping> = {};
        for (const sheet of parsedSheets) {
          initialMappings[sheet.name] = importService.autoMapHeaders(sheet.headers);
        }
        setMappings(initialMappings);
        setStep(2);
      } catch {
        toast.error("Failed to parse file. Make sure it's a valid XLSX or CSV.");
      }
    },
    [importService],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
      "text/csv": [".csv"],
    },
    maxFiles: 1,
  });

  const proceedToMapping = () => {
    if (selectedSheetNames.length === 0) {
      toast.error("Select at least one sheet to import.");
      return;
    }
    setStep(3);
  };

  const processNormalization = () => {
    let allNormalized: NormalizedEmployeeRow[] = [];
    for (const sheetName of selectedSheetNames) {
      const sheet = sheets.find((s) => s.name === sheetName);
      if (!sheet) continue;
      const mapping = mappings[sheetName] || {};
      allNormalized = allNormalized.concat(
        importService.normalizeData(sheet.rows, sheetName, mapping, sheet.headerRowNumber),
      );
    }
    setResolvedRows(importService.resolveBatch(allNormalized, employeeService));
    setStep(4);
  };

  const commitImport = async () => {
    if (!currentUser) return;
    setIsCommitting(true);
    try {
      const result = await importService.commitImportBatch(
        resolvedRows,
        employeeService,
        onboardingService,
        {
          ...currentUser.getActorContext(),
          reason: "Committed reviewed employee spreadsheet import",
        },
      );
      setResults(result);
      setStep(5);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to commit import.");
    } finally {
      setIsCommitting(false);
    }
  };

  const readyRows = useMemo(
    () => resolvedRows.filter((r) => r.blockingErrors.length === 0),
    [resolvedRows],
  );
  const blockedRows = useMemo(
    () => resolvedRows.filter((r) => r.blockingErrors.length > 0),
    [resolvedRows],
  );

  return (
    <RequirePermission permission="employee:manage_all" resourceName="Bulk Import Employees">
      <div className="flex h-full flex-col gap-6 p-6 max-w-6xl mx-auto pb-10">
        <PageHeader
          title="Import Employees"
          description="Bring a batch of employees in from an XLSX or CSV spreadsheet, instead of adding them one at a time."
          breadcrumbs={[
            { label: "Core HR" },
            { label: "Directory", href: "/staff/employees" as any },
            { label: "Import Employees" },
          ]}
        />

        <div className="flex items-center gap-2 mb-2 text-sm font-medium flex-wrap">
          <Badge variant={step >= 1 ? "default" : "outline"}>1. Upload</Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Badge variant={step >= 2 ? "default" : "outline"}>2. Select Sheets</Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Badge variant={step >= 3 ? "default" : "outline"}>3. Map Columns</Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Badge variant={step >= 4 ? "default" : "outline"}>4. Review</Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Badge variant={step === 5 ? "default" : "outline"}>5. Results</Badge>
        </div>

        {step === 1 && (
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
              isDragActive
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            }`}
          >
            <input {...getInputProps()} />
            <UploadCloud className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold">Drag & drop spreadsheet here</h3>
            <p className="text-sm text-muted-foreground mt-2">Supports .xlsx, .xls, .csv</p>
            <Button className="mt-6" variant="secondary">
              Browse Files
            </Button>
          </div>
        )}

        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Select Sheets</CardTitle>
              <CardDescription>
                We detected {sheets.length} sheet{sheets.length === 1 ? "" : "s"} in {file?.name}.
                Select which ones to import.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sheets.map((sheet) => (
                <div key={sheet.name} className="flex items-center space-x-3 p-3 border rounded-lg">
                  <Checkbox
                    id={`sheet-${sheet.name}`}
                    checked={selectedSheetNames.includes(sheet.name)}
                    onCheckedChange={(checked) => {
                      if (checked) setSelectedSheetNames((prev) => [...prev, sheet.name]);
                      else setSelectedSheetNames((prev) => prev.filter((n) => n !== sheet.name));
                    }}
                  />
                  <div className="grid gap-1.5 leading-none">
                    <label
                      htmlFor={`sheet-${sheet.name}`}
                      className="text-sm font-medium leading-none"
                    >
                      {sheet.name}
                    </label>
                    <p className="text-sm text-muted-foreground">
                      {sheet.rows.length} rows, {sheet.headers.length} columns detected.
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={proceedToMapping}>
                Continue <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>Map Columns</CardTitle>
              <CardDescription>
                Match your spreadsheet columns to employee fields. Fields marked * are required.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue={selectedSheetNames[0] || ""}>
                <TabsList className="mb-4">
                  {selectedSheetNames.map((name) => (
                    <TabsTrigger key={name} value={name}>
                      {name}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {selectedSheetNames.map((name) => {
                  const sheet = sheets.find((s) => s.name === name);
                  if (!sheet) return null;
                  const mapping = mappings[name] || {};

                  return (
                    <TabsContent key={name} value={name}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[500px] overflow-y-auto pr-4">
                        {STANDARD_FIELDS.map((field) => (
                          <div
                            key={field.id}
                            className="flex flex-col gap-1.5 p-3 border rounded-md bg-muted/20"
                          >
                            <label className="text-sm font-medium">
                              {field.label}
                              {field.required && <span className="text-destructive"> *</span>}
                            </label>
                            <Select
                              value={mapping[field.id] || "none"}
                              onValueChange={(val) => {
                                const newMapping = { ...mapping };
                                if (val === "none") delete newMapping[field.id];
                                else newMapping[field.id] = val;
                                setMappings((prev) => ({ ...prev, [name]: newMapping }));
                              }}
                            >
                              <SelectTrigger className="bg-background">
                                <SelectValue placeholder="Ignore" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">-- Ignore --</SelectItem>
                                {sheet.headers.map((h) => (
                                  <SelectItem key={h} value={h}>
                                    {h}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    </TabsContent>
                  );
                })}
              </Tabs>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={processNormalization}>
                Process Data <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Ready to Import</CardTitle>
                <CardDescription>
                  {readyRows.length} of {resolvedRows.length} row
                  {resolvedRows.length === 1 ? "" : "s"} are ready to create.{" "}
                  {blockedRows.length > 0 &&
                    `${blockedRows.length} will be skipped until their issues are fixed in the source file.`}
                </CardDescription>
              </CardHeader>
            </Card>

            {blockedRows.length > 0 && (
              <Card className="border-amber-200">
                <CardHeader className="bg-amber-500/10 pb-4">
                  <CardTitle className="text-amber-700 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" /> Rows That Will Be Skipped (
                    {blockedRows.length})
                  </CardTitle>
                  <CardDescription>
                    Fix these in the spreadsheet and re-upload if you want them included.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Employee #</TableHead>
                        <TableHead>Issues</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {blockedRows.map((entry, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-sm text-muted-foreground">
                            {entry.row._sourceSheet} · Row {entry.row._sourceRowIndex}
                          </TableCell>
                          <TableCell className="text-sm font-medium">
                            {entry.row.legalName || "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {entry.row.employeeNumber || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-amber-700">
                            {entry.blockingErrors.join(" ")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {readyRows.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Will Be Created ({readyRows.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee #</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Position</TableHead>
                        <TableHead>Start Date</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {readyRows.map((entry, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-sm">{entry.row.employeeNumber}</TableCell>
                          <TableCell className="text-sm font-medium">
                            {entry.row.preferredName}
                          </TableCell>
                          <TableCell className="text-sm">{entry.row.department}</TableCell>
                          <TableCell className="text-sm">{entry.row.position}</TableCell>
                          <TableCell className="text-sm">{entry.row.startDate}</TableCell>
                          <TableCell className="text-sm">{entry.row.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(3)}>
                Back
              </Button>
              <Button onClick={commitImport} disabled={readyRows.length === 0 || isCommitting}>
                {isCommitting
                  ? "Importing…"
                  : `Import ${readyRows.length} Employee${readyRows.length === 1 ? "" : "s"}`}
                <CheckCircle2 className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 5 && results && (
          <Card className="border-green-200">
            <CardHeader className="bg-green-500/10 pb-4 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-2" />
              <CardTitle className="text-green-700 text-2xl">Import Complete</CardTitle>
              <CardDescription>Successfully processed {file?.name}</CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="p-4 border rounded-xl bg-background shadow-sm">
                  <div className="text-4xl font-display font-bold text-primary">
                    {results.created}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Employees Created</div>
                </div>
                <div className="p-4 border rounded-xl bg-background shadow-sm">
                  <div className="text-4xl font-display font-bold text-muted-foreground">
                    {results.skipped.length}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Skipped</div>
                </div>
              </div>

              {results.skipped.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.skipped.map((entry, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-sm text-muted-foreground">
                          {entry.row._sourceSheet} · Row {entry.row._sourceRowIndex}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {entry.row.legalName || "—"}
                        </TableCell>
                        <TableCell className="text-sm text-amber-700">{entry.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            <CardFooter className="flex justify-center gap-4 pb-8">
              <Button asChild>
                <Link
                  to="/staff/employees"
                  search={{
                    page: 1,
                    q: "",
                    status: "",
                    department: "",
                    location: "",
                    project: "",
                    manager: "",
                    employmentType: "",
                  }}
                >
                  View Directory
                </Link>
              </Button>
              <Button variant="outline" onClick={resetWizard}>
                Import Another File
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === 1 && (
          <Button
            variant="ghost"
            className="self-start"
            onClick={() =>
              navigate({
                to: "/staff/employees",
                search: { page: 1, q: "", status: "", department: "", location: "" },
              } as any)
            }
          >
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Directory
          </Button>
        )}
      </div>
    </RequirePermission>
  );
}
