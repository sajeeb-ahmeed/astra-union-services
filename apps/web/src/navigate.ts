/**
 * L-006: client-side public navigation.
 *
 * The public site had no router: every in-app navigation (home ↔ portal
 * pages, back/forward to "/", the verify form, the home search forms) was
 * a full page load (`location.assign` / `location.reload` / plain `<a
 * href>`), and every full load remounted the app and re-showed the
 * first-load splash ("DigitalUnion লোড হচ্ছে…") for 2–5 s. The fix is a
 * pushState + event: `navigate()` changes the URL and dispatches
 * `astra:navigate`; the App listens for that event (and for `popstate`,
 * i.e. back/forward) and re-renders, so the route components read the new
 * pathname without a reload. Portal-internal navigation already re-rendered
 * via its own state and is unchanged.
 *
 * `navigate()` is for same-app public routes only — never for external
 * URLs, logins, or the hard links in HARD_LINKS (e.g. /register-office,
 * which is deliberately a real page load).
 */
export function navigate(path: string): void {
  history.pushState({}, "", path);
  window.dispatchEvent(new Event("astra:navigate"));
}

/** The public routes that may be navigated to without a page load. */
const PUBLIC_ROUTES = new Set([
  "/",
  "/services",
  "/tracking",
  "/verify",
  "/offices",
  "/help",
  "/guide",
  "/policies",
  "/notices",
  "/witness",
  "/login",
  "/register",
  "/recover",
]);
const PUBLIC_ROUTE_PREFIXES = ["/services/", "/offices/", "/verify/"];

export function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  return PUBLIC_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * L-006: delegated client-side navigation for plain `<a href>` links to
 * public routes. The shell's NavLink already renders a button when it has
 * an onNavigate handler, but inline content links (home search results,
 * the hero CTAs, the help card, the notices link) are plain anchors and
 * each one was a full page load. This listener is the safety net for all
 * of them — and for any future plain anchor — while preserving the href
 * for crawlers, right-click / copy-link, and middle-click (a middle-click
 * never fires `click`, so it still opens a real new tab). It only fires
 * for an unmodified left-click on a same-origin link to a whitelisted
 * public route, and it never overrides a handler that already called
 * preventDefault() (e.g. the portal's own openService/openOffice links).
 * /register-office is deliberately NOT whitelisted: it stays a real page
 * load (see HARD_LINKS in PublicShell.tsx).
 */
export function installPublicLinkInterceptor(): () => void {
  const onClick = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || anchor.getAttribute("target") || anchor.hasAttribute("download"))
      return;
    let url: URL;
    try {
      url = new URL(href, location.origin);
    } catch {
      return;
    }
    if (url.origin !== location.origin || !isPublicRoute(url.pathname)) return;
    event.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  };
  document.addEventListener("click", onClick);
  return () => document.removeEventListener("click", onClick);
}
