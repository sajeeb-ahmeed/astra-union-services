import fs from "node:fs";
const filename = "apps/api/openapi.json";
const doc = JSON.parse(fs.readFileSync(filename, "utf8"));
doc.info.version = "0.6.0";
const errors = {
  "401": { description: "Missing, expired or revoked session." },
  "403": { description: "CSRF, origin or account access denied." },
  "422": { description: "Invalid request or current password mismatch." },
  "429": { description: "Security mutation rate limit reached." },
};
const json = (schema) => ({ "application/json": { schema } });
doc.paths["/api/v1/auth/sessions"] = { get: {
  summary: "Read aggregate active sessions for the authenticated account",
  description: "Returns counts and current expiry only. No session identifiers, cookies, tokens, IP addresses or user agents are exposed. Includes this account's active sessions across office memberships.",
  security: [{ session: [] }],
  responses: { "200": { description: "Own-account session summary", content: json({ type: "object", additionalProperties: false, required: ["activeSessions", "otherSessions", "currentSessionExpiresAt"], properties: { activeSessions: { type: "integer", minimum: 1 }, otherSessions: { type: "integer", minimum: 0 }, currentSessionExpiresAt: { type: "string", format: "date-time" } } }) }, "401": errors["401"], "403": errors["403"] },
} };
doc.paths["/api/v1/auth/sessions/revoke-others"] = { post: {
  summary: "Password-confirmed sign out of all other own-account sessions",
  description: "Serializes with password change, recovery and login on the account row. Rechecks the current session and password inside the transaction; retains this session. Tenant actions append an immutable audit event; platform-owner actions also write the durable platform security audit stream (S-014).",
  security: [{ session: [], csrf: [] }],
  requestBody: { required: true, content: json({ type: "object", additionalProperties: false, required: ["currentPassword"], properties: { currentPassword: { type: "string", minLength: 1, maxLength: 200, writeOnly: true } } }) },
  responses: { ...errors, "200": { description: "Other sessions revoked", content: json({ type: "object", additionalProperties: false, required: ["revoked", "remainingSessions"], properties: { revoked: { type: "integer", minimum: 0 }, remainingSessions: { type: "integer", const: 1 } } }) } },
} };
const password = doc.paths["/api/v1/auth/password"]?.post;
if (password) password.description = "Verify current password and session under account lock, change the password, invalidate pending trusted-channel recovery links and revoke all other sessions atomically. The current session remains active. Rate-limited; authenticated session, same origin and CSRF are required.";
fs.writeFileSync(filename, JSON.stringify(doc, null, 2) + "\n");
console.log("Updated account security OpenAPI contracts.");
