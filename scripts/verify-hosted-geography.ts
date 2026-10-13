/** Read-only deployed geography checks. Set ASTRA_LIVE_URL to the authorized HTTPS origin. */
import assert from "node:assert/strict";
import fs from "node:fs";

const supplied = process.env.ASTRA_LIVE_URL;
assert.ok(supplied, "Set ASTRA_LIVE_URL to the deployed HTTPS origin.");
const url = new URL(supplied);
assert.equal(url.protocol, "https:");
assert.equal(url.username + url.password + url.search + url.hash, "");
assert.equal(url.pathname, "/");
const base = url.origin;
const evidence: any = { baseUrl: base, status: "RUNNING", startedAt: new Date().toISOString(), mutationScope: "None: all remote requests are unauthenticated GETs.", checks: [] };
const output = "execution/geography-hosted-qa.json";
fs.mkdirSync("execution", { recursive: true });
const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
save();
type Place = { code: string; nameEn: string; nameBn: string; parentCode?: string | null };
const source = (level: string): any[] => JSON.parse(fs.readFileSync(`data/geo/${level}.json`, "utf8"));
async function get(route: string, expected = 200) {
  assert.ok(route.startsWith("/") && !route.startsWith("//"));
  const response = await fetch(`${base}/api/v1${route}`, { redirect: "error", signal: AbortSignal.timeout(180_000), headers: { Accept: "application/json" } });
  assert.equal(response.status, expected, `GET ${route} expected ${expected}, received ${response.status}`);
  assert.ok(response.headers.get("content-type")?.includes("application/json"));
  return { body: await response.json(), headers: response.headers };
}
async function check(name: string, run: () => Promise<unknown>) {
  const start = Date.now();
  try {
    evidence.checks.push({ name, status: "PASS", evidence: await run(), durationMs: Date.now() - start });
    save(); console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Geography verification failed";
    evidence.checks.push({ name, status: "FAIL", message, durationMs: Date.now() - start });
    save(); throw new Error(`${name}: ${message}`);
  }
}
function compare(records: Place[], expected: any[], parentField?: string) {
  assert.equal(records.length, expected.length);
  const actual = new Map(records.map((row) => [row.code, row]));
  assert.equal(actual.size, records.length);
  for (const row of expected) {
    const matched = actual.get(row.code);
    assert.ok(matched, `Missing ${row.code}`);
    assert.equal(matched.nameEn, row.nameEn);
    assert.equal(matched.nameBn, row.nameBn);
    if (parentField) assert.equal(matched.parentCode, row[parentField]);
  }
}
try {
  await check("01 Metadata preserves counts and truthful data scope", async () => {
    const { body } = await get("/geography/metadata");
    assert.deepEqual(body.counts, { divisions: 8, districts: 64, upazilas: 495, unions: 4586, wards: 41274 });
    assert.equal(body.identifiersAreOfficial, false);
    assert.equal(body.wardsDerived, true);
    assert.ok(body.coverage && body.limitations);
    return body;
  });
  await check("02 Eight divisions and all 64 districts match supplied bilingual records", async () => {
    const divisions = await get("/geography/divisions");
    compare(divisions.body.items, source("divisions"));
    assert.equal(divisions.body.total, 8);
    const districtSource = source("districts");
    let total = 0;
    for (const division of divisions.body.items as Place[]) {
      const result = await get(`/geography/districts?parentCode=${division.code}`);
      compare(result.body.items, districtSource.filter((row) => row.divisionCode === division.code), "divisionCode");
      assert.equal(result.body.total, result.body.items.length);
      total += result.body.total;
    }
    assert.equal(total, 64);
    return { divisions: 8, districts: total, namesAndParentsMatchSource: true, cacheControl: divisions.headers.get("cache-control") };
  });
  await check("03 Full parent-filtered route in each division returns exact source children", async () => {
    const districts = source("districts"), upazilas = source("upazilas"), unions = source("unions"), wards = source("wards");
    const paths = [];
    for (const division of source("divisions")) {
      const district = districts.find((row) => row.divisionCode === division.code)!;
      const upazila = upazilas.find((row) => row.districtCode === district.code && unions.some((union) => union.upazilaCode === row.code))!;
      const union = unions.find((row) => row.upazilaCode === upazila.code)!;
      for (const [level, parentCode, expected, field] of [
        ["upazilas", district.code, upazilas.filter((row) => row.districtCode === district.code), "districtCode"],
        ["unions", upazila.code, unions.filter((row) => row.upazilaCode === upazila.code), "upazilaCode"],
        ["wards", union.code, wards.filter((row) => row.unionCode === union.code), "unionCode"],
      ] as const) {
        const result = await get(`/geography/${level}?parentCode=${parentCode}`);
        compare(result.body.items, expected, field);
        assert.equal(result.body.total, expected.length);
      }
      paths.push({ divisionCode: division.code, districtCode: district.code, upazilaCode: upazila.code, unionCode: union.code, wards: 9 });
    }
    return { paths, sampledDivisionCoverage: "8/8", scope: "Representative complete paths, not exhaustive validation of every hosted row." };
  });
  await check("04 Missing, wrong-level and unknown parents are rejected; coverage gap remains empty", async () => {
    for (const level of ["districts", "upazilas", "unions", "wards"]) await get(`/geography/${level}`, 400);
    await get("/geography/districts?parentCode=upa-001", 404);
    await get("/geography/districts?parentCode=div-99", 404);
    const gap = await get("/geography/unions?parentCode=upa-388");
    assert.equal(gap.body.total, 0);
    assert.deepEqual(gap.body.items, []);
    return { missingParent: 400, wrongLevelParent: 404, nonexistentParent: 404, shaistaganjUnionCount: 0 };
  });
  await check("05 Directory code filter does not invent a participating office for a geography record", async () => {
    const divisions = source("divisions");
    const results = [];
    for (const division of [divisions[0], divisions[5]]) {
      const r = await get(`/offices?divisionCode=${division.code}&pageSize=100`);
      const items = r.body.items ?? r.body.offices;
      assert.ok(Array.isArray(items));
      for (const office of items) assert.equal(office.divisionCode ?? office.geography?.divisionCode, division.code);
      results.push({ divisionCode: division.code, matchingOfficesOnPage: items.length, total: r.body.total });
    }
    return { filters: results, explicitOfficeEnrollmentRequired: true };
  });
  evidence.status = "PASS";
} catch (error) {
  evidence.status = "FAIL";
  console.error(error instanceof Error ? error.message : "Hosted geography QA failed.");
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  evidence.passed = evidence.checks.filter((item: any) => item.status === "PASS").length;
  evidence.failed = evidence.checks.filter((item: any) => item.status === "FAIL").length;
  save();
  console.log(`${evidence.status}: ${evidence.passed} geography checks passed; ${evidence.failed} failed. Evidence: ${output}`);
}
