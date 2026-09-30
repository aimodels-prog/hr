import { useState } from "react";
import { ArrowRight, ZoomIn } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HelpWalkthrough } from "@/lib/help/walkthroughs";

export function ArticleWalkthrough({
  walkthrough,
  title,
}: {
  walkthrough: HelpWalkthrough;
  title: string;
}) {
  const [enlarged, setEnlarged] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const picture = walkthrough.image;
  return (
    <div className="space-y-7">
      <section aria-label="Before you begin" className="rounded-xl border p-5">
        <h3 className="mb-3 font-semibold">Before you begin</h3>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-7">
          {walkthrough.before.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      {walkthrough.flow && (
        <section aria-label="Who does what next">
          <h3 className="mb-3 font-semibold">Who does what next</h3>
          <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {walkthrough.flow.map((step, index) => (
              <li key={step} className="flex items-center gap-2 text-sm">
                <span className="rounded-lg bg-primary/5 px-3 py-3">
                  <span className="mr-2 font-semibold text-primary">{index + 1}.</span>
                  {step}
                </span>
                {index < walkthrough.flow!.length - 1 && (
                  <ArrowRight
                    aria-hidden="true"
                    className="hidden size-4 text-muted-foreground sm:block"
                  />
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {picture && (
        <section aria-label="Screen example" className="space-y-4">
          <div>
            <h3 className="font-semibold">What you will see</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Demo screen · dates and choices are examples, not your records.
            </p>
          </div>
          {imageFailed ? (
            <p role="status" className="text-sm text-muted-foreground">
              The example image could not load. Use the field explanations and steps below.
            </p>
          ) : (
            <figure>
              <button
                type="button"
                onClick={() => setEnlarged(true)}
                aria-label={`Enlarge screen example: ${title}`}
                className="group block w-full overflow-hidden rounded-xl border bg-muted/20 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <img
                  src={`/help/${picture.name}.png`}
                  alt={picture.alt}
                  width={picture.width}
                  height={picture.height}
                  loading="lazy"
                  decoding="async"
                  onError={() => setImageFailed(true)}
                  className="mx-auto h-auto max-h-[34rem] w-auto max-w-full rounded-lg object-contain"
                />
                <span className="mt-3 flex items-center justify-center gap-2 text-xs font-medium text-primary">
                  <ZoomIn className="size-4" /> Enlarge example
                </span>
              </button>
            </figure>
          )}
          {walkthrough.fields && (
            <dl className="divide-y rounded-xl border px-4">
              {walkthrough.fields.map((field) => (
                <div key={field.label} className="py-4">
                  <dt className="text-sm font-semibold">{field.label}</dt>
                  <dd className="mt-1 text-sm leading-7 text-muted-foreground">{field.meaning}</dd>
                </div>
              ))}
            </dl>
          )}
          <Dialog open={enlarged} onOpenChange={setEnlarged}>
            <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] sm:max-w-5xl overflow-auto">
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>
                  Demo example. Follow the instructions for your own records.
                </DialogDescription>
              </DialogHeader>
              <img
                src={`/help/${picture.name}.png`}
                alt={picture.alt}
                width={picture.width}
                height={picture.height}
                className="mx-auto h-auto max-w-full"
              />
            </DialogContent>
          </Dialog>
        </section>
      )}
    </div>
  );
}
