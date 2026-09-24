import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none select-none";
const buttonVariants = {
  primary: "bg-primary text-primary-contrast hover:bg-primary-hover shadow-card hover:shadow-card-hover hover:-translate-y-px",
  secondary: "bg-surface text-text border border-border hover:bg-surface-2 hover:border-primary/40",
  ghost: "text-text hover:bg-surface-2",
  danger: "bg-danger text-white hover:opacity-90 shadow-card",
  accent: "bg-accent text-[#1c1605] hover:brightness-105 shadow-card",
};
const buttonSizes = { sm: "h-8 px-3", md: "h-10 px-4", lg: "h-11 px-5 text-base" };

export type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
};

export function Button({ variant = "primary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof buttonVariants; size?: keyof typeof buttonSizes }) {
  return <Link className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)} {...props} />;
}

/** File download (API route returning an attachment). A plain anchor, not next/link: a client-side
 *  router navigation to a non-page response leaves the router stuck and breaks later in-app links. */
export function ButtonDownload({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"a"> & { href: string; variant?: keyof typeof buttonVariants; size?: keyof typeof buttonSizes }) {
  return <a download className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], className)} {...props} />;
}

export function Card({ className, interactive, ...props }: ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface shadow-card",
        interactive && "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover hover:border-primary/40",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-text">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumbs?: { label: string; href?: string }[] }) {
  return (
    <header className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Navigare" className="no-print mb-2 flex flex-wrap items-center gap-1 text-sm text-muted">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>/</span>}
              {b.href ? (
                <Link href={b.href} className="hover:text-primary hover:underline">
                  {b.label}
                </Link>
              ) : (
                <span className="text-text">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-text sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted sm:text-base">{subtitle}</p>}
        </div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

const badgeTones = {
  neutral: "bg-surface-2 text-muted border-border",
  primary: "bg-info-soft text-primary border-primary/20",
  success: "bg-success-soft text-success border-success/20",
  danger: "bg-danger-soft text-danger border-danger/20",
  warning: "bg-warning-soft text-warning border-warning/20",
  accent: "bg-accent-soft text-warning border-accent/30",
};

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: keyof typeof badgeTones }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", badgeTones[tone], className)}
      {...props}
    />
  );
}

export function Alert({ tone = "primary", title, children }: { tone?: "primary" | "success" | "danger" | "warning"; title?: ReactNode; children?: ReactNode }) {
  const tones = {
    primary: "bg-info-soft border-primary/25",
    success: "bg-success-soft border-success/25",
    danger: "bg-danger-soft border-danger/25",
    warning: "bg-warning-soft border-warning/25",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-sm", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1", "text-text/90")}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <p className="font-medium text-text">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("max-h-[70vh] overflow-auto rounded-b-2xl print:max-h-none print:overflow-visible", className)}>{children}</div>;
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{label}</p>
          <p className="tabular mt-1 text-3xl font-bold tracking-tight">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
        </div>
        {icon && <div className="rounded-xl bg-info-soft p-2.5 text-primary">{icon}</div>}
      </div>
    </Card>
  );
}

/** Grade pill with colour by value (≥9 very good, ≥5 passing, <5 failing). */
export function GradePill({ value, muted }: { value: number | null; muted?: boolean }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const tone = value < 5 ? "text-danger bg-danger-soft" : value >= 9 ? "text-success bg-success-soft" : "text-text bg-surface-2";
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
  return <span className={cn("tabular inline-flex min-w-8 justify-center rounded-lg px-2 py-0.5 text-sm font-semibold", tone, muted && "opacity-60")}>{text}</span>;
}

export const inputClass =
  "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-text placeholder:text-muted/70 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-focus/30 disabled:opacity-60";

export function Field({ label, htmlFor, error, hint, children, className }: { label: string; htmlFor?: string; error?: string[] | string; hint?: string; children: ReactNode; className?: string }) {
  const errs = typeof error === "string" ? [error] : error;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-text">
        {label}
      </label>
      {children}
      {hint && !errs?.length && <p className="text-xs text-muted">{hint}</p>}
      {errs?.map((e, i) => (
        <p key={i} className="text-xs text-danger">
          {e}
        </p>
      ))}
    </div>
  );
}
