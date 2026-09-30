import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { CircleHelp, Lightbulb, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";
import type { HelpArticle } from "@/lib/help/guide";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Preferences = { hidden?: boolean; dismissed?: string[] };
const Context = createContext<{
  article?: HelpArticle | undefined;
  visible: boolean;
  hidden: boolean;
  dismiss: () => void;
  toggle: () => void;
  restore: () => void;
}>({ visible: false, hidden: false, dismiss() {}, toggle() {}, restore() {} });

export function ContextualHelpProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const href = useRouterState({ select: (state) => state.location.href });
  const preferenceKey = `via_hr:help-tips:v1:${user.id}:${user.activeRole}`;
  const routeKey = `${preferenceKey}:${href}`;
  const [loaded, setLoaded] = useState<{ key: string; article?: HelpArticle | undefined }>();
  const [preferences, setPreferences] = useState<{ key: string; value: Preferences }>();
  useEffect(() => {
    let value: Preferences = {};
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? "{}");
      value = {
        hidden: saved?.hidden === true,
        dismissed: Array.isArray(saved?.dismissed)
          ? saved.dismissed.filter((id: unknown) => typeof id === "string")
          : [],
      };
    } catch {
      /* Tips still work when browser storage is unavailable. */
    }
    setPreferences({ key: preferenceKey, value });
  }, [preferenceKey]);
  useEffect(() => {
    let cancelled = false;
    // Load the guide separately; never hold up the page or organisation data.
    import("@/lib/help/contextual")
      .then(({ contextualArticle }) => {
        if (!cancelled)
          setLoaded({ key: routeKey, article: contextualArticle(href, user.activeRole, user.can) });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key: routeKey });
      });
    return () => {
      cancelled = true;
    };
  }, [routeKey, href, user.activeRole, user.can]);
  const article = loaded?.key === routeKey ? loaded.article : undefined;
  const value = preferences?.key === preferenceKey ? preferences.value : undefined;
  const save = (next: Preferences) => {
    setPreferences({ key: preferenceKey, value: next });
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(next));
    } catch {
      /* Session-only preference. */
    }
  };
  return (
    <Context.Provider
      value={{
        article,
        visible: Boolean(
          article && value && !value.hidden && !value.dismissed?.includes(article.id),
        ),
        hidden: value?.hidden === true,
        dismiss: () => {
          if (article)
            save({ ...value, dismissed: [...new Set([...(value?.dismissed ?? []), article.id])] });
        },
        toggle: () => save({ ...value, hidden: !value?.hidden }),
        restore: () => save({ hidden: false, dismissed: [] }),
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function HelpShortcut() {
  const help = useContext(Context);
  const [open, setOpen] = useState(false);
  const href = useRouterState({ select: (state) => state.location.href });
  const user = useCurrentUser();
  useEffect(() => setOpen(false), [href, user.activeRole, user.id]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-full"
          aria-label="Help for this page"
          title="Help"
        >
          <CircleHelp className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-4 rounded-xl">
        <h2 className="font-semibold">How can we help?</h2>
        {help.article && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{help.article.summary}</p>
            <Link
              to="/staff/help"
              search={{ guide: help.article.guide, article: help.article.id, topic: "", q: "" }}
              onClick={() => setOpen(false)}
              className="block py-2 text-sm font-medium text-primary"
            >
              Guide for this page
            </Link>
          </div>
        )}
        <Link
          to="/staff/help"
          search={{ guide: undefined, article: "", topic: "", q: "" }}
          onClick={() => setOpen(false)}
          className="block py-2 text-sm font-medium text-primary"
        >
          Search all help
        </Link>
        <div className="space-y-2 border-t pt-3">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={!help.hidden} onChange={help.toggle} />
            Show page tips
          </label>
          <button
            type="button"
            onClick={help.restore}
            className="min-h-11 text-xs text-primary underline"
          >
            Show dismissed tips again
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function PageTip() {
  const help = useContext(Context);
  if (!help.visible || !help.article) return null;
  return (
    <aside
      aria-label="Page tip"
      className="mb-4 flex items-start gap-3 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2"
    >
      <Lightbulb aria-hidden="true" className="mt-2 h-4 w-4 shrink-0 text-primary" />
      <p className="flex-1 py-1.5 text-sm text-muted-foreground">
        {help.article.summary}{" "}
        <Link
          to="/staff/help"
          search={{ guide: help.article.guide, article: help.article.id, topic: "", q: "" }}
          className="font-medium text-primary underline underline-offset-2"
        >
          Show me how
        </Link>
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 shrink-0"
        aria-label="Dismiss tip"
        onClick={help.dismiss}
      >
        <X className="h-4 w-4" />
      </Button>
    </aside>
  );
}
