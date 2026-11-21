import { OG_IMAGE_PATH, SITE_NAME, SITE_ORIGIN } from "./service-seo.js";

/**
 * SEO-STRATEGY-01, development plan P5 (client half): per-page head
 * management for the SPA routes that are not prerendered. Prerendered
 * pages carry the same tags statically (see scripts/prerender-public.mjs);
 * this helper keeps the client-rendered routes consistent with them —
 * title, description, canonical, robots and Open Graph / Twitter cards.
 *
 * SiteHeader also writes document.title from the owner-editable branding.
 * Once a page applies its own head, hasPageHead() tells the shell not to
 * overwrite the title when the branding fetch resolves afterwards.
 */

let applied = false;
export function hasPageHead(): boolean {
  return applied;
}

function upsertMeta(selector: string, attrs: Record<string, string>) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    document.head.appendChild(el);
  }
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
}

export interface PageHead {
  title: string;
  description?: string;
  /** Path beginning with "/" — canonical is SITE_ORIGIN + path. */
  canonicalPath: string;
  /** Defaults to "index, follow" for public pages. */
  robots?: string;
  ogType?: string;
}

export function applyPageHead(head: PageHead) {
  applied = true;
  document.title = head.title;
  const canonical = `${SITE_ORIGIN}${head.canonicalPath}`;
  upsertCanonical(canonical);
  upsertMeta('meta[name="robots"]', {
    name: "robots",
    content: head.robots ?? "index, follow",
  });
  if (head.description) {
    upsertMeta('meta[name="description"]', {
      name: "description",
      content: head.description,
    });
    upsertMeta('meta[property="og:description"]', {
      property: "og:description",
      content: head.description,
    });
    upsertMeta('meta[name="twitter:description"]', {
      name: "twitter:description",
      content: head.description,
    });
  }
  upsertMeta('meta[property="og:title"]', {
    property: "og:title",
    content: head.title,
  });
  upsertMeta('meta[property="og:type"]', {
    property: "og:type",
    content: head.ogType ?? "website",
  });
  upsertMeta('meta[property="og:url"]', {
    property: "og:url",
    content: canonical,
  });
  upsertMeta('meta[property="og:site_name"]', {
    property: "og:site_name",
    content: SITE_NAME,
  });
  upsertMeta('meta[property="og:image"]', {
    property: "og:image",
    content: `${SITE_ORIGIN}${OG_IMAGE_PATH}`,
  });
  upsertMeta('meta[name="twitter:card"]', {
    name: "twitter:card",
    content: "summary",
  });
  upsertMeta('meta[name="twitter:title"]', {
    name: "twitter:title",
    content: head.title,
  });
  upsertMeta('meta[name="twitter:image"]', {
    name: "twitter:image",
    content: `${SITE_ORIGIN}${OG_IMAGE_PATH}`,
  });
}
