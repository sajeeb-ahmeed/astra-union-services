import React from "react";

/**
 * FULL-UIUX-01 (programme 3): one drawn icon set for workspace navigation —
 * 1.5px stroke, 24 viewBox, currentColor — shared by the sidebar, the UDC
 * navigation and the mobile tab bar, so every shell speaks the same
 * icon language. Keys cover both nav systems (page keys + UDC keys).
 */
const PATHS: Record<string, React.ReactNode> = {
  home: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  dashboard: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  services: (
    <>
      <path d="M7 3.5h8L19 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6.5 3.5Z" />
      <path d="M14.5 3.5v4.5H19M9 12h6M9 15.5h6" />
    </>
  ),
  "new-application": (
    <>
      <path d="M7 3.5h8L19 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6.5 3.5Z" />
      <path d="M14.5 3.5v4.5H19M12 11v6M9 14h6" />
    </>
  ),
  citizens: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3.5 19.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M16 5.4a3.5 3.5 0 0 1 0 6.2M17.8 15.3c1.5.7 2.4 2 2.7 4.2" />
    </>
  ),
  applications: (
    <>
      <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5Z" />
      <path d="M9 9h6M9 12.5h6M9 16h4" />
    </>
  ),
  pending: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  renewal: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.7 3.8v3.4h-3.4" />
    </>
  ),
  "trade-renewal": (
    <>
      <path d="M4.5 9.5 6 4h12l1.5 5.5M4.5 9.5h15M4.5 9.5V19a1.5 1.5 0 0 0 1.5 1.5h12A1.5 1.5 0 0 0 19.5 19V9.5M9.5 20.5v-6h5v6" />
    </>
  ),
  prints: (
    <>
      <path d="M7 8V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V8M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13A1.5 1.5 0 0 1 20 10.5v5a1.5 1.5 0 0 1-1.5 1.5H17" />
      <rect x="7" y="14.5" width="10" height="6" rx="1" />
    </>
  ),
  "print-certificate": (
    <>
      <path d="M7 8V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V8M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13A1.5 1.5 0 0 1 20 10.5v5a1.5 1.5 0 0 1-1.5 1.5H17" />
      <rect x="7" y="14.5" width="10" height="6" rx="1" />
    </>
  ),
  billing: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10h17M7 14.5h4" />
    </>
  ),
  payments: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10h17M7 14.5h4" />
    </>
  ),
  owner: (
    <>
      <path d="M4 20.5V10L12 4l8 6v10.5M4 20.5h16M9.5 20.5v-5h5v5" />
    </>
  ),
  admin: (
    <>
      <path d="M12 4 5 7v5c0 4.5 3 7.2 7 8.5 4-1.3 7-4 7-8.5V7Z" />
      <path d="M9.5 11.5h5M12 9v5" />
    </>
  ),
  security: (
    <>
      <path d="M12 4 5 7v5c0 4.5 3 7.2 7 8.5 4-1.3 7-4 7-8.5V7Z" />
      <path d="m9 11.8 2.2 2.2L15.5 9.7" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.4 3.6-5 7-5s6.2 1.6 7 5" />
    </>
  ),
  notifications: (
    <>
      <path d="M6 16v-5.5a6 6 0 0 1 12 0V16l1.2 2.7a1 1 0 0 1-.9 1.3H5.7a1 1 0 0 1-.9-1.3ZM10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  reports: (
    <>
      <path d="M5 4v15.5h14.5M9 16v-5M12.5 16V8M16 16v-3" />
    </>
  ),
  support: (
    <>
      <path d="M4.5 6A1.5 1.5 0 0 1 6 4.5h12A1.5 1.5 0 0 1 19.5 6v9a1.5 1.5 0 0 1-1.5 1.5H9l-4.5 3.5Z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  guide: (
    <>
      <path d="M6 3.5h13A1.5 1.5 0 0 1 20.5 5v14a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V5A1.5 1.5 0 0 1 6 3.5Z" />
      <path d="M9 8h7M9 11.5h7M9 15h4" />
    </>
  ),
  "user-guide": (
    <>
      <path d="M6 3.5h13A1.5 1.5 0 0 1 20.5 5v14a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V5A1.5 1.5 0 0 1 6 3.5Z" />
      <path d="M9 8h7M9 11.5h7M9 15h4" />
    </>
  ),
  flow: (
    <>
      <path d="M7 3.5h8L19 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5A1.5 1.5 0 0 1 6.5 3.5Z" />
      <path d="M14.5 3.5v4.5H19M12 11v6M9 14h6" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" />
    </>
  ),
};

export function NavIcon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] ?? PATHS.applications}
    </svg>
  );
}
