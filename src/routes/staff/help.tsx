import { SafeForm } from "@/components/ui/safe-form";
import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import { helpArticles } from "@/lib/help/catalog";
import { canReadHrGuide, searchHelp, visibleArticles } from "@/lib/help/guide";
import { PageSections, SectionNavigation, SectionLink } from "@/components/ui/page-sections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArticleWalkthrough } from "@/components/help/article-walkthrough";
import { helpStart, helpWalkthroughs } from "@/lib/help/walkthroughs";

export const Route = createFileRoute("/staff/help")({
  validateSearch: (search: Record<string, unknown>) => ({
    guide:
      search["guide"] === "hr"
        ? ("hr" as const)
        : search["guide"] === "employee"
          ? ("employee" as const)
          : undefined,
    article: typeof search["article"] === "string" ? search["article"].slice(0, 100) : "",
    topic: typeof search["topic"] === "string" ? search["topic"].slice(0, 100) : "",
    q: typeof search["q"] === "string" ? search["q"].slice(0, 200) : "",
  }),
  component: HelpPage,
});

function HelpPage() {
  const user = useCurrentUser();
  // A role switch discards the previous guide, query and selected article immediately.
  return <HelpWorkspace key={user.activeRole} />;
}

function HelpWorkspace() {
  const user = useCurrentUser();
  const params = Route.useSearch();
  const navigate = Route.useNavigate();
  const hr = canReadHrGuide(user.activeRole);
  const guide = hr ? (params.guide ?? "hr") : "employee";
  const articles = visibleArticles(helpArticles, guide, user.activeRole);
  const categories = [...new Set(articles.map((item) => item.category))];
  const selected = articles.find((item) => item.id === params.article);
  const starter = helpStart(hr && guide === "employee" ? "Employee" : user.activeRole);
  const startingArticles = starter.ids.flatMap(
    (id) => articles.find((item) => item.id === id) ?? [],
  );
  const walkthrough = selected ? helpWalkthroughs[selected.id] : undefined;
  const topic = categories.includes(params.topic) ? params.topic : "";
  const [query, setQuery] = useState(params.q);
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setQuery(params.q);
  }, [params.q]);
  useEffect(() => {
    setCopied(false);
    if (params.article) heading.current?.focus({ preventScroll: true });
  }, [params.article]);
  // Normalise tampered or bookmarked HR links without rendering privileged guide content.
  useEffect(() => {
    if (!hr && params.guide === "hr") {
      void navigate({
        search: { guide: "employee", article: "", topic: "", q: "" },
        replace: true,
      });
    }
  }, [hr, params.guide, navigate]);

  const list = searchHelp(articles, params.q).filter((item) => !topic || item.category === topic);
  const open = (id: string) => ({ guide, article: id, topic: "", q: "" });
  const goTopic = (value: string) => {
    void navigate({ search: { guide, article: "", topic: value === "all" ? "" : value, q: "" } });
  };
  const canOpen =
    selected &&
    (!selected.permission || user.can(selected.permission)) &&
    (selected.path !== "/staff/audit" || user.activeRole === "Super Admin");

  return (
    <div className="mx-auto w-full max-w-6xl space-y-7 pb-12">
      <header className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              VIA HR guides
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Help & Knowledge</h1>
          </div>
          {hr && (
            <label className="flex items-center gap-3 text-sm">
              <span className="sr-only">Choose your guide</span>
              <select
                aria-label="Choose your guide"
                value={guide}
                className="min-h-11 rounded-xl border bg-background px-3 pr-8 font-medium"
                onChange={(event) =>
                  void navigate({
                    search: {
                      guide: event.target.value === "hr" ? "hr" : "employee",
                      article: "",
                      topic: "",
                      q: "",
                    },
                  })
                }
              >
                <option value="employee">Employee guide</option>
                <option value="hr">HR guide · includes employee help</option>
              </select>
            </label>
          )}
        </div>
        <SafeForm
          role="search"
          aria-label="Search help"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate({ search: { guide, q: query.trim(), topic: "", article: "" } });
          }}
          className="flex items-center gap-2 rounded-2xl border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-primary/20"
        >
          <Search className="ml-3 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={searchInput}
            aria-label="Search help articles"
            maxLength={200}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="What would you like to do?"
            className="h-11 min-w-0 border-0 bg-transparent px-2 text-base shadow-none focus-visible:ring-0"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                void navigate({ search: { guide, article: "", topic: "", q: "" } });
                searchInput.current?.focus();
              }}
            >
              <X className="size-4" />
            </Button>
          )}
          <Button type="submit" className="min-h-11 rounded-xl">
            Search
          </Button>
        </SafeForm>
      </header>

      <PageSections value={selected?.category ?? (topic || "all")} onValueChange={goTopic}>
        <SectionNavigation restoreHash={false}>
          <SectionLink value="all" onClick={(event) => event.preventDefault()}>
            All help topics
          </SectionLink>
          {categories.map((category) => (
            <SectionLink
              key={category}
              value={category}
              onClick={(event) => event.preventDefault()}
            >
              {category}
            </SectionLink>
          ))}
        </SectionNavigation>
        <div className="min-w-0 space-y-6">
          {selected ? (
            <>
              <Link
                to="/staff/help"
                search={{ guide, article: "", topic: selected.category, q: "" }}
                className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
              >
                <ArrowLeft className="size-4" /> {selected.category}
              </Link>
              <article className="overflow-hidden rounded-2xl border bg-card">
                <div className="border-b p-6 sm:p-8">
                  <div className="mb-3 flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground">
                    {selected.guide === "hr" ? (
                      <ShieldCheck className="size-4 text-primary" />
                    ) : (
                      <BookOpen className="size-4 text-primary" />
                    )}
                    <span>{selected.guide === "hr" ? "HR guide" : "Employee guide"}</span>
                    <span>·</span>
                    <span>{selected.category}</span>
                  </div>
                  <h2
                    ref={heading}
                    tabIndex={-1}
                    className="text-2xl font-semibold tracking-tight focus:outline-none"
                  >
                    {selected.title}
                  </h2>
                  <p className="mt-3 max-w-3xl leading-relaxed text-muted-foreground">
                    {selected.summary}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    {canOpen && (
                      <a
                        href={selected.path}
                        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
                      >
                        Open in VIA HR <ArrowRight className="size-4" />
                      </a>
                    )}
                    <Button
                      variant="outline"
                      className="min-h-11 rounded-xl"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(window.location.href);
                          setCopied(true);
                        } catch {
                          setCopied(false);
                          toast.error(
                            "Could not copy the link. You can copy the address from your browser instead.",
                          );
                        }
                      }}
                    >
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      {copied ? "Link copied" : "Copy article link"}
                    </Button>
                  </div>
                  {!canOpen && (
                    <p className="mt-4 text-sm text-muted-foreground">
                      The responsible role must open this page. Reading this guide does not change
                      your access.
                    </p>
                  )}
                </div>
                <div className="space-y-8 p-6 sm:p-8">
                  {walkthrough && (
                    <ArticleWalkthrough
                      key={selected.id}
                      walkthrough={walkthrough}
                      title={selected.title}
                    />
                  )}
                  <section aria-labelledby="help-steps">
                    <h3 id="help-steps" className="mb-5 font-semibold">
                      Step by step
                    </h3>
                    <ol className="space-y-5">
                      {selected.steps.map((step, index) => (
                        <li key={step} className="flex gap-4">
                          <span
                            aria-hidden="true"
                            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                          >
                            {index + 1}
                          </span>
                          <p className="max-w-3xl pt-1 text-sm leading-7 sm:text-base">{step}</p>
                        </li>
                      ))}
                    </ol>
                  </section>
                  <section className="rounded-xl bg-primary/5 p-5" aria-labelledby="help-next">
                    <h3 id="help-next" className="mb-2 font-semibold">
                      What happens next
                    </h3>
                    <p className="max-w-3xl text-sm leading-7">{selected.after}</p>
                  </section>
                  <section aria-labelledby="help-checks">
                    <h3 id="help-checks" className="mb-3 font-semibold">
                      Things to check
                    </h3>
                    <ul className="list-disc space-y-3 pl-5 text-sm leading-7 text-muted-foreground">
                      {selected.checks.map((check) => (
                        <li key={check}>{check}</li>
                      ))}
                    </ul>
                  </section>
                </div>
              </article>
              <section aria-label="Related help" className="space-y-3">
                <h3 className="font-semibold">Related help</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {articles
                    .filter(
                      (item) => item.category === selected.category && item.id !== selected.id,
                    )
                    .slice(0, 4)
                    .map((item) => (
                      <Link
                        key={item.id}
                        to="/staff/help"
                        search={open(item.id)}
                        className="flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-background p-4 text-sm font-medium hover:border-primary/40"
                      >
                        {item.title}
                        <ChevronRight className="size-4 shrink-0" />
                      </Link>
                    ))}
                  <Link
                    to="/staff/help"
                    search={open("help-problem")}
                    className="flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-background p-4 text-sm font-medium hover:border-primary/40"
                  >
                    Still need help?
                    <ChevronRight className="size-4 shrink-0" />
                  </Link>
                </div>
              </section>
            </>
          ) : (
            <>
              {params.article && (
                <p role="status" className="rounded-xl border p-4 text-sm">
                  This article is not available in your selected guide. Choose a topic or search
                  below.
                </p>
              )}
              {!topic && !params.q && !params.article ? (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-semibold">
                      {guide === "hr"
                        ? "HR and employee help"
                        : user.activeRole === "Accounts"
                          ? "Finance and employee help"
                          : user.activeRole === "Line Manager"
                            ? "Manager and employee help"
                            : user.activeRole === "IT"
                              ? "IT and employee help"
                              : "Employee help"}
                    </h2>
                    <p className="text-sm text-muted-foreground">Practical answers, step by step</p>
                  </div>
                  <section
                    aria-label="First-use checklist"
                    className="rounded-2xl border bg-card p-5 sm:p-6"
                  >
                    <h2 className="mb-2 font-semibold">{starter.title}</h2>
                    <p className="mb-4 text-sm text-muted-foreground">
                      New here? Follow these guides in order. Nothing is submitted by opening a
                      guide.
                    </p>
                    <ol className="grid gap-2 sm:grid-cols-2">
                      {startingArticles.map((item, index) => (
                        <li key={item.id}>
                          <Link
                            to="/staff/help"
                            search={open(item.id)}
                            className="flex min-h-14 items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm hover:border-primary/20 hover:bg-primary/5"
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                              {index + 1}
                            </span>
                            <span className="flex-1">{item.title}</span>
                            <ArrowRight className="size-4 shrink-0 text-primary" />
                          </Link>
                        </li>
                      ))}
                    </ol>
                  </section>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {categories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => goTopic(category)}
                        className="group rounded-2xl border bg-card p-5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <div className="mb-4 flex items-center justify-between">
                          <BookOpen className="size-5 text-primary" />
                          <ChevronRight className="size-4 text-muted-foreground group-hover:text-primary" />
                        </div>
                        <h3 className="font-semibold">{category}</h3>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {articles.filter((item) => item.category === category).length} guides
                        </p>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold">
                      {params.q ? `Results for “${params.q}”` : topic || "All help topics"}
                    </h2>
                    <span
                      role="status"
                      aria-live="polite"
                      className="text-sm text-muted-foreground"
                    >
                      {list.length} {list.length === 1 ? "guide" : "guides"}
                    </span>
                  </div>
                  {list.length ? (
                    <div className="divide-y rounded-2xl border bg-card">
                      {list.map((item) => (
                        <Link
                          key={item.id}
                          to="/staff/help"
                          search={open(item.id)}
                          className="flex items-start justify-between gap-4 p-5 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-muted/50 sm:p-6"
                        >
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-primary">
                              {item.category} · {item.guide === "hr" ? "HR" : "Employee"}
                            </p>
                            <h3 className="font-semibold">{item.title}</h3>
                            <p className="text-sm leading-6 text-muted-foreground">
                              {item.summary}
                            </p>
                          </div>
                          <ChevronRight className="mt-6 size-4 shrink-0 text-muted-foreground" />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border bg-background p-8 text-center">
                      <Search className="mx-auto mb-4 size-7 text-primary" />
                      <h3 className="font-semibold">Let’s try another search</h3>
                      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                        Try a short phrase such as “forgot clock out”, “leave balance” or “upload
                        CV”.
                      </p>
                      <Button className="mt-5" variant="outline" onClick={() => goTopic("all")}>
                        Browse all topics
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </PageSections>
    </div>
  );
}
