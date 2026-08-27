import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useMemo } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Download,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
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
  ImportService,
  type SheetPreview,
  type ImportMapping,
  STANDARD_FIELDS,
  type CandidateStandardField,
  type NormalizedCandidateRow,
  type DuplicateConflict,
  type ConflictResolution,
} from "@/lib/data/import-service";
import { CandidateService } from "@/lib/data/candidate-service";
import { useCurrentUser } from "@/lib/auth";

export const Route = createFileRoute("/staff/candidates/import")({
  component: ImportWizard,
});

function ImportWizard() {
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [importService] = useState(() => new ImportService());
  const [candidateService] = useState(() => new CandidateService());

  // State
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetPreview[]>([]);
  const [selectedSheetNames, setSelectedSheetNames] = useState<string[]>([]);

  const [mappings, setMappings] = useState<Record<string, ImportMapping>>({});

  const [normalizedData, setNormalizedData] = useState<NormalizedCandidateRow[]>([]);
  const [newCandidates, setNewCandidates] = useState<NormalizedCandidateRow[]>([]);
  const [conflicts, setConflicts] = useState<DuplicateConflict[]>([]);

  const [results, setResults] = useState<{
    inserted: number;
    updated: number;
    skipped: number;
  } | null>(null);

  const resetWizard = () => {
    setStep(1);
    setFile(null);
    setSheets([]);
    setSelectedSheetNames([]);
    setMappings({});
    setNormalizedData([]);
    setNewCandidates([]);
    setConflicts([]);
    setResults(null);
  };

  // Step 1: Upload
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      const f = acceptedFiles[0];
      if (!f) return;
      setFile(f);

      try {
        const parsedSheets = await importService.parseWorkbook(f);
        setSheets(parsedSheets);
        setSelectedSheetNames(parsedSheets.map((s) => s.name));

        // Auto map each sheet
        const initialMappings: Record<string, ImportMapping> = {};
        for (const s of parsedSheets) {
          initialMappings[s.name] = importService.autoMapHeaders(s.headers);
        }
        setMappings(initialMappings);

        setStep(2);
      } catch (e) {
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

  // Step 2 -> 3
  const proceedToMapping = () => {
    if (selectedSheetNames.length === 0) {
      toast.error("Select at least one sheet to import.");
      return;
    }
    setStep(3);
  };

  // Step 3 -> 4
  const processNormalization = () => {
    let allNormalized: NormalizedCandidateRow[] = [];

    for (const sheetName of selectedSheetNames) {
      const sheet = sheets.find((s) => s.name === sheetName);
      if (!sheet) continue;

      const mapping = mappings[sheetName] || {};
      const sheetNormalized = importService.normalizeData(
        sheet.rows,
        sheetName,
        mapping,
        sheet.headerRowNumber,
      );
      allNormalized = [...allNormalized, ...sheetNormalized];
    }

    setNormalizedData(allNormalized);

    const { newCandidates, conflicts } = importService.detectDuplicates(
      allNormalized,
      candidateService,
    );
    setNewCandidates(newCandidates);
    setConflicts(conflicts);

    setStep(4);
  };

  // Step 4 -> 5
  const commitImport = () => {
    try {
      const res = importService.commitImportBatch(newCandidates, conflicts, candidateService, {
        ...currentUser.getActorContext(),
        reason: "Committed reviewed candidate spreadsheet import",
      });
      setResults(res);
      setStep(5);
    } catch (e) {
      toast.error("Failed to commit import.");
    }
  };

  const updateConflictResolution = (
    index: number,
    resolution: "merge" | "skip" | "create_separate",
  ) => {
    const updated = [...conflicts];
    if (updated[index]) {
      updated[index].resolution = resolution;
    }
    setConflicts(updated);
  };

  return (
    <div className="flex h-full flex-col gap-6 p-6 max-w-6xl mx-auto">
      <div>
        <h1 className="font-display text-2xl font-semibold">Import Candidates</h1>
        <p className="text-sm text-muted-foreground">
          Import candidate data from XLSX or CSV spreadsheets.
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-4 text-sm font-medium">
        <Badge variant={step >= 1 ? "default" : "outline"}>1. Upload</Badge>{" "}
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <Badge variant={step >= 2 ? "default" : "outline"}>2. Select Sheets</Badge>{" "}
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <Badge variant={step >= 3 ? "default" : "outline"}>3. Map Columns</Badge>{" "}
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <Badge variant={step >= 4 ? "default" : "outline"}>4. Review & Merge</Badge>{" "}
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
        <Badge variant={step === 5 ? "default" : "outline"}>5. Results</Badge>
      </div>

      {/* STEP 1 */}
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

      {/* STEP 2 */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Select Sheets</CardTitle>
            <CardDescription>
              We detected {sheets.length} sheets in {file?.name}. Select which ones to import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sheets.map((sheet) => (
              <div key={sheet.name} className="flex items-center space-x-3 p-3 border rounded-lg">
                <Checkbox
                  id={`sheet-${sheet.name}`}
                  checked={selectedSheetNames.includes(sheet.name)}
                  onCheckedChange={(c) => {
                    if (c) setSelectedSheetNames((prev) => [...prev, sheet.name]);
                    else setSelectedSheetNames((prev) => prev.filter((n) => n !== sheet.name));
                  }}
                />
                <div className="grid gap-1.5 leading-none">
                  <label
                    htmlFor={`sheet-${sheet.name}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
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

      {/* STEP 3 */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Map Columns</CardTitle>
            <CardDescription>
              Match your spreadsheet columns to the database fields.
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
                          <label className="text-sm font-medium">{field.label}</label>
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

      {/* STEP 4 */}
      {step === 4 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Ready to Import</CardTitle>
              <CardDescription>
                We found {newCandidates.length} new candidates and {conflicts.length} duplicates
                across {normalizedData.length} valid rows.
              </CardDescription>
            </CardHeader>
          </Card>

          {conflicts.length > 0 && (
            <Card className="border-amber-200">
              <CardHeader className="bg-amber-500/10 pb-4">
                <CardTitle className="text-amber-700 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" /> Resolve Duplicates ({conflicts.length})
                </CardTitle>
                <CardDescription>
                  These rows appear to already exist in the database.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Imported Data</TableHead>
                      <TableHead>Existing Match</TableHead>
                      <TableHead>Resolution</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conflicts.map((conflict, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="bg-amber-500/10 text-amber-700 border-amber-200"
                          >
                            {conflict.type.replace("_", " ").toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">
                            {conflict.importedCandidate.firstName}{" "}
                            {conflict.importedCandidate.lastName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {conflict.importedCandidate.email}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {conflict.importedCandidate.currentCompany}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">
                            {conflict.existingCandidate.firstName}{" "}
                            {conflict.existingCandidate.lastName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {conflict.existingCandidate.email}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {conflict.existingCandidate.currentCompany}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={conflict.resolution || "skip"}
                            onValueChange={(value) =>
                              updateConflictResolution(idx, value as ConflictResolution)
                            }
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="skip">Skip</SelectItem>
                              <SelectItem value="merge">Merge Data</SelectItem>
                              <SelectItem value="create_separate">Create New</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
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
            <Button onClick={commitImport}>
              Commit Import <CheckCircle2 className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* STEP 5 */}
      {step === 5 && results && (
        <Card className="border-green-200">
          <CardHeader className="bg-green-500/10 pb-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-2" />
            <CardTitle className="text-green-700 text-2xl">Import Complete</CardTitle>
            <CardDescription>Successfully processed {file?.name}</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-4 border rounded-xl bg-background shadow-sm">
                <div className="text-4xl font-display font-bold text-primary">
                  {results.inserted}
                </div>
                <div className="text-sm text-muted-foreground mt-1">Candidates Created</div>
              </div>
              <div className="p-4 border rounded-xl bg-background shadow-sm">
                <div className="text-4xl font-display font-bold text-blue-600">
                  {results.updated}
                </div>
                <div className="text-sm text-muted-foreground mt-1">Merged Updates</div>
              </div>
              <div className="p-4 border rounded-xl bg-background shadow-sm">
                <div className="text-4xl font-display font-bold text-muted-foreground">
                  {results.skipped}
                </div>
                <div className="text-sm text-muted-foreground mt-1">Skipped Duplicates</div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-center gap-4 pb-8">
            <Button asChild>
              <Link to="/staff/candidates">View Candidate Database</Link>
            </Button>
            <Button variant="outline" onClick={resetWizard}>
              Import Another File
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
