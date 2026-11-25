/**
 * SEO-STRATEGY-01, development plan P4 (+ P6 sitemap, P7 JSON-LD):
 * build-time prerender of the public layer.
 *
 * For every public URL (home, services hub, 47 service pages, offices hub,
 * one page per office, verify landing) this writes a complete static HTML
 * document into apps/web/dist/<path>/index.html whose first response
 * already contains the page's title, meta, canonical, Open Graph tags,
 * JSON-LD and full body content (design D3/D4). The same document loads
 * the normal SPA bundle; main.tsx renders with createRoot, so on load the
 * app replaces the static content and takes over — no hydration mismatch.
 *
 * Data sources, in order:
 *   - services: apps/web/src/public-service-catalog.json + the SEO
 *     registry (src/seo/service-seo.ts, imported through the tsx loader);
 *   - offices: SEO_OFFICES_SNAPSHOT (JSON file) -> GET
 *     {SEO_API_BASE}/api/v1/offices?pageSize=100 (default API base
 *     http://127.0.0.1:3041) -> a Belabo-only fallback snapshot (the one
 *     live office). Per-service office availability likewise comes from
 *     /api/v1/services/<no>/office-info when the API answers.
 * The build NEVER fails because an API is absent (CI builds have none):
 * it falls back and says so in its output.
 *
 * Also emits dist/sitemap.xml (P6) and dist/seo-slugs.json (the
 * service-number -> slug table the API uses for the /services?service=N
 * 301 redirect, P2/P8).
 *
 * Run after `vite build`:  node --import tsx apps/web/scripts/prerender-public.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(webRoot, "dist");
if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("prerender: apps/web/dist/index.html missing — run vite build first.");
  process.exit(1);
}

const registry = await import("../src/seo/service-seo.ts");
const {
  SERVICE_SEO,
  SITE_ORIGIN,
  SITE_NAME,
  OG_IMAGE_PATH,
  HOME_SEO,
  SERVICES_HUB_SEO,
  OFFICES_HUB_SEO,
  VERIFY_SEO,
  catalogEntry,
  faqFor,
  officeDescription,
  officeTitle,
  serviceDescription,
  serviceFormFacts,
  servicePath,
  serviceTitle,
} = registry;
// F-004: the FAQ JSON-LD must carry the same schema-derived item the
// client renders — the form facts come from the shared schemas package
// (node-side here, so no bundle cost).
const { getServiceSchema } = await import("@astra/shared-schemas");
const catalog = JSON.parse(
  fs.readFileSync(path.join(webRoot, "src", "public-service-catalog.json"), "utf8"),
);

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/* The SPA bundle tags, reused verbatim from the built shell so prerendered
 * pages boot the exact same app. */
const shell = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const bundleTags = [
  ...shell.matchAll(/<script type="module"[^>]*><\/script>/g),
  ...shell.matchAll(/<link rel="stylesheet"[^>]*>/g),
].map((m) => m[0]);
if (!bundleTags.length) {
  console.error("prerender: no bundle tags found in the built shell.");
  process.exit(1);
}

