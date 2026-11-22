import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { chromium, type Page } from "playwright";
import ts from "typescript";

type Place = { code: string; nameEn: string; nameBn: string; [key: string]: string };
const source = [
  { level: "divisions", count: 8, parent: null, hash: "7cd85edac040eac2d66a692be3c709ee74d35f43eaa1701a62a679e7275c79b8" },
  { level: "districts", count: 64, parent: "divisionCode", hash: "8ee180d77ea24161cd9b0fa1ad669f3d554772f2424ad535882fe43097fe3622" },
  { level: "upazilas", count: 495, parent: "districtCode", hash: "d88126d4862bcab11915903b58f2d78a644c2d61cb8835fbcb5550165ffeaebd" },
  { level: "unions", count: 4586, parent: "upazilaCode", hash: "80664b1a45b865d03013b760bd3aabd653e5c71cc33d24e8214192a5a7ae49a5" },
  { level: "wards", count: 41274, parent: "unionCode", hash: "b83239fa631618404ecdd4a7c34df6507c5a68f1ce91d154ee2ea19138456c8a" },
] as const;

function readSource(level: string): Place[] {
  return JSON.parse(fs.readFileSync(`data/geo/${level}.json`, "utf8"));
}

test("language source: displayed literal translations cover all public/workspace components", () => {
  const dictionaries: Record<string, Record<string, string>> = {};
  for (const language of ["bn", "en"]) dictionaries[language] = {
    ...JSON.parse(fs.readFileSync(`apps/web/src/locales/workspace.${language}.json`, "utf8")),
    ...JSON.parse(fs.readFileSync(`apps/web/src/locales/public.${language}.json`, "utf8")),
  };
  // Brands, actual sample credentials, language endonyms and email examples must remain literal.
  const invariant = new Set(["A", "Demo-Phase1!", "English", "বাংলা", "you@example.test"]);
  const missing: string[] = [];
  let checked = 0;
  function displayLiterals(node: ts.Node): string[] {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isConditionalExpression(node)) return [...displayLiterals(node.whenTrue), ...displayLiterals(node.whenFalse)];
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(displayLiterals);
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return [...displayLiterals(node.left), ...displayLiterals(node.right)];
    return [];
  }
  // FULL-UIUX-01 split the public home into its own components and moved
  // display copy to the choose({ bn, en }) pattern, which carries both
  // languages inline. The scan covers the current component set and both
  // copy patterns: t/tx literals must resolve in the dictionaries, and a
  // choose() pair must carry a literal on BOTH sides (a one-sided or
  // script-swapped pair is a coverage failure, not a pass).
  for (const filename of ["main", "AdditionalWorkspace", "DynamicForm", "PublicPortal", "AdminWorkspace", "GeographyFields", "PublicHome", "TrustVisual"]) {
    const file = ts.createSourceFile(filename, fs.readFileSync(`apps/web/src/${filename}.tsx`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ["t", "tx"].includes(node.expression.getText(file)) && node.arguments[0]) {
        for (const text of displayLiterals(node.arguments[0])) {
        const key = text.replace(/\s+/g, " ").trim();
        if (!invariant.has(key) && /[A-Za-z\u0980-\u09ff]/.test(key)) {
          checked++;
          const parts = key.split(" / ");
          const automatic = parts.length === 2 && parts.filter((part) => /[\u0980-\u09ff]/.test(part)).length === 1 && parts.filter((part) => !/[\u0980-\u09ff]/.test(part) && /[a-z]/i.test(part)).length === 1;
          if (!automatic) {
            if (/[A-Za-z]/.test(key) && !dictionaries.bn[key]) missing.push(`${filename}: missing Bengali for ${key}`);
            if (/[\u0980-\u09ff]/.test(key) && !dictionaries.en[key]) missing.push(`${filename}: missing English for ${key}`);
          }
        }
        }
      }
      if (ts.isCallExpression(node) && node.expression.getText(file) === "choose" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        const sides: Record<string, string | undefined> = {};
        for (const prop of node.arguments[0].properties) {
          if (ts.isPropertyAssignment(prop) && (prop.name.getText(file) === "bn" || prop.name.getText(file) === "en") && (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer))) {
            sides[prop.name.getText(file)] = prop.initializer.text;
          }
        }
        if (sides.bn !== undefined || sides.en !== undefined) {
          if (sides.bn === undefined || sides.en === undefined) {
            missing.push(`${filename}: choose() pair carries only one language (${sides.bn ?? sides.en})`);
          } else if (/[A-Za-z]/.test(sides.bn) && !/[\u0980-\u09ff]/.test(sides.bn) && /[\u0980-\u09ff]/.test(sides.en)) {
            missing.push(`${filename}: choose() pair looks script-swapped (${sides.bn} / ${sides.en})`);
          } else {
            if (/[A-Za-z\u0980-\u09ff]/.test(sides.bn)) checked++;
            if (/[A-Za-z\u0980-\u09ff]/.test(sides.en)) checked++;
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  assert.ok(checked > 300, "Expected display text across all scanned components.");
  // API event/order identifiers are rendered as labels, but must remain canonical in requests.
  for (const value of ["create", "edit", "submit", "review", "request_correction", "resubmit", "approve", "reject", "cancel", "issue", "revoke", "renew", "topup", "subscription"]) {
    if (!/[\u0980-\u09ff]/.test(dictionaries.bn[value] ?? "")) missing.push(`Missing Bengali workflow label: ${value}`);
  }
  assert.deepEqual(missing, []);
});

test("geography source: checksums, strict UTF-8/NFC, unique IDs, typed parents and all derived wards", () => {
  let parents: Set<string> | undefined;
  const evidence: any = { status: "RUNNING", checkedAt: new Date().toISOString(), method: "Independent verification of supplied bytes; does not certify current official boundaries.", files: [] };
  for (const descriptor of source) {
    const bytes = fs.readFileSync(`data/geo/${descriptor.level}.json`);
    assert.notEqual(bytes.subarray(0, 3).toString("hex"), "efbbbf");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    assert.deepEqual(Buffer.from(text, "utf8"), bytes);
    const records: Place[] = JSON.parse(text);
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(hash, descriptor.hash, `${descriptor.level}: supplied checksum changed`);
    assert.equal(records.length, descriptor.count);
    const codes = new Set(records.map((row) => row.code));
    assert.equal(codes.size, records.length, `${descriptor.level}: duplicate codes`);
    const duplicateGroups = (name: "nameEn" | "nameBn", withinParent: boolean) => {
      const groups = new Map<string, string[]>();
      for (const row of records) {
        const parent = withinParent && descriptor.parent ? row[descriptor.parent] : "";
        const key = `${parent}|${row[name].normalize("NFC").toLocaleLowerCase("en").trim()}`;
        groups.set(key, [...(groups.get(key) ?? []), row.code]);
      }
      return [...groups.values()].filter((group) => group.length > 1);
    };
    const expectedKeys = ["code", "nameEn", "nameBn", ...(descriptor.parent ? [descriptor.parent] : [])].sort();
    for (const row of records) {
      assert.deepEqual(Object.keys(row).sort(), expectedKeys);
      for (const [key, value] of Object.entries(row)) {
        assert.equal(typeof value, "string");
        assert.ok(value.length && value === value.trim(), `${row.code}.${key}: blank or untrimmed`);
        assert.equal(value.normalize("NFC"), value, `${row.code}.${key}: not NFC`);
        assert.doesNotMatch(value, /[\u202a-\u202e\u2066-\u2069]/, `${row.code}.${key}: bidi format control`);
      }
      if (descriptor.parent) assert.ok(parents!.has(row[descriptor.parent]!), `${row.code}: parent missing or wrong level`);
    }
    evidence.files.push({ file: `${descriptor.level}.json`, records: records.length, sha256: hash, uniqueCodes: true, orphanCount: 0, utf8Nfc: true, sameParentEnglishDuplicateGroups: duplicateGroups("nameEn", true), sameParentBengaliDuplicateGroups: duplicateGroups("nameBn", true), globalEnglishRepeatedNameGroups: duplicateGroups("nameEn", false).length, globalBengaliRepeatedNameGroups: duplicateGroups("nameBn", false).length });
    parents = codes;
  }
  const upazilas = readSource("upazilas"), unions = readSource("unions"), wards = readSource("wards");
  const withUnions = new Set(unions.map((row) => row.upazilaCode));
  const emptyUpazilas = upazilas.filter((row) => !withUnions.has(row.code));
  assert.deepEqual(emptyUpazilas.map((row) => row.code), ["upa-388"]);
  const wardMap = new Map<string, Place[]>();
  for (const ward of wards) wardMap.set(ward.unionCode!, [...(wardMap.get(ward.unionCode!) ?? []), ward]);
  for (const union of unions) {
    const children = wardMap.get(union.code)!;
    assert.equal(children.length, 9);
    assert.deepEqual(children.map((row) => row.code).sort(), Array.from({ length: 9 }, (_, i) => `${union.code}-w${String(i + 1).padStart(2, "0")}`));
  }
  evidence.status = "PASS_WITH_WARNINGS";
  evidence.emptyUpazilas = emptyUpazilas;
  evidence.warnings = ["Community data: IDs are not BBS codes.", "Same-parent names may conflict; retain IDs and full bilingual names.", "Shaistaganj (upa-388) has no supplied unions.", "41,274 wards are derived numbered rural wards; they are not boundary/gazette records.", "City-corporation and municipality wards are outside the source scope."];
  evidence.totalRecords = source.reduce((sum, item) => sum + item.count, 0);
  fs.mkdirSync("execution", { recursive: true });
  fs.writeFileSync("execution/geography-dataset-validation.json", JSON.stringify(evidence, null, 2));
});

const origin = "http://127.0.0.1:5173";
async function launch() {
  const local = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (fs.existsSync(local) ? fs.readdirSync(local).filter((name) => /^chromium-/.test(name)).sort().reverse().map((name) => path.join(local, name, "chrome-win64", "chrome.exe")).find((name) => fs.existsSync(name)) : undefined);
  return chromium.launch({ headless: true, executablePath });
}
async function choose(page: Page, level: string, code: string) {
  const selector = page.locator(`#signup-geo-${level}`);
  await selector.locator(`option[value="${code}"]`).waitFor({ state: "attached" });
  await selector.selectOption(code);
}

test("geography browser: mobile cascade uses parent IDs, clears descendants and handles a source coverage gap", { timeout: 45000 }, async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  const errors: string[] = [];
  const lookupRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.url().includes("/geography/")) lookupRequests.push(request.url()); });
  const union = readSource("unions").find((row) => row.upazilaCode === "upa-001")!;
  // BUNDLE06-R5 C4: the registration form is a stepper, so the account
  // fields live on a later step — onboard a mapped office for this union
  // first so the flow can reach them.
  const officeName = `Cascade Union Office ${Date.now()}`;
  {
    const owner = await browser.newContext();
    const login = await owner.request.post(`${origin}/api/v1/auth/login`, { data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" } });
    const created = await owner.request.post(`${origin}/api/v1/owner/tenants`, {
      headers: { "X-CSRF-Token": (await login.json()).csrfToken },
      data: {
        slug: `cascade-union-${Date.now()}`,
        nameBn: "অবস্থান ইউনিয়ন অফিস",
        nameEn: officeName,
        officeType: "UNION",
        geography: { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001", unionCode: union.code },
        adminEmail: `admin@cascade-union-${Date.now()}.test`,
        adminName: "Cascade Union Admin",
        adminPassword: "Cascade-Union-Ad1!",
      },
    });
    assert.equal(created.status(), 201, await created.text());
    await owner.close();
  }
  try {
    await page.goto(`${origin}/register`);
    await choose(page, "division", "div-01");
    await choose(page, "district", "dis-01");
    await choose(page, "upazila", "upa-001");
    await choose(page, "union", union.code);
    await choose(page, "ward", `${union.code}-w01`);
    assert.equal(await page.locator("#signup-geo-ward option[value]:not([value=''])").count(), 9);
    assert.equal(await page.locator("#signup-geo-division option:checked").innerText(), "Dhaka");
    // Language switch on the area step keeps the selected geography.
    await page.getByRole("group", { name: "Language / ভাষা" }).getByRole("button", { name: "বাংলা", exact: true }).click();
    assert.equal(await page.locator("html").getAttribute("lang"), "bn");
    assert.equal(await page.locator("#signup-geo-division option:checked").innerText(), "ঢাকা");
    assert.equal(await page.locator("#signup-geo-ward").inputValue(), `${union.code}-w01`);
    await page.getByRole("group", { name: "Language / ভাষা" }).getByRole("button", { name: "English", exact: true }).click();
    // REG-UX Phase 1: one screen — the office picker sits under "Change" and
    // closes once an office is chosen; the typed fields stay on the same screen.
    const officeOption = page.locator("#signup-office option").filter({ hasText: officeName });
    await officeOption.waitFor({ state: "attached" });
    await page.getByLabel("Select office", { exact: true }).selectOption((await officeOption.getAttribute("value"))!);
    await page.locator(".du-signup-office-name").getByText(officeName).waitFor();
    await page.locator("#signup-name").fill("Preserve my draft");
    await page.getByRole("group", { name: "Language / ভাষা" }).getByRole("button", { name: "বাংলা", exact: true }).click();
    assert.equal(await page.locator("html").getAttribute("lang"), "bn");
    assert.equal(await page.locator("#signup-name").inputValue(), "Preserve my draft");
    await page.getByRole("group", { name: "Language / ভাষা" }).getByRole("button", { name: "English", exact: true }).click();
    assert.equal(await page.locator("#signup-name").inputValue(), "Preserve my draft");
    // Reopen the picker: the chosen area is kept, and changing the division still clears descendants.
    await page.getByRole("button", { name: "Change", exact: true }).click();
    assert.equal(await page.locator("#signup-geo-ward").inputValue(), `${union.code}-w01`);
    await choose(page, "division", "div-06");
    for (const level of ["district", "upazila", "union", "ward"]) assert.equal(await page.locator(`#signup-geo-${level}`).inputValue(), "", `${level} must clear after changing division`);
    const gap = readSource("upazilas").find((row) => row.code === "upa-388")!;
    await choose(page, "district", gap.districtCode!);
    await choose(page, "upazila", gap.code);
    await page.locator("#signup-geo-union-help").waitFor();
    assert.equal(await page.locator("#signup-geo-union option[value]:not([value=''])").count(), 0);
    assert.equal(await page.locator("#signup-geo-ward").isDisabled(), true);
    await choose(page, "division", "div-01");
    await page.locator('#signup-geo-district option[value="dis-01"]').waitFor({ state: "attached" });
    assert.equal(lookupRequests.filter((request) => request.endsWith("/geography/districts?parentCode=div-01")).length, 1, "Returning to a parent should reuse its lookup cache");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    fs.mkdirSync("execution/screenshots", { recursive: true });
    await page.screenshot({ path: "execution/screenshots/geography-registration-mobile.png", fullPage: true });
  } finally { await browser.close(); }
});

test("geography browser: failed child lookup exposes retry and a retry retrieves real districts", { timeout: 30000 }, async () => {
  const browser = await launch(), page = await browser.newPage();
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  let attempts = 0;
  try {
    await page.route("**/api/v1/geography/districts?parentCode=div-01", async (route) => {
      attempts++;
      if (attempts === 1) await route.abort("failed");
      else await route.continue();
    });
    await page.goto(`${origin}/register`);
    await choose(page, "division", "div-01");
    await page.locator("#signup-geo-district-help").getByRole("button", { name: /Retry.*district/i }).click();
    await choose(page, "district", "dis-01");
    assert.equal(attempts, 2);
    assert.equal(await page.locator("#signup-geo-district").inputValue(), "dis-01");
    assert.equal(await page.locator("#signup-geo-district-help").count(), 0);
  } finally { await browser.close(); }
});

test("geography browser: mobile registration derives the office's area and a server-generated reference", { timeout: 60000 }, async () => {
  const browser = await launch(), page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });
  const union = readSource("unions").find((row) => row.upazilaCode === "upa-001")!;
  const geo = { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001", unionCode: union.code, wardCode: `${union.code}-w01` };
  const email = `geography-browser-${Date.now()}@example.test`;
  const password = "Geo-Browser-Pa1!";
  // Phase 3E (§3.6): registration only offers offices that serve the selected
  // union — onboard a mapped office for this union first.
  const officeName = `Geography Union Office ${Date.now()}`;
  {
    const owner = await browser.newContext();
    const login = await owner.request.post(`${origin}/api/v1/auth/login`, { data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" } });
    const created = await owner.request.post(`${origin}/api/v1/owner/tenants`, {
      headers: { "X-CSRF-Token": (await login.json()).csrfToken },
      data: {
        slug: `geography-union-${Date.now()}`,
        nameBn: "অবস্থান ইউনিয়ন অফিস",
        nameEn: officeName,
        officeType: "UNION",
        geography: { divisionCode: geo.divisionCode, districtCode: geo.districtCode, upazilaCode: geo.upazilaCode, unionCode: geo.unionCode },
        adminEmail: `admin@geography-union-${Date.now()}.test`,
        adminName: "Geography Union Admin",
        adminPassword: "Geo-Union-Admin1!",
      },
    });
    assert.equal(created.status(), 201, await created.text());
    await owner.close();
  }
  try {
    await page.goto(`${origin}/register`);
    // REG-UX Phase 1: one screen — "Create account" is there from the start.
    await page.getByRole("button", { name: "Create account", exact: true }).waitFor();
    const { wardCode: _ward, ...officeArea } = geo;
    for (const [level, code] of Object.entries(officeArea)) await choose(page, level.replace("Code", ""), code);
    const option = page.locator("#signup-office option").filter({ hasText: officeName });
    await option.waitFor({ state: "attached" });
    const office = await option.getAttribute("value");
    assert.ok(office);
    await page.locator("#signup-office").selectOption(office);
    const fields = { name: "Geography Browser Citizen", mobile: `018${String(Date.now()).slice(-8)}`, password, email };
    for (const [field, value] of Object.entries(fields)) await page.locator(`#signup-${field}`).fill(value);
    assert.equal(await page.locator("#signup-syntheticReference").count(), 0);
    const submitted = page.waitForResponse((response) => response.url().endsWith("/auth/signup") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    const response = await submitted;
    assert.equal(response.status(), 201, await response.text());
    // The short form makes no area claim: the area is the office's own; the ward is deferred.
    assert.equal("geography" in response.request().postDataJSON(), false);
    await page.getByRole("heading", { name: "Account created", exact: true }).waitFor();
    const loggedIn = await page.request.post(`${origin}/api/v1/auth/login`, { data: { email, password } });
    assert.equal(loggedIn.status(), 200);
    const session = await loggedIn.json();
    const profile = await page.request.get(`${origin}/api/v1/profile`);
    assert.equal(profile.status(), 200);
    const saved = await profile.json();
    assert.deepEqual(saved.geography, officeArea);
    assert.equal("syntheticReference" in response.request().postDataJSON(), false);
    const citizens = await page.request.get(`${origin}/api/v1/citizens`);
    assert.equal(citizens.status(), 200);
    const ownCitizen = (await citizens.json()).items.find((citizen: any) => citizen.nameEn === fields.name);
    assert.ok(ownCitizen);
    // CERTNO-01: server-generated citizen references use the 16-digit public
    // format (Dhaka date + 8 random digits), not the old REF-<uuid>.
    assert.match(ownCitizen.syntheticReference, /^\d{16}$/);
    await page.request.post(`${origin}/api/v1/auth/logout`, { data: {}, headers: { "X-CSRF-Token": session.csrfToken } });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: "execution/screenshots/geography-registration-complete.png", fullPage: true });
  } finally { await browser.close(); }
});

test("language browser: preference persists across public pages and authenticated workspace", { timeout: 45000 }, async () => {
  const browser = await launch(), page = await browser.newPage();
  // BUNDLE06-R5 C4: the stepper's buttons are labelled by language, so
  // start in English like the sibling tests (the test switches to Bangla
  // itself below); without this the page defaults to Bangla and there is
  // no button named "Continue".
  await page.addInitScript(() => { if (!localStorage.getItem("astra.language")) localStorage.setItem("astra.language", "en"); });

  // BUNDLE06-R5 C4: the registration form is a stepper — the email field
  // lives on the account step, so reach it through area + office first.
  const union = readSource("unions").find((row) => row.upazilaCode === "upa-001")!;
  const officeName = `Language Union Office ${Date.now()}`;
  try {
    // BUNDLE06-R5: office setup lives inside try so a setup failure still
    // reaches finally/browser.close() — a throw before try stranded the
    // browser and hung this file for 17 minutes in the first rerun.
    // (Admin passwords cap at 18 chars: "Language-Union-Ad1!" is 19 and
    // was rejected with 422 INPUT_INVALID.)
    const owner = await browser.newContext();
    const login = await owner.request.post(`${origin}/api/v1/auth/login`, { data: { email: "owner@astra.demo.test", password: "Demo-Phase1!" } });
    const created = await owner.request.post(`${origin}/api/v1/owner/tenants`, {
      headers: { "X-CSRF-Token": (await login.json()).csrfToken },
      data: {
        slug: `language-union-${Date.now()}`,
        nameBn: "ভাষা ইউনিয়ন অফিস",
        nameEn: officeName,
        officeType: "UNION",
        geography: { divisionCode: "div-01", districtCode: "dis-01", upazilaCode: "upa-001", unionCode: union.code },
        adminEmail: `admin@language-union-${Date.now()}.test`,
        adminName: "Language Union Admin",
        adminPassword: "Language-Union-A1!",
      },
    });
    assert.equal(created.status(), 201, await created.text());
    await owner.close();
    await page.goto(`${origin}/register`);
    for (const [level, code] of [["division", "div-01"], ["district", "dis-01"], ["upazila", "upa-001"], ["union", union.code], ["ward", `${union.code}-w01`]]) await choose(page, level, code);
    const officeOption = page.locator("#signup-office option").filter({ hasText: officeName });
    await officeOption.waitFor({ state: "attached" });
    await page.getByLabel("Select office", { exact: true }).selectOption((await officeOption.getAttribute("value"))!);
    await page.locator("#signup-email").fill("language-retention@example.test");
    await page.getByRole("group", { name: "Language / ভাষা" }).getByRole("button", { name: "বাংলা", exact: true }).click();
    assert.equal(await page.locator("#signup-email").inputValue(), "language-retention@example.test");
    // Still in Bangla here (the page tour below asserts bn persists): reopen the
    // office picker with its Bangla label; the chosen area is kept.
    await page.getByRole("button", { name: "অন্য ইউনিয়নের হলে বদলান", exact: true }).click();
    assert.equal(await page.locator("#signup-geo-division").inputValue(), "div-01");
    for (const route of ["/services", "/offices", "/notices", "/help", "/verify", "/tracking", "/policies"]) {
      await page.goto(origin + route);
      assert.equal(await page.locator("html").getAttribute("lang"), "bn", route);
      await page.getByRole("button", { name: "বাংলা", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "বাংলা", exact: true }).getAttribute("aria-pressed"), "true");
      assert.doesNotMatch(await page.locator("#public-content").getByRole("heading").first().innerText({ timeout: 5000 }), /Page not found|পৃষ্ঠা পাওয়া যায়নি/, route);
    }
    await page.goto(`${origin}/login`);
    await page.locator('#email').fill("admin@alpha.local.test");
    await page.locator('#password').fill("Demo-Phase1!");
    await page.getByRole("button", { name: /প্রবেশ করুন|সাইন ইন/ }).click();
    await page.getByRole("button", { name: /বের হন|সাইন আউট|বের হয়ে যান/ }).waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "bn");
    const tabs = page.getByRole("navigation", { name: "কর্মক্ষেত্রের নেভিগেশন" }).getByRole("button");
    const count = await tabs.count();
    assert.ok(count >= 8);
    for (let i = 0; i < count; i++) {
      await tabs.nth(i).click();
      assert.equal(await page.locator("html").getAttribute("lang"), "bn");
    }
    await tabs.filter({ hasText: /^আবেদন$/ }).click();
    const filtered = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === "/api/v1/applications" && url.searchParams.get("state") === "DRAFT";
    });
    await page.locator("#state-filter").selectOption("DRAFT");
    assert.equal((await filtered).status(), 200, "Bengali status labels must preserve the canonical API filter value");
    assert.equal(await page.locator("#state-filter").inputValue(), "DRAFT");
    await page.getByRole("group", { name: "Language / ভাষা" }).getByRole("button", { name: "English", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
  } finally { await browser.close(); }
});
