import express from "express";
import fs from "node:fs";
import path from "node:path";

/** Same-origin SPA delivery; API misses never fall through to HTML. */
export function mountWeb(app: express.Express, directory = path.resolve("apps/web/dist")) {
  if (!fs.existsSync(path.join(directory, "index.html"))) throw Error("Frontend build missing. Run npm run build before npm start.");
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
    if (path.extname(req.path)) { res.sendStatus(404); return; }
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(directory, "index.html"));
  });
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status === 404 ? 404 : 500).type("text").send(error.status === 404 ? "File not found." : "Unable to load page.");
  });
}
