import * as React from "react";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string | undefined;
  breadcrumbs?: { label: string; href?: string | undefined }[] | undefined;
  actions?: React.ReactNode | undefined;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-5 pb-7 pt-1 md:flex-row md:items-end md:justify-between",
        className,
      )}
      {...props}
    >
      <div className="flex max-w-3xl flex-col gap-2.5">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav
            aria-label="Breadcrumb"
            className="flex items-center space-x-1 text-xs font-medium text-muted-foreground"
          >
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <div key={crumb.label} className="flex items-center">
                  {crumb.href && !isLast ? (
                    <Link to={crumb.href} className="hover:text-foreground">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={isLast ? "text-foreground font-medium" : ""}>
                      {crumb.label}
                    </span>
                  )}
                  {!isLast && <ChevronRight className="h-4 w-4 mx-1" />}
                </div>
              );
            })}
          </nav>
        )}
        <div className="space-y-1">
          <h1 className="font-display text-3xl font-bold tracking-[-0.035em] text-foreground sm:text-[2rem]">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
