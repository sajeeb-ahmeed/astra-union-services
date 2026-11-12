import React from "react";
import { choose } from "../i18n.js";
import type { WorkspaceNavItem } from "../workspace-navigation.js";
import "./kit.js";

/** Config-driven workspace sidebar (Phase 1). Disabled items explain when they arrive. */
export function SidebarNav({
  items,
  current,
  label,
  onSelect,
}: {
  items: readonly WorkspaceNavItem[];
  current: string;
  label: string;
  onSelect: (item: WorkspaceNavItem) => void;
}) {
  return (
    <nav aria-label={label} className="ax-sidebar-nav">
      {items.map((item) =>
        item.soon ? (
          <span
            key={item.key}
            className="ax-sidebar-item is-soon"
            aria-disabled="true"
            title={choose(item.soon)}
          >
            <span>{choose(item)}</span>
            <small>{choose(item.soon)}</small>
          </span>
        ) : item.href ? (
          <a key={item.key} className="ax-sidebar-item" href={item.href}>
            <span>{choose(item)}</span>
          </a>
        ) : (
          <button
            key={item.key}
            type="button"
            className="ax-sidebar-item"
            aria-current={current === item.key ? "page" : undefined}
            onClick={() => onSelect(item)}
          >
            <span>{choose(item)}</span>
          </button>
        ),
      )}
    </nav>
  );
}
