import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { chromium, type Browser, type Page } from "playwright";
import reference from "../../../packages/shared-schemas/src/reference-catalog.json" with { type: "json" };
import publicCatalog from "../src/public-service-catalog.json" with { type: "json" };
import { workspacePage, goToWorkspacePage } from "./fixtures/workspace-nav.js";

const dist = path.resolve("apps/web/dist");
type ManifestEntry = {
  file: string;
  name?: string;
  imports?: string[];
  isEntry?: boolean;
};
let browser: Browser;
let server: http.Server;
let origin: string;
let manifest: Record<string, ManifestEntry>;
let workspacePath: string;

before(async () => {
  assert.ok(
    fs.existsSync(path.join(dist, ".vite/manifest.json")),
    "Run npm run build before the production bundle browser tests.",
  );
  manifest = JSON.parse(
    fs.readFileSync(path.join(dist, ".vite/manifest.json"), "utf8"),
  );
  workspacePath =
    "/" +
    Object.values(manifest).find((entry) => entry.name === "WorkspaceApp")!
      .file;
  // Serve the built assets, not the Vite development dependency graph.
  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url || "/", "http://localhost").pathname,
    );
    const file = pathname.startsWith("/assets/")
      ? path.resolve(dist, "." + pathname)
      : path.join(dist, "index.html");
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const type = file.endsWith(".js")
      ? "application/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : "text/html";
    response.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  const local = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    (fs.existsSync(local) ? fs.readdirSync(local) : [])
      .filter((name) => /^chromium-/.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(local, name, "chrome-win64", "chrome.exe"))
      .find((name) => fs.existsSync(name));
  browser = await chromium.launch({ headless: true, executablePath });
});

after(async () => {
  await browser?.close();
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve(),
  );
});

async function mockApi(page: Page, initiallySignedIn = false) {
  let signedIn = initiallySignedIn;
  const session = {
    user: {
      id: "synthetic-performance-user",
      role: "staff",
      email: "performance@example.test",
      displayName: "Synthetic performance user",
    },
    tenant: {
      id: "synthetic-office",
      nameEn: "Synthetic office",
      nameBn: "পরীক্ষার অফিস",
    },
    csrfToken: "synthetic-test-token",
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname;
    if (endpoint.endsWith("/auth/logout")) signedIn = false;
    if (endpoint.endsWith("/auth/login")) signedIn = true;
    if (endpoint.endsWith("/auth/me") || endpoint.endsWith("/auth/login")) {
      await route.fulfill({
        status: signedIn ? 200 : 401,
        json: signedIn ? session : { error: "Sign in required" },
      });
      return;
    }
    if (endpoint.includes("/verify/")) {
      await route.fulfill({
        json: {
          status: "ISSUED",
          officeEn: "Synthetic office",
          officeBn: "পরীক্ষার অফিস",
          serviceEn: "Synthetic certificate",
          serviceBn: "পরীক্ষার সনদ",
          issuedAt: "2026-01-01T00:00:00Z",
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        items: endpoint.endsWith("/services") ? publicCatalog : [],
        total: 0,
        page: 1,
        pageSize: 25,
      },
    });
  });
}

test("performance: compact public service names exactly match all 47 canonical reference rows", () => {
  assert.equal(publicCatalog.length, 47);
  assert.deepEqual(
    publicCatalog,
    reference.services.map(({ service_no, name_bn, name_en, category_en }) => ({
      service_no,
      name_bn,
      name_en,
      category_en,
    })),
  );
  assert.ok(
    fs.statSync("apps/web/src/public-service-catalog.json").size < 16000,
  );
});

test(
  "performance: public initial JavaScript stays under 400 KB without authenticated schema chunks",
  { timeout: 60000 },
  async () => {
    const entry = Object.entries(manifest).find(([, value]) => value.isEntry)!;
    const initial = new Set<string>();
    const visit = (key: string) => {
      if (initial.has(key)) return;
      initial.add(key);
      (manifest[key].imports || []).forEach(visit);
    };
    visit(entry[0]);
    const initialBytes = [...initial].reduce(
      (total, key) =>
        total + fs.statSync(path.join(dist, manifest[key].file)).size,
      0,
    );
    assert.ok(
      initialBytes < 400000,
      `Public initial JavaScript must stay below 400 KB; received ${initialBytes} bytes.`,
    );
    for (const language of ["en", "bn"]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      await context.addInitScript(
        (value) => localStorage.setItem("astra.language", value),
        language,
      );
      const page = await context.newPage();

      const requests: string[] = [],
        errors: string[] = [];
      page.on("request", (request) => {
        if (request.resourceType() === "script") requests.push(request.url());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await mockApi(page);
      for (const route of [
        "/",
        "/services",
        "/register",
        "/recover",
        "/login",
        "/verify/synthetic-token",
      ]) {
        await page.goto(origin + route);
        await page.locator("h1, h2").first().waitFor();
        assert.equal(await page.locator("html").getAttribute("lang"), language);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          true,
          `${route} overflow in ${language}`,
        );
        if (route === "/services")
          assert.equal(await page.locator(".public-service").count(), 47);
      }
      assert.equal(
        requests.some(
          (url) =>
            url.includes("WorkspaceApp") ||
            url.includes("AdminWorkspace") ||
            url.includes("OnlinePayments"),
        ),
        false,
      );
      assert.deepEqual(errors, []);
      await context.close();
    }
  },
);

test(
  "performance: login loads real workspace chunk once and preserves language and logout state",
  { timeout: 45000 },
  async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const requests: string[] = [],
      errors: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    page.on("pageerror", (error) => errors.push(error.message));
    await mockApi(page);
    await page.goto(origin + "/login");
    await page
      .getByLabel("Email", { exact: true })
      .fill("performance@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("Synthetic-test-only!");
    assert.equal(
      requests.some((url) => url.endsWith(workspacePath)),
      false,
    );
    await page
      .locator(".login-form")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    assert.equal(
      requests.filter((url) => url.endsWith(workspacePath)).length,
      1,
    );
    await goToWorkspacePage(page, "services");
    assert.equal(await page.locator(".catalog .service").count(), 47);
    await page.getByRole("button", { name: "বাংলা", exact: true }).click();
    assert.equal(await page.locator("html").getAttribute("lang"), "bn");
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("Email", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await page.getByLabel("Password", { exact: true }).inputValue(),
      "",
    );
    assert.deepEqual(errors, []);
    await context.close();
  },
);

test(
  "performance: delayed and failed workspace download has bilingual recovery and reload succeeds",
  { timeout: 45000 },
  async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    await mockApi(page, true);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**" + workspacePath, async (route) => {
      await blocked;
      await route.abort("failed");
    });
    await page.goto(origin + "/login");
    await page
      .getByRole("status")
      .filter({ hasText: "Loading DigitalUnion…" })
      .waitFor();
    await page.getByRole("button", { name: "বাংলা", exact: true }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "DigitalUnion লোড হচ্ছে…" })
      .waitFor();
    release();
    await page
      .getByRole("heading", { name: "এই অংশটি লোড করা যায়নি", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page
      .getByRole("heading", {
        name: "This section could not load",
        exact: true,
      })
      .waitFor();
    await page.unroute("**" + workspacePath);
    await page
      .getByRole("button", { name: "Reload page", exact: true })
      .click();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await context.close();
  },
);
