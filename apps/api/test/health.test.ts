import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";

let server: ReturnType<typeof app.listen>, base: string;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("health reports which optional keys are configured as true/false only, never their values", async () => {
  const r = await fetch(`${base}/api/v1/health`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.status, "ok");
  assert.deepEqual(Object.keys(body.features).sort(), ["citizenIdentityNumbers", "emailDelivery", "officeMerchantCredentials", "orderPayments", "signInIdentifiers"]);
  for (const value of Object.values(body.features)) assert.equal(typeof value, "boolean");
  // Outside production a development key file is used, so every feature is available in tests.
  // Phase X: emailDelivery joins the set — outside production the mailer defaults to the log provider.
  assert.deepEqual(body.features, { signInIdentifiers: true, citizenIdentityNumbers: true, officeMerchantCredentials: true, emailDelivery: true, orderPayments: false });
  for (const secret of [process.env.MFA_ENCRYPTION_KEY, process.env.CITIZEN_DATA_KEY, process.env.MERCHANT_SECRET_KEY, process.env.IDENTIFIER_SECRET])
    if (secret) assert.equal(JSON.stringify(body).includes(secret), false);
});
