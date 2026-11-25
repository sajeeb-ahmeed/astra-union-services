import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { goToWorkspacePage } from "./fixtures/workspace-nav.js";
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
async function signInAsApprover(page: any) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email or mobile number", { exact: true }).fill("approver@alpha.local.test");
  await page.getByLabel("Password", { exact: true }).fill("Demo-Phase1!");
  await page.locator(".login-form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
function digits(text: string | null): number {
  return Number((text ?? "").replace(/[^\d]/g, "")) || 0;
}

test(
  "CH-001/CH-003/CH-005/CH-009: the Chairman's dashboard, queues and directory",
  { timeout: 180000 },
  async () => {
    const browser = await browserInstance();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await signInAsApprover(page);

      // CH-001: the approver's home IS the dashboard now — the summary
      // tiles plus the per-state strip. The ten state tiles add up to
      // the Total applications tile (no double-counting).
      await goToWorkspacePage(page, "Overview");
      await page.locator(".ax-dashboard-stats").waitFor({ timeout: 15000 });
      assert.ok(await page.getByText("Pending applications").count() > 0);
      await page.locator(".ax-dashboard-states-row").waitFor({ timeout: 15000 });
      const tiles = page.locator(".ax-state-tile");
      assert.equal(await tiles.count(), 10, "one tile per state in the partition");
      const totalText = await page.locator(".ax-dashboard-stats").textContent();
      // The strip is the partition, so its sum must equal the office
      // total the API reports — read the same counts the tiles render.
      const counts = await page.evaluate(async () => {
        const r = await fetch("/api/v1/applications/counts", { credentials: "include" });
        return r.json();
      });
      // Sum ONLY the ten state keys. `counts` also carries `overdue`
      // (W-015, a subset of the office-waiting states — not a partition
      // member), and the response carries top-level derived totals
      // (awaitingReview, awaitingIssuance, awaitingCitizen) that overlap
      // states the same way.
      const STATES = [
        "DRAFT",
        "SUBMITTED",
        "UNDER_REVIEW",
        "CORRECTION_REQUIRED",
        "RESUBMITTED",
        "APPROVED",
        "ISSUED",
        "REJECTED",
        "CANCELLED",
        "REVOKED",
      ];
      const apiTotal = STATES.reduce((a, s) => a + (counts.counts[s] ?? 0), 0);
      let stripSum = 0;
      for (const tile of await tiles.all()) stripSum += digits(await tile.locator("strong").textContent());
      assert.equal(stripSum, apiTotal, `state tiles sum to the office total (${stripSum} vs ${apiTotal})`);
      assert.ok((totalText ?? "").includes("Total applications"));
      const issuedTile = tiles.filter({ hasText: "Issued" });
      const issuedCount = digits(await issuedTile.locator("strong").textContent());

      // CH-003: while the Pending queue is still loading, skeletons —
      // never the "nothing is waiting" empty state. Delay the counts
      // response so the loading state is observable.
      const countsUrl = (url: URL) => url.pathname === "/api/v1/applications/counts";
      await page.route(countsUrl, async (route) => {
        await new Promise((r) => setTimeout(r, 2000));
        await route.continue();
      });
      await goToWorkspacePage(page, "pending");
      await page.locator(".ax-skeleton").first().waitFor({ timeout: 15000 });
      assert.equal(
        await page.getByText("Nothing is waiting right now").count(),
        0,
        "no premature empty state while the queue loads",
      );
      await page.unroute(countsUrl);
      await page.getByRole("heading", { name: /Awaiting review/ }).waitFor({ timeout: 15000 });
      await page.getByRole("heading", { name: /Awaiting issuance/ }).waitFor();

      // CH-005: changing the filter shows skeletons instead of the
      // previous filter's rows. Delay the list response, then flip the
      // state filter; the old rows must be gone while it loads.
      await goToWorkspacePage(page, "Applications");
      await page.locator(".table-wrap tbody tr").first().waitFor({ timeout: 15000 });
      const rowsBefore = await page.locator(".table-wrap tbody tr").count();
      assert.ok(rowsBefore > 0, "the unfiltered list has rows to replace");
      const listUrl = (url: URL) => url.pathname === "/api/v1/applications";
      await page.route(listUrl, async (route) => {
        await new Promise((r) => setTimeout(r, 2000));
        await route.continue();
      });
      await page.locator("#state-filter").selectOption("SUBMITTED");
      await page.locator(".ax-skeleton").first().waitFor({ timeout: 15000 });
      assert.equal(
        await page.locator(".table-wrap tbody tr").count(),
        0,
        "stale rows are hidden while the new filter loads",
      );
      assert.equal(
        await page.getByText("No matching applications").count(),
        0,
        "no premature empty state while the new filter loads",
      );
      await page.unroute(listUrl);
      await page.locator(".ax-skeleton").first().waitFor({ state: "detached", timeout: 15000 });
      // The filtered list renders rows or the genuine empty state.
      const filteredRows = await page.locator(".table-wrap tbody tr").count();
      if (filteredRows === 0) {
        assert.ok((await page.getByText("No matching applications").count()) > 0);
      }
      // CH-009(a): a waiting row carries the age chip; an issued row
      // must not. (Positive control on the filtered SUBMITTED rows.)
      if (filteredRows > 0) {
        assert.ok(
          (await page.locator(".table-wrap tbody tr .age-chip").count()) > 0,
          "submitted rows still carry the waiting chip",
        );
      }
      if (issuedCount > 0) {
        await page.locator("#state-filter").selectOption("ISSUED");
        await page.locator(".table-wrap tbody tr").first().waitFor({ timeout: 15000 });
        assert.equal(
          await page.locator(".table-wrap tbody tr .age-chip").count(),
          0,
          "issued rows carry no waiting chip",
        );
      }

      // CH-002: the search box now matches service names, not just
      // references and citizen names.
      await page.locator("#state-filter").selectOption("");
      const search = page.getByPlaceholder("Reference, citizen name or service");
      // The search is debounced (250 ms) and the state-clear above also
      // refetches: wait for the search's own response before reading
      // rows, or the still-unfiltered list is read as if it were the
      // search result.
      const searchResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/v1/applications" &&
          url.searchParams.get("q") === "Permanent Resident"
        );
      });
      await search.fill("Permanent Resident");
      await searchResponse;
      await page.locator(".table-wrap tbody tr").first().waitFor({ timeout: 15000 });
      const serviceCells = await page.locator("tbody tr td:nth-child(3)").allTextContents();
      assert.ok(serviceCells.length > 0, "service-name search returns rows");
      assert.ok(
        serviceCells.every((text) => text.includes("Permanent Resident Certificate")),
        `every row is the searched service: ${JSON.stringify(serviceCells)}`,
      );

      // CH-009(b): the Citizens directory shows its real total and pages.
      await goToWorkspacePage(page, "Citizens");
      const pagination = page.locator(".citizens .pagination, .panel .pagination").last();
      await pagination.waitFor({ timeout: 15000 });
      const paginationText = (await pagination.textContent()) ?? "";
      assert.match(paginationText, /results · Page 1 \//, `directory total + pagination render: ${paginationText}`);
      assert.ok((await page.getByRole("button", { name: /Next citizens/ }).count()) > 0);
      assert.deepEqual(errors, [], `no page errors: ${JSON.stringify(errors)}`);
    } finally {
      await browser.close();
    }
  },
);
