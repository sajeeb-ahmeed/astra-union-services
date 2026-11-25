import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, adoptSession, api, clearSessionToken } from "../src/api.js";

/**
 * WS-D1 (finding 6): the API client must survive a single transient 401
 * on a GET. Live showed one 401 on the ISSUED filter while the session was
 * valid until 19:34, then a forced logout ~10 s later. The client re-reads
 * the list once after a session resync: if /auth/me still holds the same
 * user, the 401 was spurious and the retry succeeds with no logout; if the
 * session is really gone, the 401 still surfaces as "Sign in required."
 *
 * The transport is stubbed at global fetch: in node there is no window, so
 * notifySessionChanged() is a no-op and the assertions are on the outcome
 * (resolved data vs. thrown ApiError), which is exactly what the workspace
 * renders from.
 */
function stubFetch(handler: (url: string) => { status: number; body: any }) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    calls.push(url);
    const { status, body } = handler(url);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    } as any;
  }) as any;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test("WS-D1 finding 6: a transient 401 on a GET is retried after resync and succeeds", async () => {
  adoptSession({ csrfToken: "old-token", user: { id: "u1" } });
  let listCalls = 0;
  const stub = stubFetch((url) => {
    if (url === "/api/v1/auth/me")
      return { status: 200, body: { user: { id: "u1" }, csrfToken: "fresh-token" } };
    if (url.startsWith("/api/v1/applications")) {
      listCalls++;
      if (listCalls === 1)
        return { status: 401, body: { error: { code: "LOGIN_REQUIRED", message: "Sign in required." } } };
      return { status: 200, body: { items: [{ reference: "2026112500000001" }], total: 1 } };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  try {
    const result = await api("/applications?state=ISSUED&pageSize=5");
    assert.equal(result.total, 1);
    assert.equal(listCalls, 2, "the list was fetched twice: 401, then the retry");
    assert.ok(stub.calls.includes("/api/v1/auth/me"), "the retry resynced the session first");
  } finally {
    stub.restore();
    clearSessionToken();
  }
});

test("WS-D1 finding 6: a real expiry still surfaces as Sign in required, with no retry", async () => {
  adoptSession({ csrfToken: "old-token", user: { id: "u1" } });
  let listCalls = 0;
  const stub = stubFetch((url) => {
    if (url === "/api/v1/auth/me")
      return { status: 401, body: { error: { code: "LOGIN_REQUIRED", message: "Sign in required." } } };
    if (url.startsWith("/api/v1/applications")) {
      listCalls++;
      return { status: 401, body: { error: { code: "LOGIN_REQUIRED", message: "Sign in required." } } };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  try {
    await assert.rejects(
      () => api("/applications?state=ISSUED&pageSize=5"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 401 &&
        error.message === "Sign in required.",
    );
    assert.equal(listCalls, 1, "an expired session is not retried");
  } finally {
    stub.restore();
    clearSessionToken();
  }
});

test("WS-D1 finding 6: the retry happens at most once", async () => {
  adoptSession({ csrfToken: "old-token", user: { id: "u1" } });
  let listCalls = 0;
  let meCalls = 0;
  const stub = stubFetch((url) => {
    if (url === "/api/v1/auth/me") {
      meCalls++;
      return { status: 200, body: { user: { id: "u1" }, csrfToken: "fresh-token" } };
    }
    if (url.startsWith("/api/v1/applications")) {
      listCalls++;
      return { status: 401, body: { error: { code: "LOGIN_REQUIRED", message: "Sign in required." } } };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  try {
    await assert.rejects(() => api("/applications?pageSize=5"), ApiError);
    assert.equal(listCalls, 2, "one retry, then the 401 stands");
    assert.equal(meCalls, 1, "one resync only");
  } finally {
    stub.restore();
    clearSessionToken();
  }
});
