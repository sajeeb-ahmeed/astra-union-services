/** Hosted fail-closed QA only: existing synthetic order fixture; no provider calls or paid records. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

const origin = new URL(process.env.ASTRA_LIVE_URL ?? '');
assert.equal(origin.protocol, 'https:');
assert.equal(origin.pathname, '/');
assert.equal(origin.username + origin.password + origin.search + origin.hash, '');
const base = origin.origin;
const config = JSON.parse(fs.readFileSync('.runtime/hosted/credentials.json', 'utf8'));
assert.equal(config.publicOrigin, base, 'Exact authorized origin required.');
const prior = JSON.parse(fs.readFileSync('execution/hosted-orders-qa.json', 'utf8'));
assert.equal(prior.status, 'PASS');
const qa = JSON.parse(fs.readFileSync('.runtime/hosted/qa-credentials.json', 'utf8')).runs.find((x: any) => x.runId === prior.runId);
assert.equal(qa?.kind, 'HOSTED_ORDERS_QA');
assert.equal(qa.baseUrl, base);
assert.equal(qa.lastStatus, 'PASS');
const appId = qa.applications.positive;
assert.match(appId, /^[a-f0-9-]{36}$/);
const evidence: any = { startedAt: new Date().toISOString(), baseUrl: base, sourceRunId: qa.runId,
  status: 'RUNNING', scope: 'Existing synthetic office. Sessions and denied requests only; no real payment, provider mock, or domain creation.', checks: [] };
const sessions: Record<string, { cookie: string; csrf: string }> = {};
const save = () => fs.writeFileSync('execution/payments-hosted-qa.json', JSON.stringify(evidence, null, 2));
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
async function request(method: string, route: string, role?: string, body?: any) {
  assert.ok(route.startsWith('/') && !route.startsWith('//'));
  assert.ok(method === 'GET' || ['/auth/login', '/auth/logout', `/applications/${appId}/payments`].includes(route), 'Mutation outside QA scope');
  const session = role ? sessions[role] : undefined;
  const response = await fetch(`${base}/api/v1${route}`, { method, redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { Origin: base, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, headers: response.headers, body: response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}
async function check(name: string, fn: () => Promise<any>) {
  const start = Date.now();
  try { evidence.checks.push({ name, status: 'PASS', evidence: await fn(), durationMs: Date.now() - start }); console.log(`PASS ${name}`); }
  catch { evidence.checks.push({ name, status: 'FAIL' }); throw Error(`${name} failed; response values withheld.`); }
  finally { save(); }
}
let beforeWallet: any, beforeApp: any, beforePdfHash: string;
try {
  await check('01 Existing staff and admin authenticate with secure sessions', async () => {
    for (const role of ['admin', 'staff']) {
      const account = qa.accounts[role];
      const r = await request('POST', '/auth/login', undefined, { email: account.email, password: account.password });
      assert.equal(r.status, 200); assert.equal(r.body.user.role, role); assert.equal(r.body.user.tenantId, qa.offices.primary.id);
      const cookie = r.headers.get('set-cookie')!; assert.match(cookie, /Secure/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
      sessions[role] = { cookie: cookie.split(';')[0]!, csrf: r.body.csrfToken };
    }
    beforeWallet = (await request('GET', '/wallet', 'admin')).body;
    beforeApp = (await request('GET', `/applications/${appId}`, 'admin')).body;
    const pdf = await request('GET', `/certificates/${qa.certificateId}/pdf`, 'admin'); assert.equal(pdf.status, 200);
    beforePdfHash = createHash('sha256').update(pdf.body).digest('hex');
    return { roles: ['admin', 'staff'], secureCookies: true };
  });
  await check('02 Unconfigured bKash, Nagad and bank payouts are reported honestly', async () => {
    const r = await request('GET', '/payments/configuration', 'admin'); assert.equal(r.status, 200);
    assert.equal(r.body.available, false); assert.equal(r.body.configured, false);
    assert.equal(r.body.environment, 'DISABLED'); assert.equal(r.body.bankSettlement, 'NOT_CONNECTED');
    assert.equal(r.body.nagad.configured, false); assert.equal(r.body.nagad.reason, 'NOT_INTEGRATED');
    return r.body;
  });
  await check('03 Approved positive-fee application remains unpaid without a receipt', async () => {
    const r = await request('GET', `/applications/${appId}/payment`, 'admin'); assert.equal(r.status, 200);
    assert.equal(r.body.totalMinor, 15210); assert.equal(r.body.paymentStatus, 'NOT_COLLECTED'); assert.equal(r.body.attempt, null); assert.equal(r.body.receipt, null);
    return { totalMinor: r.body.totalMinor, paymentStatus: r.body.paymentStatus, receipt: null };
  });
  await check('04 Checkout fails closed before creating any provider attempt', async () => {
    const r = await request('POST', `/applications/${appId}/payments`, 'admin', { provider: 'BKASH', requestKey: randomUUID() });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'GATEWAY_NOT_CONFIGURED');
    const after = await request('GET', `/applications/${appId}/payment`, 'admin'); assert.equal(after.body.attempt, null); assert.equal(after.body.receipt, null);
    return { http: r.status, code: r.body.error.code, attemptCreated: false };
  });
  await check('05 Payment register and reconciliation show no invented collections', async () => {
    const list = await request('GET', '/payments', 'admin'); assert.equal(list.status, 200); assert.equal(list.body.total, 0);
    const r = await request('GET', `/payments/reconciliation?businessDate=${day}`, 'admin'); assert.equal(r.status, 200);
    assert.equal(r.body.paidMinor, 0); assert.equal(r.body.totalCount, 0); assert.equal(r.body.bankSettlement, 'NOT_CONNECTED');
    const csv = await request('GET', `/payments/reconciliation/export.csv?businessDate=${day}`, 'admin'); assert.equal(csv.status, 200);
    assert.equal(csv.body.toString('utf8').trim().split(/\r?\n/).length, 1);
    const denied = await request('GET', `/payments/reconciliation?businessDate=${day}`, 'staff'); assert.equal(denied.status, 403);
    return { totalPayments: 0, paidMinor: 0, csvRows: 0, staffReconciliationDenied: true };
  });
  await check('06 Forged callback, receipt and unauthenticated requests cannot settle payments', async () => {
    const r = await request('GET', `/payments/bkash/callback/${randomBytes(32).toString('hex')}?paymentID=forged&status=success&signature=forged`); assert.equal(r.status, 404);
    assert.equal((await request('GET', `/receipts/${randomUUID()}`, 'admin')).status, 404);
    assert.equal((await request('GET', '/payments')).status, 401);
    return { forgedCallback: 404, nonexistentReceipt: 404, unauthenticated: 401 };
  });
  await check('07 Existing wallet, approval history and certificate PDF remain unchanged', async () => {
    assert.deepEqual((await request('GET', '/wallet', 'admin')).body, beforeWallet);
    assert.deepEqual((await request('GET', `/applications/${appId}`, 'admin')).body, beforeApp);
    const pdf = await request('GET', `/certificates/${qa.certificateId}/pdf`, 'admin'); assert.equal(pdf.status, 200);
    assert.equal(createHash('sha256').update(pdf.body).digest('hex'), beforePdfHash);
    return { unchangedWallet: true, unchangedApplication: true, unchangedPdf: true };
  });
  evidence.status = 'PASS';
} catch (error) { evidence.status = 'FAIL'; console.error(error instanceof Error ? error.message : 'Hosted payment QA failed.'); process.exitCode = 1; }
finally {
  evidence.loggedOut = [];
  for (const role of Object.keys(sessions)) try { const r = await request('POST', '/auth/logout', role, {}); if (r.status === 200) evidence.loggedOut.push(role); } catch { /* No mutation retry. */ }
  evidence.finishedAt = new Date().toISOString(); save();
}
