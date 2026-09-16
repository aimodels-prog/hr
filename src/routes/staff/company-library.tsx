import { useState } from "react";
import {
  PageSections,
  SectionNavigation,
  SectionLink,
  SectionPanel,
} from "@/components/ui/page-sections";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  getCompanyLibraryFn,
  uploadCompanyDocumentFn,
  downloadCompanyDocumentFn,
  prepareCompanyDocumentFn,
  getCompanyDocumentPagesFn,
  publishCompanyDocumentFn,
  withdrawCompanyDocumentFn,
  askCompanyPoliciesFn,
} from "@/lib/server-functions/company-library.server";

export const Route = createFileRoute("/staff/company-library")({ component: CompanyLibraryScope });
function CompanyLibraryScope() {
  const user = useCurrentUser();
  return <CompanyLibrary key={`${user.id}:${user.activeRole}`} />;
}
type Document = Awaited<ReturnType<typeof getCompanyLibraryFn>>[number];
type Answer = Awaited<ReturnType<typeof askCompanyPoliciesFn>>;
function CompanyLibrary() {
  const user = useCurrentUser();
  const hr = ["HR", "Super Admin"].includes(user.activeRole);
  const actor = {
    actorId: user.id,
    ...(user.workspaceEmail ? { actorEmail: user.workspaceEmail } : {}),
    activeRole: user.activeRole,
  };
  const [tab, setTab] = useState("Library");
  const [open, setOpen] = useState(false);
  const [prior, setPrior] = useState<Document | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("SOP");
  const [kind, setKind] = useState<"Library" | "Company">("Library");
  const [audience, setAudience] = useState<"All staff" | "HR only">("All staff");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Document | null>(null);
  const [pages, setPages] = useState<{ page: number; text: string }[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<{ question: string; answer: Answer }[]>([]);
  const query = useQuery({
    queryKey: ["company-library", user.id, user.activeRole],
    queryFn: () => getCompanyLibraryFn({ data: { actor } }),
    retry: false,
  });
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };
  const upload = () =>
    run(async () => {
      if (!file) return;
      if (file.size > 10 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf"))
        throw new Error("Choose a PDF up to 10 MB.");
      await uploadCompanyDocumentFn({
        data: {
          actor,
          title,
          category,
          kind,
          audience,
          ...(prior ? { familyId: prior.familyId } : {}),
          ...(issueDate ? { issueDate } : {}),
          ...(!noExpiry && expiryDate ? { expiryDate } : {}),
          name: file.name,
          bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
        },
      });
      setOpen(false);
      setTab(kind);
      await query.refetch();
      toast.success("Draft uploaded. Review it before publishing.");
    });
  const download = (doc: Document) =>
    run(async () => {
      const result = await downloadCompanyDocumentFn({ data: { actor, id: doc.id } });
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(result.bytes)], { type: "application/pdf" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = result.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const startUpload = (doc?: Document) => {
    setPrior(doc ?? null);
    setTitle(doc?.title ?? "");
    setCategory(doc?.category ?? "SOP");
    setKind((doc?.kind as "Library" | "Company") ?? "Library");
    setAudience((doc?.audience as "All staff" | "HR only") ?? "All staff");
    setIssueDate("");
    setExpiryDate("");
    setNoExpiry(false);
    setFile(null);
    setOpen(true);
  };
  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Policies & Company Documents</h1>
          <p className="text-sm text-muted-foreground">
            Current guidance, original documents and renewal dates.
          </p>
        </div>
        {hr && <Button onClick={() => startUpload()}>Upload document</Button>}
      </header>
      <PageSections value={tab} onValueChange={setTab}>
        <SectionNavigation>
          {["Library", "Ask policies", ...(hr ? ["Company"] : [])].map((value) => (
            <SectionLink key={value} value={value}>
              {value === "Library"
                ? "SOPs & Policies"
                : value === "Company"
                  ? "Company register"
                  : "Ask VIA Policies"}
            </SectionLink>
          ))}
        </SectionNavigation>
        <SectionPanel value={tab}>
          {query.isError && (
            <p role="alert">
              Documents could not be loaded.{" "}
              <Button onClick={() => void query.refetch()}>Retry</Button>
            </p>
          )}
          {query.isPending && <p role="status">Loading documents…</p>}
          {tab === "Ask policies" ? (
            <section className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ask about published policies you can access. Answers include supporting passages. AI
                can make mistakes; check the cited PDF or ask HR. This does not approve requests.
                Each question is independent; this conversation is not saved.
              </p>
              <Label htmlFor="policy-question">Your question</Label>
              <Textarea
                id="policy-question"
                value={question}
                maxLength={2000}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="What is the procedure for reporting sick leave?"
              />
              <Button
                disabled={busy || question.trim().length < 5}
                onClick={() =>
                  void run(async () => {
                    const answer = await askCompanyPoliciesFn({ data: { actor, question } });
                    setHistory((previous) => [...previous, { question, answer }]);
                    setQuestion("");
                  })
                }
              >
                {busy ? "Checking policies…" : "Ask"}
              </Button>
              {history.map((item, index) => (
                <article key={index} className="space-y-3 rounded-xl border p-4">
                  <h2 className="font-medium">{item.question}</h2>
                  {!item.answer.answers.length && (
                    <p>
                      I could not find a supported answer in the available policy excerpts. Please
                      ask HR.
                    </p>
                  )}
                  {item.answer.answers.map((answer, i) => {
                    const source = item.answer.sources.find(
                      (source) => source.id === answer.documentId && source.page === answer.page,
                    );
                    const doc = query.data?.find((doc) => doc.id === answer.documentId);
                    return (
                      <div key={i}>
                        <p className="whitespace-pre-wrap">{answer.text}</p>
                        <blockquote className="my-2 border-l-2 pl-3 text-sm text-muted-foreground">
                          {answer.quote}
                        </blockquote>
                        <Button
                          variant="link"
                          disabled={!doc || busy}
                          onClick={() => doc && void download(doc)}
                        >
                          {source?.title} · v{source?.version} · page {answer.page}
                        </Button>
                      </div>
                    );
                  })}
                </article>
              ))}
            </section>
          ) : (
            <section className="space-y-3">
              {tab === "Company" && (
                <p className="text-sm text-muted-foreground">
                  Restricted to HR. Expiry reminders go to HR at 90, 60, 30 and 7 days, and on
                  expiry. Company files are never included in staff policy answers.
                </p>
              )}
              {query.data?.filter((doc) => doc.kind === tab).length === 0 && (
                <p>No documents available yet.</p>
              )}
              {query.data
                ?.filter((doc) => doc.kind === tab)
                .map((doc) => (
                  <article key={doc.id} className="space-y-3 rounded-xl border p-4">
                    <div>
                      <h2 className="font-semibold">
                        {doc.title}{" "}
                        <span className="text-sm text-muted-foreground">v{doc.version}</span>
                      </h2>
                      <p className="text-sm">
                        {doc.category} · {doc.status} · {doc.audience}
                      </p>
                      {doc.kind === "Library" && (
                        <p className="text-xs text-muted-foreground">AI: {doc.processing}</p>
                      )}
                      {doc.kind === "Company" && (
                        <p className="text-sm">
                          Issued: {doc.issueDate ?? "Not recorded"} · Expiry:{" "}
                          {doc.expiryDate ?? "No expiry"}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" disabled={busy} onClick={() => void download(doc)}>
                        Download PDF
                      </Button>
                      {hr && (
                        <>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => startUpload(doc)}
                          >
                            New version
                          </Button>
                          {doc.status === "Draft" && doc.kind === "Library" && (
                            <>
                              <Button
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    const extracted = await prepareCompanyDocumentFn({
                                      data: { actor, id: doc.id },
                                    });
                                    setPages(extracted);
                                    setReview(doc);
                                    setConfirmed(false);
                                    await query.refetch();
                                  })
                                }
                              >
                                Prepare for AI
                              </Button>
                              <Button
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    const existing = await getCompanyDocumentPagesFn({
                                      data: { actor, id: doc.id },
                                    });
                                    setPages(existing.length ? existing : [{ page: 1, text: "" }]);
                                    setReview(doc);
                                    setConfirmed(false);
                                  })
                                }
                              >
                                Review page text
                              </Button>
                            </>
                          )}
                          {doc.status === "Draft" && doc.kind === "Company" && (
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await publishCompanyDocumentFn({ data: { actor, id: doc.id } });
                                  await query.refetch();
                                })
                              }
                            >
                              Publish to register
                            </Button>
                          )}
                          {doc.status === "Published" && (
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await withdrawCompanyDocumentFn({ data: { actor, id: doc.id } });
                                  await query.refetch();
                                })
                              }
                            >
                              Withdraw
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                ))}
            </section>
          )}
        </SectionPanel>
      </PageSections>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg">
          <DialogHeader>
            <DialogTitle>{prior ? "Upload new version" : "Upload document"}</DialogTitle>
            <DialogDescription>
              PDF up to 10 MB. Originals remain protected. Policies can be sent to the configured
              Gemini service for text preparation. Nothing is shared with staff until HR publishes
              it.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="doc-title">Document name</Label>
          <Input id="doc-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <Label htmlFor="doc-kind">Document area</Label>
          <select
            id="doc-kind"
            disabled={!!prior}
            value={kind}
            onChange={(event) => setKind(event.target.value as "Library" | "Company")}
            className="h-10 rounded-md border bg-background"
          >
            <option value="Library">SOP or policy</option>
            <option value="Company">Company document</option>
          </select>
          <Label htmlFor="doc-category">Category</Label>
          <Input
            id="doc-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="SOP, policy, registration, insurance…"
          />
          {kind === "Library" ? (
            <>
              <Label htmlFor="doc-audience">Who can read it?</Label>
              <select
                id="doc-audience"
                value={audience}
                onChange={(event) => setAudience(event.target.value as "All staff" | "HR only")}
                className="h-10 rounded-md border bg-background"
              >
                <option>All staff</option>
                <option>HR only</option>
              </select>
            </>
          ) : (
            <>
              <Label htmlFor="doc-issued">Issue date (optional)</Label>
              <Input
                id="doc-issued"
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={noExpiry}
                  onChange={(event) => setNoExpiry(event.target.checked)}
                />
                No expiry date
              </label>
              {!noExpiry && (
                <>
                  <Label htmlFor="doc-expiry">Expiry date</Label>
                  <Input
                    id="doc-expiry"
                    type="date"
                    min={issueDate}
                    value={expiryDate}
                    onChange={(event) => setExpiryDate(event.target.value)}
                  />
                </>
              )}
            </>
          )}
          <Label htmlFor="doc-file">Original PDF</Label>
          <Input
            id="doc-file"
            type="file"
            accept=".pdf,application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Button
            disabled={
              busy ||
              !file ||
              title.trim().length < 3 ||
              category.trim().length < 2 ||
              (kind === "Company" && !noExpiry && !expiryDate)
            }
            onClick={() => void upload()}
          >
            {busy ? "Saving…" : "Save draft"}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!review}
        onOpenChange={(value) => {
          if (!value && !busy) setReview(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review policy text</DialogTitle>
            <DialogDescription>
              Compare every page with the original PDF. Correct extraction errors before
              publication. Only this verified text is used for answers; the original file is never
              replaced.
            </DialogDescription>
          </DialogHeader>
          {pages.map((page, index) => (
            <div key={index}>
              <Label htmlFor={`page-${index}`}>PDF page {page.page}</Label>
              <Textarea
                id={`page-${index}`}
                className="min-h-40"
                value={page.text}
                onChange={(event) =>
                  setPages((previous) =>
                    previous.map((item, i) =>
                      i === index ? { ...item, text: event.target.value } : item,
                    ),
                  )
                }
              />
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() =>
              setPages((previous) => [
                ...previous,
                { page: Math.max(0, ...previous.map((page) => page.page)) + 1, text: "" },
              ])
            }
          >
            Add missing page
          </Button>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I checked the text and page numbers against the original and approve this version for
            the selected audience.
          </label>
          <Button
            disabled={busy || !confirmed}
            onClick={() =>
              void run(async () => {
                if (!review) return;
                await publishCompanyDocumentFn({ data: { actor, id: review.id, pages } });
                setReview(null);
                await query.refetch();
                toast.success("Policy published. Previous published versions are superseded.");
              })
            }
          >
            Confirm & publish
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
