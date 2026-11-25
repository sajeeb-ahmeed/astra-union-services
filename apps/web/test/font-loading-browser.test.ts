import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";
const origin = "http://127.0.0.1:5173";
async function browserInstance(): Promise<Browser> {
  const local = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const executable =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (fs.existsSync(local)
      ? fs
          .readdirSync(local)
          .filter((name) => /^chromium-/.test(name))
          .sort()
          .reverse()
          .map((name) => path.join(local, name, "chrome-win64", "chrome.exe"))
          .find((filename) => fs.existsSync(filename))
      : undefined);
  return chromium.launch({ headless: true, executablePath: executable });
}

test(
  "M-002: the app's font loading is correct — every Noto Sans Bengali face serves as font/woff2 with display swap",
  { timeout: 90000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${origin}/`, { waitUntil: "load" });
      // Every woff2 the built CSS references, plus the preloaded face.
      const fontUrls: string[] = await page.evaluate(() => {
        const urls = new Set<string>();
        for (const link of [...document.querySelectorAll('link[rel="preload"][as="font"]')]) {
          urls.add((link as HTMLLinkElement).href);
        }
        for (const sheet of [...document.styleSheets]) {
          let rules: CSSRuleList;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of [...rules]) {
            if (rule instanceof CSSFontFaceRule) {
              const src = rule.style.getPropertyValue("src");
              for (const match of src.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
                urls.add(new URL(match[1], location.origin).href);
              }
            }
          }
        }
        return [...urls];
      });
      assert.ok(fontUrls.length >= 6, `all six faces referenced: ${JSON.stringify(fontUrls)}`);
      for (const url of fontUrls) {
        const response = await page.request.get(url);
        assert.equal(response.status(), 200, `${url} serves`);
        assert.ok(
          (response.headers()["content-type"] ?? "").includes("font/woff2"),
          `${url} content-type is font/woff2: ${response.headers()["content-type"]}`,
        );
      }
      // Every @font-face uses display swap (text stays readable in the
      // system fallback while a face loads) and the Bengali face is
      // actually usable once the page renders Bengali text.
      const faceRules = await page.evaluate(() => {
        const faces: { family: string; display: string }[] = [];
        for (const sheet of [...document.styleSheets]) {
          let rules: CSSRuleList;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of [...rules]) {
            if (rule instanceof CSSFontFaceRule) {
              faces.push({
                family: rule.style.getPropertyValue("font-family"),
                display: rule.style.getPropertyValue("font-display"),
              });
            }
          }
        }
        return faces;
      });
      const notoFaces = faceRules.filter((f) => f.family.includes("Noto Sans Bengali"));
      assert.ok(notoFaces.length >= 6, `six Noto Sans Bengali @font-face rules: ${notoFaces.length}`);
      assert.ok(
        notoFaces.every((f) => f.display === "swap"),
        `every face uses font-display: swap: ${JSON.stringify(notoFaces)}`,
      );
      assert.equal(
        await page.evaluate(() => document.fonts.check('16px "Noto Sans Bengali"', "অ")),
        true,
        "Bengali face loads and covers Bengali text",
      );
      assert.equal(
        await page.evaluate(() => document.fonts.check('16px "Noto Sans Bengali"', "A")),
        true,
        "Latin face loads and covers Latin text",
      );
    } finally {
      await browser.close();
    }
  },
);
