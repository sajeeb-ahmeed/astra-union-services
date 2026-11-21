import React from "react";
import { choose } from "../i18n.js";
import type { WorkspaceNavItem } from "../workspace-navigation.js";
import { NavIcon } from "./nav-icons.js";
import "./kit.js";

/**
 * Config-driven workspace sidebar.
 * FULL-UIUX-01 (programme 3): icon-led items in the shared nav language;
 * unbuilt destinations no longer appear at all (the "soon (Phase N)"
 * placeholders were removed from the navigation model).
 */
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
        item.href ? (
          <a key={item.key} className="ax-sidebar-item" href={item.href}>
            <NavIcon name={item.key} />
            <span>{choose(item)}</span>
          </a>
        ) : (
          <button
            key={item.key}
            type="button"
            className="ax-sidebar-item"
            data-page={item.page && !item.state ? item.page : undefined}
            aria-current={current === item.key ? "page" : undefined}
            onClick={() => onSelect(item)}
          >
            <NavIcon name={item.key} />
            <span>{choose(item)}</span>
          </button>
        ),
      )}
    </nav>
  );
}
