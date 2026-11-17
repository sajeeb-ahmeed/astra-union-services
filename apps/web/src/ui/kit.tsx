import React from "react";
import "./tokens.css";
import "./kit.css";

/** Phase 1 component kit. Small, presentational, no data fetching; pages compose them. */

export function TitleBand({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="ax-title-band">
      <div className="ax-container">
        {eyebrow && <span className="ax-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {children}
      </div>
    </section>
  );
}

export function StatCard({
  value,
  label,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
}) {
  return (
    <div className="ax-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function ServiceTile({
  number,
  name,
  href,
  icon,
}: {
  number: number;
  name: React.ReactNode;
  href: string;
  icon?: React.ReactNode;
}) {
  return (
    <a className="ax-tile" href={href} data-service={number}>
      <span className="ax-tile-number" aria-hidden="true">
        {number}
      </span>
      {icon && <span className="ax-tile-icon">{icon}</span>}
      <span className="ax-tile-name">{name}</span>
    </a>
  );
}

export function RailPanel({
  title,
  children,
  id,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className="ax-rail-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {children}
    </section>
  );
}

export function StatusPill({ children }: { children: React.ReactNode }) {
  return <span className="ax-pill">{children}</span>;
}

/**
 * The one empty-state treatment (UIUX-FIX-01 #14): an icon, one line saying
 * what happened, an optional hint, and the primary recovery action. Replaces
 * the former .empty-state / .ax-home-empty / .service-empty /
 * .application-empty / .ax-dashboard-empty variants.
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="ax-empty-state">
      <span className="ax-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 21 21" />
        </svg>
      </span>
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

/** Shimmer placeholder rows shown while a table or list is loading. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="ax-skeleton" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="ax-skeleton-row" key={i} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

/** Numbered progress indicator for multi-step flows; the current step is announced as such. */
export function Stepper({
  steps,
  current,
  label,
}: {
  steps: readonly React.ReactNode[];
  current: number;
  label: string;
}) {
  return (
    <ol className="ax-stepper" aria-label={label}>
      {steps.map((step, index) => (
        <li
          key={index}
          className={index < current ? "is-done" : index === current ? "is-current" : undefined}
          aria-current={index === current ? "step" : undefined}
        >
          <span className="ax-step-number" aria-hidden="true">
            {index < current ? "✓" : index + 1}
          </span>
          <span className="ax-step-label">{step}</span>
        </li>
      ))}
    </ol>
  );
}
