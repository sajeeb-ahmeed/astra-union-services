import express from "express";
import fs from "node:fs";
import path from "node:path";

/**
 * SEO P8 cache policy for prerendered public HTML (design D6): a short
 * shared-cache lifetime with a long stale-while-revalidate window, so
 * crawlers and citizens get the static page fast and deploys propagate
 * within minutes.
 */
const PRERENDER_CACHE = "public, max-age=300, stale-while-revalidate=86400";
/** Dist-root files the SPA fallback must not swallow (robots, sitemap,
 *  favicons, fonts). seo-slugs.json is deliberately NOT in this list: it
 *  is a server-internal table read from disk, never served. */
const ROOT_FILE_EXTENSIONS = new Set([".txt", ".xml", ".png", ".ico", ".webp", ".svg", ".woff2"]);

/** BUNDLE06-R5 B5: the SPA's real URL routes. Extensionless paths outside
 *  this set are honest 404s (the shell is still served so the friendly
 *  Bangla not-found view renders, but with a 404 status — no soft-404).
 *  Mirrors the publicPages table in apps/web/src/PublicPortal.tsx plus the
 *  shell routes in main.tsx (/register-office, /payments/return). */
const SPA_EXACT_ROUTES = new Set([
  "/", "/services", "/offices", "/notices", "/help", "/witness", "/guide",
  "/tracking", "/verify", "/verify-email", "/login", "/register",
  "/policies", "/recover", "/register-office", "/payments/return",
]);
const SPA_PREFIX_ROUTES = ["/services/", "/offices/", "/verify/"];
function isKnownSpaRoute(requestPath: string): boolean {
  const normalized =
    requestPath.length > 1 && requestPath.endsWith("/")
      ? requestPath.slice(0, -1)
      : requestPath;
  if (SPA_EXACT_ROUTES.has(normalized)) return true;
  return SPA_PREFIX_ROUTES.some(
    (prefix) => normalized.startsWith(prefix) && normalized.length > prefix.length,
  );
}

/** Same-origin SPA delivery; API misses never fall through to HTML. */
export function mountWeb(app: express.Express, directory = path.resolve("apps/web/dist")) {
  if (!fs.existsSync(path.join(directory, "index.html"))) throw Error("Frontend build missing. Run npm run build before npm start.");

  // SEO P8 / Phase 8 (host hygiene): 301 www -> apex, derived from the
  // configured PUBLIC_ORIGIN. Active only for an HTTPS apex origin, so
  // local and staging hosts are never redirected.
  let apexHost: string | null = null;
  try {
    const origin = new URL(process.env.PUBLIC_ORIGIN ?? "");
    if (origin.protocol === "https:") apexHost = origin.host;
  } catch { /* no PUBLIC_ORIGIN — no redirect */ }
  if (apexHost) {
    app.use((req, res, next) => {
      if ((req.headers.host ?? "") === `www.${apexHost}`) {
        res.redirect(301, `https://${apexHost}${req.originalUrl}`);
        return;
      }
      next();
    });
  }

  // SEO P2: the legacy /services?service=N deep link 301s to the service's
  // slug URL. The number -> slug table is emitted by the prerender step
  // (dist/seo-slugs.json); without a prerendered build this is a no-op and
  // the SPA canonicalises the URL client-side instead.
  let slugByNumber: Record<string, string> = {};
  try {
    slugByNumber = JSON.parse(fs.readFileSync(path.join(directory, "seo-slugs.json"), "utf8"));
  } catch { /* no prerender table — SPA fallback handles it */ }
  // F-019: the set of valid service slugs, for the unknown-slug 404
  // below. Empty when no prerender table exists (dev), which disables
  // the check so local development keeps its client-side not-found view.
  const knownServiceSlugs = new Set(Object.values(slugByNumber));
  const prerendered = fs.existsSync(path.join(directory, "services", "index.html"));

  app.use("/assets", (req, res, next) => {
    let name: string;
    try { name = decodeURIComponent(req.path); } catch { res.sendStatus(400); return; }
    const full = path.resolve(directory, "assets", `.${name}`);
    const assetRoot = path.resolve(directory, "assets") + path.sep;
    if (!full.startsWith(assetRoot) || !/\.(js|css|svg|woff2)$/.test(full)) { next(); return; }
    const accepted = req.acceptsEncodings('br','gzip');
    const encoding = accepted === 'br' && fs.existsSync(full + ".br") ? "br" : accepted === 'gzip' && fs.existsSync(full + ".gz") ? "gzip" : null;
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    if (encoding) {
      res.setHeader("Content-Encoding", encoding);
      res.type(path.extname(full));
      res.sendFile(full + (encoding === "br" ? ".br" : ".gz"));
    } else next();
  }, express.static(path.join(directory, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }));
  app.get(/^(?!\/api(?:\/|$)|\/assets(?:\/|$)).*/, (req, res) => {
    // SEO P2: legacy service deep link -> slug URL (permanent).
    if (req.path === "/services" && typeof req.query.service === "string") {
      const slug = slugByNumber[req.query.service];
      if (slug) { res.redirect(301, `/services/${slug}`); return; }
    }
    const extension = path.extname(req.path);
    if (extension) {
      // Dist-root static files (robots.txt, sitemap.xml, favicons, fonts).
      if (!ROOT_FILE_EXTENSIONS.has(extension)) { res.sendStatus(404); return; }
      const full = path.resolve(directory, `.${req.path}`);
      const root = path.resolve(directory) + path.sep;
      if (!full.startsWith(root) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
        res.sendStatus(404);
        return;
      }
      res.setHeader(
        "Cache-Control",
        extension === ".txt" || extension === ".xml" ? PRERENDER_CACHE : "public, max-age=86400",
      );
      res.sendFile(full);
      return;
    }
    // SEO P4/P8: a prerendered public page wins over the SPA shell and
    // carries the public cache policy; every other route gets the shell
    // uncached, exactly as before.
    if (prerendered && req.path !== "/") {
      const candidate = path.join(directory, req.path.replace(/^\//, ""), "index.html");
      if (fs.existsSync(candidate)) {
        res.setHeader("Cache-Control", PRERENDER_CACHE);
        res.sendFile(candidate);
        return;
      }
    }
    res.setHeader("Cache-Control", prerendered && req.path === "/" ? PRERENDER_CACHE : "no-store");
    if (!isKnownSpaRoute(req.path)) res.status(404);
    // F-019: a bad /services/<slug> is a client-side "not found" view
    // but the server used to answer HTTP 200 for it. The slug table is
    // server-side already (it reads dist/seo-slugs.json for the 301
    // above), so an unknown single-segment slug gets a real 404 while
    // the shell still serves the friendly not-found view. Skipped when
    // no prerender table exists (dev), where the SPA handles it.
    if (req.path.startsWith("/services/") && knownServiceSlugs.size > 0) {
      const slug = req.path.slice("/services/".length);
      if (slug.includes("/") || !knownServiceSlugs.has(slug)) res.status(404);
    }
    res.sendFile(path.join(directory, "index.html"));
  });
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status === 404 ? 404 : 500).type("text").send(error.status === 404 ? "File not found." : "Unable to load page.");
  });
}
