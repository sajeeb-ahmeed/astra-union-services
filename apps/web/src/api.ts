export class ApiError extends Error {
  constructor(
    message: string,
    public details: any,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Phase 5 (5A): the CSRF token is stored together with the id of the user it was issued to.
 *
 * Root cause of the live session failures: the token used to be a bare module variable and the
 * workspace never re-checked which session the browser cookie actually held. When a second
 * account (or a second sign-in of the same account) replaced the cookie in the same browser,
 * the open tab kept sending the previous session's token: every POST failed with
 * CSRF_REQUIRED, sign-out — itself a CSRF-protected POST — failed the same way, and the tab
 * kept rendering the first account's shell over the second account's data.
 *
 * The fix keeps the server contract unchanged (a stale token is still rejected): on a
 * CSRF_REQUIRED rejection the client re-reads /auth/me once. If the browser session still
 * belongs to the same user, the fresh token is adopted and the request is retried once — the
 * rejected attempt was stopped by the auth middleware before any handler ran, so a retry
 * cannot double-apply it. If the session now belongs to a different user, the request is NOT
 * retried under the wrong account; a session-changed event lets the app shell swap the
 * workspace to the account that is actually signed in. If the session is gone, the shell
 * returns to the sign-in portal.
 */
let csrfToken = "";
let csrfUserId = "";
let resyncInFlight: Promise<"same" | "changed" | "expired" | "unknown"> | null =
  null;

/** Adopt the session material from a response that carries it (sign-in, MFA verify, /auth/me). */
export function adoptSession(data: any) {
  if (data?.csrfToken) {
    csrfToken = data.csrfToken;
    if (data?.user?.id) csrfUserId = data.user.id;
  }
}

export function clearSessionToken() {
  csrfToken = "";
  csrfUserId = "";
}

function notifySessionChanged() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("astra:session-changed"));
}

function resyncSession() {
  if (!resyncInFlight) {
    const before = csrfUserId;
    resyncInFlight = (async () => {
      try {
        const response = await fetch("/api/v1/auth/me", {
          credentials: "include",
        });
        // Consume the body on every path (see main.tsx): an unread body leaves the
        // request open in the browser's network stack.
        const data = await response.json().catch(() => null);
        if (response.status === 401) {
          clearSessionToken();
          return "expired" as const;
        }
        // QAFIX-09 (B3): a cookie-less resync now answers with the
        // anonymous 200 (user: null) instead of 401 — the session
        // is gone either way, so it takes the same "expired" path
        // the 401 used to.
        if (response.ok && !data?.user) {
          clearSessionToken();
          return "expired" as const;
        }
        if (!response.ok) return "unknown" as const;
        if (!data?.csrfToken || !data?.user?.id) return "unknown" as const;
        adoptSession(data);
        return before && data.user.id !== before
          ? ("changed" as const)
          : ("same" as const);
      } catch {
        return "unknown" as const;
      } finally {
        resyncInFlight = null;
      }
    })();
  }
  return resyncInFlight;
}

async function request<T>(
  path: string,
  method: string,
  body: unknown,
  retried: boolean,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(csrfToken && method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response
    .json()
    .catch(() => ({ message: "Server response could not be read." }));
  if (!response.ok) {
    // WS-D1 (finding 6): a single transient 401 on a GET must not log the
    // chairman out. Live showed one 401 on the ISSUED filter while the
    // session was valid until 19:34, then a logout ~10 s later — the
    // session-changed revalidation below is what drops the session. A GET
    // is idempotent, so on a 401 it is re-read once after a session
    // resync: if /auth/me still holds the same user, the 401 was spurious
    // and the retry succeeds with no banner and no logout. If the session
    // is really gone or belongs to someone else, the resync reports
    // expired/changed and the existing path below drops to sign-in
    // exactly as before. One retry only (retried), never a loop; POSTs
    // are never retried on a 401 — a retry could double-apply them.
    if (!retried && method === "GET" && response.status === 401) {
      const outcome = await resyncSession();
      if (outcome === "same") return request(path, method, body, true);
    }
    if (
      !retried &&
      method !== "GET" &&
      response.status === 403 &&
      data?.error?.code === "CSRF_REQUIRED"
    ) {
      const outcome = await resyncSession();
      if (outcome === "same") return request(path, method, body, true);
      if (outcome === "changed" || outcome === "expired") {
        notifySessionChanged();
        if (outcome === "expired")
          throw new ApiError(
            "Sign in required.",
            { error: { code: "LOGIN_REQUIRED", message: "Sign in required." } },
            401,
          );
        throw new ApiError(
          "The signed-in account changed in this browser, so this action was not sent. The workspace now shows the account that is actually signed in.",
          {
            error: {
              code: "SESSION_CHANGED",
              message:
                "The signed-in account changed in this browser; the action was not sent.",
            },
          },
          409,
        );
      }
    }
    // A 401 anywhere means the browser no longer holds the session this tab was built on;
    // let the app shell revalidate and drop to the sign-in portal instead of leaving a
    // dead workspace on screen.
    if (response.status === 401) notifySessionChanged();
    throw new ApiError(
      data.error?.message ||
        data.error ||
        data.message ||
        `Request failed (${response.status})`,
      data,
      response.status,
    );
  }
  adoptSession(data);
  return data;
}

export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  return request<T>(path, method, body, false);
}
export const items = (value: any): any[] =>
  Array.isArray(value)
    ? value
    : value?.items ||
      value?.applications ||
      value?.citizens ||
      value?.services ||
      value?.tenants ||
      [];

/**
 * REG-UX §4.3 (the F2 pattern): an API refusal mapped to the form fields it belongs
 * to — `error.field` (a named field error such as EMAIL_TAKEN) and each zod issue's
 * first path segment. Returns {} for errors that belong to no field (network, 5xx),
 * which the caller shows as a page-level alert instead.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  const body = error instanceof ApiError ? error.details?.error : undefined;
  if (!body) return {};
  const out: Record<string, string> = {};
  if (typeof body.field === "string") out[body.field] = String(body.message ?? "");
  if (Array.isArray(body.issues))
    for (const issue of body.issues) {
      const key = String(issue?.path ?? "").split(".")[0];
      if (key && !out[key]) out[key] = String(issue.message ?? "");
    }
  return out;
}
export const errorCode = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.details?.error?.code : undefined;