/* ---------------- offices data ---------------- */
const FALLBACK_OFFICES = [
  {
    slug: "belabo-up",
    nameBn: "বেলাবো ইউনিয়ন পরিষদ",
    nameEn: "Belabo Union Parishad",
    upazila: "বেলাবো",
    district: "নরসিংদী",
    division: "ঢাকা",
  },
];
async function loadOffices() {
  const snapshotPath = process.env.SEO_OFFICES_SNAPSHOT;
  if (snapshotPath && fs.existsSync(snapshotPath)) {
    const parsed = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed.items ?? [];
    console.log(`prerender: offices from snapshot file (${list.length}).`);
    return list;
  }
  const base = process.env.SEO_API_BASE ?? "http://127.0.0.1:3041";
  try {
    const response = await fetch(`${base}/api/v1/offices?pageSize=100`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const data = await response.json();
    const list = Array.isArray(data) ? data : data.items ?? [];
    console.log(`prerender: offices from API ${base} (${list.length}).`);
    return list;
  } catch {
    console.log("prerender: offices API unreachable — Belabo fallback snapshot.");
    return FALLBACK_OFFICES;
  }
}
async function loadServiceOffices(no) {
  const base = process.env.SEO_API_BASE ?? "http://127.0.0.1:3041";
  try {
    const response = await fetch(`${base}/api/v1/services/${no}/office-info`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data.offices) ? data.offices : null;
  } catch {
    return null;
  }
}
async function loadOfficeDetail(slug) {
  const base = process.env.SEO_API_BASE ?? "http://127.0.0.1:3041";
  try {
    const response = await fetch(`${base}/api/v1/offices/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
const officeName = (o) => ({
  bn: o.nameBn ?? o.name_bn ?? "",
  en: o.nameEn ?? o.name_en ?? "",
});
const officeArea = (o) =>
  [o.upazila, o.district, o.division].filter(Boolean).join(" · ");

/* ---------------- document template ---------------- */
function jsonLdScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}
function head({ title, description, canonicalPath, jsonLd = [], robots = "index, follow" }) {
  const canonical = `${SITE_ORIGIN}${canonicalPath}`;
  return `<meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#04592c" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="robots" content="${robots}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE_ORIGIN}${OG_IMAGE_PATH}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${SITE_ORIGIN}${OG_IMAGE_PATH}" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="preload" href="/fonts/noto-sans-bengali-bengali-400-normal.woff2" as="font" type="font/woff2" crossorigin />
    ${jsonLd.map(jsonLdScript).join("\n    ")}`;
}
function page({ title, description, canonicalPath, jsonLd, body }) {
  return `<!doctype html>
<html lang="bn">
  <head>
    ${head({ title, description, canonicalPath, jsonLd })}
  </head>
  <body>
    <div id="root">${body}</div>
    ${bundleTags.join("\n    ")}
  </body>
</html>
`;
}
const headerHtml = `<header><nav aria-label="প্রধান মেনু">
      <a href="/">${SITE_NAME}</a> ·
      <a href="/services">নাগরিক সেবা</a> ·
      <a href="/offices">ইউনিয়ন অফিস</a> ·
      <a href="/verify">সনদ যাচাই</a> ·
      <a href="/tracking">আবেদনের অবস্থা</a>
    </nav></header>`;
const footerHtml = `<footer>
      <nav aria-label="সেবা">
        <a href="/services">সব নাগরিক সেবা</a> ·
        <a href="/offices">অংশগ্রহণকারী অফিস</a> ·
        <a href="/verify">সনদ যাচাই</a>
      </nav>
      <p>© ${new Date().getFullYear()} ${SITE_NAME} · স্মার্ট ইউনিয়ন, স্মার্ট বাংলাদেশ</p>
    </footer>`;
function breadcrumbs(items) {
  return `<nav aria-label="breadcrumb"><ol>${items
    .map((item, i) =>
      item.path
        ? `<li><a href="${item.path}">${esc(item.label)}</a></li>`
        : `<li aria-current="page">${esc(item.label)}</li>`,
    )
    .join("")}</ol></nav>`;
}
function breadcrumbJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.path ? { item: `${SITE_ORIGIN}${item.path}` } : {}),
    })),
  };
}

/* ---------------- pages ---------------- */
const written = [];
function writePage(canonicalPath, html) {
  const target =
    canonicalPath === "/"
      ? path.join(dist, "index.html")
      : path.join(dist, canonicalPath.replace(/^\//, ""), "index.html");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html);
  written.push(canonicalPath);
}

const offices = await loadOffices();

/* Home */
writePage(
  "/",
  page({
    title: HOME_SEO.title.bn,
    description: HOME_SEO.description.bn,
    canonicalPath: "/",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: SITE_NAME,
        url: `${SITE_ORIGIN}/`,
        logo: `${SITE_ORIGIN}${OG_IMAGE_PATH}`,
      },
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE_NAME,
        url: `${SITE_ORIGIN}/`,
        inLanguage: "bn",
      },
    ],
    body: `${headerHtml}
    <main>
      <h1>ইউনিয়ন পরিষদ অনলাইন সেবা — ৪৭টি সনদ ও প্রত্যয়ন</h1>
      <p>${esc(HOME_SEO.description.bn)}</p>
      <h2>সব সেবা</h2>
      <ul>
        ${catalog
          .map(
            (s) =>
              `<li><a href="${servicePath(s.service_no)}">${esc(s.name_bn)} — ${esc(s.name_en)}</a></li>`,
          )
          .join("\n        ")}
      </ul>
      <p><a href="/verify">সনদ যাচাই করুন</a> · <a href="/offices">অংশগ্রহণকারী অফিস দেখুন</a></p>
    </main>
    ${footerHtml}`,
  }),
);

/* Services hub */
const categories = [...new Set(catalog.map((s) => s.category_en))];
writePage(
  "/services",
  page({
    title: SERVICES_HUB_SEO.title.bn,
    description: SERVICES_HUB_SEO.description.bn,
    canonicalPath: "/services",
    jsonLd: [
      breadcrumbJsonLd([
        { label: "হোম", path: "/" },
        { label: "নাগরিক সেবা" },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: catalog.map((s, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: s.name_bn,
          url: `${SITE_ORIGIN}${servicePath(s.service_no)}`,
        })),
      },
    ],
    body: `${headerHtml}
    <main>
      ${breadcrumbs([{ label: "হোম", path: "/" }, { label: "নাগরিক সেবা" }])}
      <h1>সব নাগরিক সেবা</h1>
      <p>${esc(SERVICES_HUB_SEO.description.bn)}</p>
      ${categories
        .map(
          (category) => `<h2>${esc(category)}</h2>
      <ul>
        ${catalog
          .filter((s) => s.category_en === category)
          .map(
            (s) =>
              `<li><a href="${servicePath(s.service_no)}">${esc(s.name_bn)} — ${esc(s.name_en)}</a></li>`,
          )
          .join("\n        ")}
      </ul>`,
        )
        .join("\n      ")}
    </main>
    ${footerHtml}`,
  }),
);

/* Service pages (design D4) */
for (const seo of SERVICE_SEO) {
  const entry = catalogEntry(seo.no);
  const canonicalPath = servicePath(seo.no);
  // F-004: same form facts the client page derives, so the FAQPage
  // JSON-LD and the visible FAQ stay the same data.
  let formFacts;
  try {
    formFacts = serviceFormFacts(getServiceSchema(seo.no));
  } catch {
    formFacts = undefined;
  }
  const faq = faqFor(seo, formFacts);
  const serviceOffices = await loadServiceOffices(seo.no);
  const offeringOffices = serviceOffices ?? offices;
  const related = seo.related.map((n) => ({
    entry: catalogEntry(n),
    path: servicePath(n),
  }));
  writePage(
    canonicalPath,
    page({
      title: serviceTitle(seo, "bn"),
      description: serviceDescription(seo, "bn"),
      canonicalPath,
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "GovernmentService",
          name: entry.name_bn,
          alternateName: entry.name_en,
          serviceType: entry.category_en,
          provider: { "@type": "GovernmentOffice", name: "ইউনিয়ন পরিষদ" },
          areaServed: { "@type": "Country", name: "Bangladesh" },
          url: `${SITE_ORIGIN}${canonicalPath}`,
        },
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faq.map((item) => ({
            "@type": "Question",
            name: item.q.bn,
            acceptedAnswer: { "@type": "Answer", text: item.a.bn },
          })),
        },
        breadcrumbJsonLd([
          { label: "হোম", path: "/" },
          { label: "নাগরিক সেবা", path: "/services" },
          { label: entry.name_bn },
        ]),
      ],
      body: `${headerHtml}
    <main>
      ${breadcrumbs([
        { label: "হোম", path: "/" },
        { label: "নাগরিক সেবা", path: "/services" },
        { label: entry.name_bn },
      ])}
      <h1>${esc(entry.name_bn)}</h1>
      <p>${esc(seo.introBn)}</p>
      ${seo.noteBn ? `<p><strong>দ্রষ্টব্য:</strong> ${esc(seo.noteBn)}</p>` : ""}
      <h2>এক নজরে</h2>
      <ul>
        <li><strong>ইস্যুকারী:</strong> অংশগ্রহণকারী ইউনিয়ন পরিষদ / পৌরসভা / সিটি কর্পোরেশন অফিস</li>
        <li><strong>সনদের ধরন:</strong> QR কোড দিয়ে অনলাইনে যাচাইযোগ্য ডিজিটাল সনদ</li>
        <li><strong>ফি ও সময়:</strong> প্রতিটি অফিস নিজে নির্ধারণ করে — নিচে অফিসের তালিকায় প্রকাশিত</li>
      </ul>
      <h2>প্রয়োজনীয় কাগজপত্র</h2>
      <p>প্রয়োজনীয় কাগজপত্র প্রতিটি অফিস নিজে নির্ধারণ করে নিচের অফিসভিত্তিক অংশে প্রকাশ করে। আবেদনের আগে আপনার অফিসের প্রকাশিত তালিকা দেখে নিন।</p>
      <h2>কীভাবে আবেদন করবেন</h2>
      <ol>
        <li>আপনার ইউনিয়ন পরিষদ অফিস বেছে নিয়ে একটি অ্যাকাউন্ট খুলুন।</li>
        <li>এই সেবার ফর্মটি পূরণ করে প্রয়োজনীয় কাগজপত্র সংযুক্ত করুন।</li>
        <li>আবেদন জমা দিন — অফিস যাচাই করে অনুমোদন করলেই QR-যাচাইযোগ্য সনদ ইস্যু হবে।</li>
        <li>সনদটি আপনার অ্যাকাউন্ট থেকে ডাউনলোড করুন; সত্যতা যেকোনো সময় অনলাইনে যাচাই করা যায়।</li>
      </ol>
      <h2>কোন অফিসে পাবেন</h2>
      ${
        serviceOffices
          ? `<ul>${offeringOffices
              .map((o) => {
                const name = officeName(o);
                return `<li><a href="/offices/${esc(o.slug)}">${esc(name.bn)}</a>${officeArea(o) ? ` — ${esc(officeArea(o))}` : ""}${
                  o.policyVersion == null
                    ? " — এই অফিস এখনও এই সেবার ফি, সময় ও কাগজপত্র প্রকাশ করেনি।"
                    : ""
                }</li>`;
              })
              .join("")}</ul>`
          : `<p>অংশগ্রহণকারী অফিসের তালিকা দেখুন: <a href="/offices">ইউনিয়ন অফিস</a>। প্রতিটি অফিস এই সেবার ফি, সময় ও প্রয়োজনীয় কাগজপত্র নিজে প্রকাশ করে।</p>`
      }
      <h2>সাধারণ প্রশ্ন</h2>
      ${faq
        .map(
          (item) => `<article><h3>${esc(item.q.bn)}</h3><p>${esc(item.a.bn)}</p></article>`,
        )
        .join("\n      ")}
      <h2>সম্পর্কিত সেবা</h2>
      <ul>
        ${related
          .map(
            (r) => `<li><a href="${r.path}">${esc(r.entry.name_bn)} — ${esc(r.entry.name_en)}</a></li>`,
          )
          .join("\n        ")}
      </ul>
      <p><a href="/login">আবেদন করতে লগইন করুন</a> · <a href="/register">নতুন অ্যাকাউন্ট খুলুন</a></p>
    </main>
    ${footerHtml}`,
    }),
  );
}

/* Offices hub */
writePage(
  "/offices",
  page({
    title: OFFICES_HUB_SEO.title.bn,
    description: OFFICES_HUB_SEO.description.bn,
    canonicalPath: "/offices",
    jsonLd: [
      breadcrumbJsonLd([
        { label: "হোম", path: "/" },
        { label: "ইউনিয়ন অফিস" },
      ]),
    ],
    body: `${headerHtml}
    <main>
      ${breadcrumbs([{ label: "হোম", path: "/" }, { label: "ইউনিয়ন অফিস" }])}
      <h1>অংশগ্রহণকারী ইউনিয়ন পরিষদ অফিস</h1>
      <p>${esc(OFFICES_HUB_SEO.description.bn)}</p>
      <ul>
        ${offices
          .map((o) => {
            const name = officeName(o);
            return `<li><a href="/offices/${esc(o.slug)}">${esc(name.bn)} — ${esc(name.en)}</a>${officeArea(o) ? ` · ${esc(officeArea(o))}` : ""}</li>`;
          })
          .join("\n        ")}
      </ul>
    </main>
    ${footerHtml}`,
  }),
);

/* Office pages (P10) */
for (const o of offices) {
  const name = officeName(o);
  const canonicalPath = `/offices/${o.slug}`;
  const detail = await loadOfficeDetail(o.slug);
  const offered = detail?.services
    ? detail.services
        .filter((s) => s.enabled !== false)
        .map((s) => s.serviceNo || s.service_no)
        .filter(Boolean)
    : [];
  writePage(
    canonicalPath,
    page({
      title: officeTitle(name).bn,
      description: officeDescription(name).bn,
      canonicalPath,
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "GovernmentOffice",
          name: name.bn,
          alternateName: name.en,
          url: `${SITE_ORIGIN}${canonicalPath}`,
          address: {
            "@type": "PostalAddress",
            addressLocality: o.upazila ?? undefined,
            addressRegion: o.district ?? undefined,
            addressCountry: "BD",
          },
        },
        breadcrumbJsonLd([
          { label: "হোম", path: "/" },
          { label: "ইউনিয়ন অফিস", path: "/offices" },
          { label: name.bn },
        ]),
      ],
      body: `${headerHtml}
    <main>
      ${breadcrumbs([
        { label: "হোম", path: "/" },
        { label: "ইউনিয়ন অফিস", path: "/offices" },
        { label: name.bn },
      ])}
      <h1>${esc(name.bn)}</h1>
      <p>${esc(officeDescription(name).bn)}</p>
      ${officeArea(o) ? `<p>${esc(officeArea(o))}</p>` : ""}
      <h2>এই অফিসের সেবা</h2>
      ${
        offered.length
          ? `<ul>${offered
              .map((no) => {
                const e = catalogEntry(no);
                return `<li><a href="${servicePath(no)}">${esc(e.name_bn)} — ${esc(e.name_en)}</a></li>`;
              })
              .join("")}</ul>`
          : `<p>সব সেবার তালিকা দেখুন: <a href="/services">নাগরিক সেবা</a>। প্রতিটি সেবার পেজে এই অফিসের ফি, সময় ও প্রয়োজনীয় কাগজপত্র প্রকাশিত থাকে।</p>`
      }
      <p><a href="/register">এই অফিসে অ্যাকাউন্ট খুলুন</a></p>
    </main>
    ${footerHtml}`,
    }),
  );
}

/* Verify landing (indexable; result URLs are noindex by design D1) */
writePage(
  "/verify",
  page({
    title: VERIFY_SEO.title.bn,
    description: VERIFY_SEO.description.bn,
    canonicalPath: "/verify",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: VERIFY_SEO.title.bn,
        url: `${SITE_ORIGIN}/verify`,
        about: { "@type": "Organization", name: SITE_NAME, url: `${SITE_ORIGIN}/` },
      },
    ],
    body: `${headerHtml}
    <main>
      <h1>সনদ যাচাই</h1>
      <p>${esc(VERIFY_SEO.description.bn)}</p>
      <form action="/verify" method="get">
        <label for="verify-search">সনদ নম্বর</label>
        <input id="verify-search" name="searchText" required />
        <button type="submit">যাচাই করুন</button>
      </form>
      <p>সনদের ওপরের QR কোড স্ক্যান করলেও সরাসরি যাচাই পেজে পৌঁছানো যায়।</p>
    </main>
    ${footerHtml}`,
  }),
);

/* Sitemap (P6) + slug table for the server-side legacy redirect (P2/P8) */
const today = new Date().toISOString().slice(0, 10);
const urls = [
  "/",
  "/services",
  ...SERVICE_SEO.map((s) => servicePath(s.no)),
  "/offices",
  ...offices.map((o) => `/offices/${o.slug}`),
  "/verify",
];
fs.writeFileSync(
  path.join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (u) =>
        `  <url><loc>${SITE_ORIGIN}${u}</loc><lastmod>${today}</lastmod></url>`,
    )
    .join("\n")}\n</urlset>\n`,
);
fs.writeFileSync(
  path.join(dist, "seo-slugs.json"),
  JSON.stringify(
    Object.fromEntries(SERVICE_SEO.map((s) => [String(s.no), s.slug])),
    null,
    2,
  ) + "\n",
);
console.log(
  `prerender: wrote ${written.length} pages, sitemap (${urls.length} URLs), seo-slugs.json.`,
);
