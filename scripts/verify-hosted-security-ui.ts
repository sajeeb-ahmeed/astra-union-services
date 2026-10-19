import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = new URL(process.env.ASTRA_LIVE_URL ?? "");
assert.equal(origin.protocol, "https:");
assert.equal(origin.pathname, "/");
assert.equal(
  origin.username + origin.password + origin.search + origin.hash,
  "",
);
const base = origin.origin;
const configuration = JSON.parse(
  fs.readFileSync(".runtime/hosted/credentials.json", "utf8"),
);
assert.equal(base, configuration.publicOrigin);
const source = JSON.parse(
  fs.readFileSync("execution/hosted-orders-qa.json", "utf8"),
);
const qa = JSON.parse(
  fs.readFileSync(".runtime/hosted/qa-credentials.json", "utf8"),
).runs.find((run: any) => run.runId === source.runId);
assert.equal(qa.kind, "HOSTED_ORDERS_QA");
assert.equal(qa.baseUrl, base);
assert.equal(qa.lastStatus, "PASS");
const local = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (fs.existsSync(local) ? fs.readdirSync(local) : [])
    .filter((name) => /^chromium-/.test(name))
    .sort()
    .reverse()
    .map((name) => path.join(local, name, "chrome-win64", "chrome.exe"))
    .find((file) => fs.existsSync(file));
const browser = await chromium.launch({ headless: true, executablePath });
const evidence: any = {
  startedAt: new Date().toISOString(),
  baseUrl: base,
  status: "RUNNING",
  scope:
    "Public page request graph, existing synthetic staff sign-in and read-only session UI. Login/logout are the only server mutations.",
  checks: [],
};
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", () => errors.push("pageerror"));
  const requested = new Set<string>();
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith(".js")) requested.add(pathname);
  });
  await page.goto(base, { waitUntil: "networkidle", timeout: 120000 });
  assert.ok(
    ![...requested].some((file) =>
      /WorkspaceApp|AdminWorkspace|OnlinePayments|AdditionalWorkspace/.test(
        file,
      ),
    ),
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  evidence.checks.push({
    name: "Public mobile page avoids authenticated chunks",
    status: "PASS",
    scripts: [...requested],
  });
  await page.goto(`${base}/login`);
  assert.equal(
    await page.getByLabel("Email", { exact: true }).inputValue(),
    "",
  );
  assert.equal(
    await page.getByLabel("Password", { exact: true }).inputValue(),
    "",
  );
  await page.getByLabel("Email", { exact: true }).fill(qa.accounts.staff.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(qa.accounts.staff.password);
  await page
    .locator(".login-form")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "My profile", exact: true })
    .click();
  const panel = page.locator(
    'section[aria-labelledby="account-sessions-title"]',
  );
  await panel.getByTestId("active-session-count").waitFor();
  assert.ok(
    Number(await panel.getByTestId("active-session-count").innerText()) >= 1,
  );
  assert.ok([...requested].some((file) => /WorkspaceApp/.test(file)));
  assert.equal(await panel.locator('input[type="password"]').inputValue(), "");
  await panel.screenshot({ path: "execution/security-live-account-en.png" });
  evidence.checks.push({
    name: "English authenticated profile has live own-session summary",
    status: "PASS",
  });
  await page.getByRole("button", { name: "বাংলা", exact: true }).click();
  await panel
    .getByRole("heading", { name: "সক্রিয় লগইন", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  );
  await panel.screenshot({ path: "execution/security-live-account-bn.png" });
  evidence.checks.push({
    name: "Bangla 390x844 session controls and layout",
    status: "PASS",
  });
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: "Account security", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Active sign-ins", exact: true })
    .waitFor();
  await page.getByTestId("active-session-count").waitFor();
  evidence.checks.push({
    name: "Account security page also exposes own-session controls",
    status: "PASS",
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.locator(".login-form").waitFor();
  assert.equal(
    await page.getByLabel("Password", { exact: true }).inputValue(),
    "",
  );
  assert.deepEqual(errors, []);
  evidence.checks.push({
    name: "Sign-out clears inputs; no page errors",
    status: "PASS",
  });
  evidence.status = "PASS";
  console.log(`PASS: ${evidence.checks.length} hosted UI groups.`);
} catch {
  evidence.status = "FAIL";
  console.error(
    "Hosted UI verification failed; private response values withheld.",
  );
  process.exitCode = 1;
} finally {
  await browser.close();
  evidence.pageErrors = errors.length;
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    "execution/security-live-browser-qa.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
}
