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
