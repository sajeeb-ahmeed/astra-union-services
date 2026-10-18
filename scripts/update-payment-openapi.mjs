import fs from "node:fs";

// Idempotent documentation patch; reads no credentials and calls no API or database.
const file = "apps/api/openapi.json";
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const text = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const timestamp = { type: "string", format: "date-time" };
const integer = (minimum, maximum = Number.MAX_SAFE_INTEGER) => ({
  type: "integer",
  minimum,
  maximum,
});
const amount = {
  ...integer(0, 400000000),
  description:
    "Integer BDT minor units; 100 = BDT 1.00. Separate from tenant SaaS credits.",
};
const paidAmount = { ...amount, minimum: 1 };
const environment = { type: "string", enum: ["SANDBOX", "LIVE"] };
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const json = (schema) => ({ "application/json": { schema } });
const noStore = {
  "Cache-Control": {
    schema: { const: "no-store" },
    description: "Payment and receipt responses are not cacheable.",
  },
};
const response = (description, schema = ref("Error")) => ({
  description,
  headers: noStore,
  content: json(schema),
});
const errors = {
  401: response("LOGIN_REQUIRED: session missing, expired or inactive."),
  403: response(
    "Role, active office membership, CSRF or supplied Origin denied.",
  ),
  404: response(
    "NOT_FOUND: record unavailable in the caller's authorized scope.",
  ),
  422: response(
    "INPUT_INVALID: invalid UUID, strict JSON body, filter or calendar date.",
  ),
};
const readSecurity = [{ session: [] }];
const writeSecurity = [{ session: [], csrf: [] }];
const idParameter = { name: "id", in: "path", required: true, schema: uuid };
const originParameter = {
  name: "Origin",
  in: "header",
  required: false,
  schema: { type: "string", format: "uri" },
  description:
    "When supplied on an authenticated mutation, must equal the configured PUBLIC_ORIGIN. X-CSRF-Token is required independently.",
};
const dayParameter = (required = true) => ({
  name: "businessDate",
  in: "query",
  required,
  schema: { type: "string", format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  description:
    "Valid calendar date YYYY-MM-DD. Payment attempts are selected by created_at in Asia/Dhaka; verification counts use checked_at in Asia/Dhaka. No timezone is accepted from the client.",
});
const pagination = [
  { name: "page", in: "query", schema: { ...integer(1, 100000), default: 1 } },
  {
    name: "pageSize",
    in: "query",
    schema: { ...integer(1, 100), default: 20 },
  },
];
const ownScope =
  "Active citizen (own application only), staff, admin, reviewer, approver or finance within the current office. The platform owner has no access through these tenant endpoints.";
const schemas = doc.components.schemas;
schemas.GatewayAvailability = object({
  provider: { const: "BKASH" },
  environment: { type: "string", enum: ["DISABLED", "SANDBOX", "LIVE"] },
  configured: { type: "boolean" },
  available: { type: "boolean" },
  reason: {
    type: "string",
    enum: [
      "MERCHANT_SETUP_REQUIRED",
      "OFFICE_GATEWAY_NOT_CONFIGURED",
      "LIVE_ACTIVATION_REQUIRED",
      "GATEWAY_CONFIGURATION_INVALID",
      "CONFIGURED",
      "TEST_TRANSPORT",
    ],
  },
  bankSettlement: { const: "NOT_CONNECTED" },
  nagad: object({
    configured: { const: false },
    reason: { const: "NOT_INTEGRATED" },
  }),
});
schemas.GatewayAvailability.description =
  "Availability is evaluated for the current office. Production defaults to DISABLED; approved merchant credentials, office binding and explicit live activation are required. TEST_TRANSPORT exists only under NODE_ENV=test. No credentials or provider tokens are returned.";
schemas.GatewayPaymentStatus = {
  type: "string",
  enum: [
    "CREATE_PENDING",
    "CREATE_UNKNOWN",
    "READY",
    "EXECUTE_PENDING",
    "VERIFYING",
    "PAID",
    "REVIEW_REQUIRED",
    "FAILED",
  ],
};
schemas.GatewayCheckDetails = object(
  {
    expected: object({
      provider: { const: "BKASH" },
      environment,
      paymentId: nullable(text),
      invoice: text,
      amountMinor: paidAmount,
      currency: { const: "BDT" },
    }),
    checkedAt: timestamp,
    query: object({
      paymentId: text,
      status: text,
      transactionId: nullable(text),
      invoice: text,
      amountMinor: integer(0),
      currency: text,
      intent: text,
    }),
    search: object(
      {
        transactionId: text,
        status: text,
        amountMinor: integer(0),
        currency: text,
        merchantMatched: { type: "boolean" },
        serviceFeeMinor: integer(0),
        creditedAmountMinor: integer(0),
      },
      ["transactionId", "status", "amountMinor", "currency", "merchantMatched"],
    ),
  },
  [],
);
schemas.GatewayCheckDetails.description =
  "Bounded expected/query/search financial fields recorded during a check. Query/search objects are absent if the earlier step could not complete. No credentials, wallet PIN, OTP or payer identity is exposed.";
schemas.GatewayLastReconciliation = object({
  result: { type: "string", enum: ["MATCHED", "MISMATCH", "PENDING", "ERROR"] },
  reason: text,
  checkedAt: timestamp,
  details: ref("GatewayCheckDetails"),
});
const attemptFields = {
  id: uuid,
  applicationId: uuid,
  provider: { const: "BKASH" },
  environment,
  status: ref("GatewayPaymentStatus"),
  paymentStatus: {
    type: "string",
    enum: ["PENDING", "COLLECTED", "REVIEW_REQUIRED"],
    description:
      "Current issuance eligibility projection. A historical PAID attempt can have REVIEW_REQUIRED after a later mismatch; original confirmation/receipt remain unchanged.",
  },
  lastReconciliation: nullable(ref("GatewayLastReconciliation")),
  amountMinor: paidAmount,
  currency: { const: "BDT" },
  invoice: text,
  checkoutUrl: {
    ...nullable({ type: "string", format: "uri" }),
    description:
      "Only returned while status is READY. The provider adapter validates HTTPS and the exact environment-specific bKash checkout hostname. Not a client-supplied URL.",
  },
  lastError: nullable(text),
  createdAt: timestamp,
  updatedAt: timestamp,
  receiptId: nullable(uuid),
};
schemas.GatewayPaymentAttempt = object(attemptFields);
schemas.GatewayPaymentAttempt.description =
  "One durable intent per application. Immutable requested amount, invoice, provider, environment and merchant binding. CREATE_UNKNOWN or expired/unresolved attempts require recovery; this release does not create replacement checkout attempts automatically.";
schemas.GatewayPaymentRegisterEntry = object({
  ...attemptFields,
  serviceNo: integer(1, 47),
  applicantName: text,
});
schemas.GatewayPaymentInput = object({
  provider: { const: "BKASH" },
  requestKey: uuid,
});
schemas.GatewayRequestKey = object({ requestKey: uuid });
schemas.GatewayReceiptSnapshot = object({
  verification: { const: "BKASH_QUERY_AND_SEARCH" },
  environment,
  provider: { const: "BKASH" },
  bankSettlement: { const: "NOT_CONNECTED" },
  officeName: text,
  officeNameBn: text,
  applicantName: text,
  applicantNameBn: text,
  applicationId: uuid,
  serviceNo: integer(1, 47),
  serviceName: text,
  transactionId: text,
  invoice: text,
  amountMinor: paidAmount,
  currency: { const: "BDT" },
  verifiedAt: timestamp,
  components: {
    type: "array",
    minItems: 4,
    maxItems: 4,
    items: ref("OrderFeeComponent"),
  },
});
schemas.GatewayReceipt = object({
  id: uuid,
  receiptNumber: text,
  applicationId: uuid,
  paymentId: uuid,
  amountMinor: paidAmount,
  currency: { const: "BDT" },
  environment,
  transactionId: text,
  issuedAt: timestamp,
  snapshot: ref("GatewayReceiptSnapshot"),
  pdfSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  pdfUrl: { type: "string", pattern: "^/api/v1/receipts/[0-9a-f-]+/pdf$" },
});
schemas.GatewayReceipt.description =
  "Receipt and gateway confirmation commit atomically. PDF bytes and SHA-256 are stored permanently; retries return the original receipt. SANDBOX receipts are marked TEST PAYMENT / NO REAL MONEY COLLECTED. A payment receipt grants no certificate signing authority and is not bank payout evidence.";
schemas.ApplicationPaymentSummary = object({
  applicationId: uuid,
  totalMinor: amount,
  currency: { const: "BDT" },
  paymentStatus: {
    type: "string",
    enum: [
      "NOT_COLLECTED",
      "PENDING",
      "COLLECTED",
      "REVIEW_REQUIRED",
      "NOT_REQUIRED",
      "LEGACY",
    ],
  },
  eligible: {
    type: "boolean",
    description:
      "True when the stored order has a positive fee, application state is APPROVED, and the office gateway is available. POST checkout performs additional current-payload approval checks and idempotency checks.",
  },
  availability: ref("GatewayAvailability"),
  attempt: nullable(ref("GatewayPaymentAttempt")),
  receipt: nullable(ref("GatewayReceipt")),
});
schemas.GatewayReconciliation = object({
  id: uuid,
  result: { type: "string", enum: ["MATCHED", "MISMATCH", "PENDING", "ERROR"] },
  reason: text,
  checkedAt: timestamp,
  bankSettlement: { const: "NOT_CONNECTED" },
});
schemas.GatewayReconciliationResult = object({
  attempt: ref("GatewayPaymentAttempt"),
  reconciliation: ref("GatewayReconciliation"),
  receipt: nullable(ref("GatewayReceipt")),
});
schemas.GatewayReconciliationInProgress = object({
  attempt: ref("GatewayPaymentAttempt"),
  reconciliation: object({
    id: { type: "null" },
    result: { const: "PENDING" },
    reason: { const: "PAYMENT_CHECK_IN_PROGRESS" },
    checkedAt: { type: "null" },
    bankSettlement: { const: "NOT_CONNECTED" },
  }),
  receipt: nullable(ref("GatewayReceipt")),
});
schemas.GatewayDailyReconciliation = object({
  businessDate: { type: "string", format: "date" },
  currency: { const: "BDT" },
  bankSettlement: { const: "NOT_CONNECTED" },
  totalCount: integer(0),
  paidCount: integer(0),
  pendingCount: integer(0),
  reviewCount: integer(0),
  totalMinor: integer(0),
  paidMinor: integer(0),
  results: object({
    matched: integer(0),
    mismatch: integer(0),
    pending: integer(0),
    error: integer(0),
  }),
});
schemas.GatewayDailyReconciliation.description =
  "Read-only totals; no daily cash closure or bank statement matching. Attempt counts/amounts use the selected Dhaka creation date; check counts use the verification date and may include repeated checks or earlier-created attempts. paidCount/paidMinor preserve historical verified payments. reviewCount also includes historically paid attempts with a later decisive mismatch, so review and paid categories can overlap. paidMinor is not bank-net payout.";

doc.paths["/api/v1/payments/configuration"] = {
  get: {
    summary: "Read current office online payment availability",
    description: ownScope,
    security: readSecurity,
    responses: {
      200: response(
        "Credential-free gateway availability; Nagad and bank payouts are not connected.",
        ref("GatewayAvailability"),
      ),
      401: errors[401],
      403: errors[403],
    },
  },
};
doc.paths["/api/v1/applications/{id}/payment"] = {
  get: {
    summary: "Read verified application payment state",
    description: `${ownScope} Read-only. COLLECTED requires an immutable matching provider confirmation and stored receipt; browser callback query flags are never payment proof. A zero-fee order is NOT_REQUIRED, no order snapshot is LEGACY, and any unconfirmed intent is PENDING even if it needs review.`,
    security: readSecurity,
    parameters: [idParameter],
    responses: {
      200: response(
        "Current assessment, attempt, availability and receipt.",
        ref("ApplicationPaymentSummary"),
      ),
      ...errors,
    },
  },
};
const checkoutResponse = object({
  attempt: ref("GatewayPaymentAttempt"),
  replayed: { type: "boolean" },
});
doc.paths["/api/v1/applications/{id}/payments"] = {
  post: {
    summary: "Create or replay an approved application's bKash checkout",
    description:
      "Citizen-own or current-office staff/admin only. Requires APPROVED current payload and a positive saved fee. The server supplies the amount, BDT currency, invoice, payer reference and callback URL; caller prices, status, tenant and redirect overrides are rejected. Same requestKey/actor/application replays; reuse for a different request conflicts. A second request key for the same application returns its existing intent. The durable create claim commits before the provider call; ambiguous outcomes become CREATE_UNKNOWN and never automatically trigger a second provider create. No wallet PIN or OTP is accepted. Unconfigured gateway fails before financial domain rows are inserted. This endpoint does not debit SaaS credits or issue a certificate.",
    security: writeSecurity,
    parameters: [idParameter, originParameter],
    requestBody: { required: true, content: json(ref("GatewayPaymentInput")) },
    responses: {
      200: response(
        "Existing durable attempt returned with replayed:true; no second provider create.",
        checkoutResponse,
      ),
      201: response(
        "New durable intent returned with replayed:false. READY supplies checkoutUrl; CREATE_UNKNOWN records an ambiguous create outcome. HTTP 201 does not establish payment success.",
        checkoutResponse,
      ),
      ...errors,
      409: response(
        "APPROVAL_REQUIRED, PAYMENT_NOT_REQUIRED or IDEMPOTENCY_CONFLICT.",
      ),
      503: response(
        "GATEWAY_NOT_CONFIGURED: current office lacks a valid enabled merchant configuration; no new payment intent is inserted.",
      ),
    },
  },
};
doc.paths["/api/v1/payments"] = {
  get: {
    summary: "List the current office's payment attempts",
    description:
      "Active admin, finance or staff only. Returns a minimal applicant name/service reference, not the full citizen/application payload. Ordered newest creation time then ID. Omitting businessDate includes all dates; filters are ANDed. REVIEW_REQUIRED includes both unconfirmed review attempts and historical PAID attempts held by a later decisive mismatch. PAID includes historical paid attempts even when held, so these filters overlap.",
    security: readSecurity,
    parameters: [
      { name: "status", in: "query", schema: ref("GatewayPaymentStatus") },
      dayParameter(false),
      ...pagination,
    ],
    responses: {
      200: response(
        "Paginated tenant-scoped payment register.",
        object({
          items: { type: "array", items: ref("GatewayPaymentRegisterEntry") },
          page: integer(1, 100000),
          pageSize: integer(1, 100),
          total: integer(0),
        }),
      ),
      ...errors,
    },
  },
};
doc.paths["/api/v1/payments/{id}"] = {
  get: {
    summary: "Read an authorized payment attempt",
    description: ownScope,
    security: readSecurity,
    parameters: [idParameter],
    responses: {
      200: response(
        "Current stored attempt; no provider query is made.",
        ref("GatewayPaymentAttempt"),
      ),
      ...errors,
    },
  },
};
doc.paths["/api/v1/payments/{id}/reconcile"] = {
  post: {
    summary: "Reconcile one payment against bKash query and transaction search",
    description:
      "Citizen-own or current-office staff/admin/finance. Provider query/search only; never execute. A completed query must match payment ID, amount, currency, invoice and sale intent; search additionally matches transaction ID and merchant. Both Completed responses are required for atomic confirmation/receipt. A later decisive MISMATCH holds new issuance as paymentStatus REVIEW_REQUIRED even when historical attempt.status remains PAID; original receipt stays immutable. Only a later MATCHED clears that hold, not ERROR/PENDING. Replayed requestKey returns its saved check; a concurrent in-progress replay returns 202 without another query. After the 60-second reservation window, recovery can query the same intent. At most 20 new checks per payment per five minutes. This is not bank payout settlement, refund or replacement checkout.",
    security: writeSecurity,
    parameters: [idParameter, originParameter],
    requestBody: { required: true, content: json(ref("GatewayRequestKey")) },
    responses: {
      200: response(
        "Durable verification result including MATCHED, MISMATCH, PENDING or ERROR; inspect result rather than treating HTTP 200 as paid.",
        ref("GatewayReconciliationResult"),
      ),
      202: response(
        "The same request key has a verification claim less than 60 seconds old. Retry that same key; no new provider query or receipt is implied.",
        ref("GatewayReconciliationInProgress"),
      ),
      ...errors,
      409: response(
        "IDEMPOTENCY_CONFLICT: this request key belongs to another payment.",
      ),
      429: response(
        "PAYMENT_CHECK_LIMIT: twenty recent new check requests already recorded; wait before a new query.",
      ),
    },
  },
};
doc.paths["/api/v1/payments/reconciliation"] = {
  get: {
    summary: "Read daily payment and gateway-check totals",
    description:
      "Active current-office admin or finance only. Read-only database report; fetching it does not contact bKash or automatically reconcile pending attempts. Bank payout feeds and statement matching are not implemented.",
    security: readSecurity,
    parameters: [dayParameter()],
    responses: {
      200: response(
        "Dhaka-date totals and verification result counts.",
        ref("GatewayDailyReconciliation"),
      ),
      ...errors,
    },
  },
};
doc.paths["/api/v1/payments/reconciliation/export.csv"] = {
  get: {
    summary: "Export daily office payment reconciliation rows",
    description:
      "Active current-office admin or finance only. Selects attempts by created_at in Asia/Dhaka and joins stored confirmation/receipt evidence. UTF-8 BOM and CRLF CSV; quoted cells and formula-leading text escaped. Columns: payment_id, application_id, merchant_invoice, environment, status, payment_status, last_check_result, amount_minor, currency, transaction_id, receipt_number, created_at, bank_settlement. Historical status and current issuance hold are separate. bank_settlement is always NOT_CONNECTED. No provider API call is made.",
    security: readSecurity,
    parameters: [dayParameter()],
    responses: {
      200: {
        description:
          "CSV attachment, including a header row when there are no attempts.",
        headers: {
          ...noStore,
          "Content-Disposition": {
            schema: text,
            description:
              'attachment; filename="gateway-reconciliation-YYYY-MM-DD.csv"',
          },
        },
        content: { "text/csv": { schema: text } },
      },
      ...errors,
    },
  },
};
doc.paths["/api/v1/receipts/{id}"] = {
  get: {
    summary: "Read a stored gateway payment receipt",
    description: `${ownScope} Immutable verified fee breakdown and environment are returned. Sandbox receipts do not represent real money.`,
    security: readSecurity,
    parameters: [idParameter],
    responses: {
      200: response(
        "Persisted receipt metadata, snapshot and PDF hash.",
        ref("GatewayReceipt"),
      ),
      ...errors,
    },
  },
};
doc.paths["/api/v1/receipts/{id}/pdf"] = {
  get: {
    summary: "Download an authorized stored payment receipt PDF",
    description: `${ownScope} Returns original stored PDF bytes, never a regenerated or public document. SANDBOX copies carry a no-real-money label.`,
    security: readSecurity,
    parameters: [idParameter],
    responses: {
      200: {
        description: "Original PDF receipt bytes.",
        headers: {
          ...noStore,
          "Content-Disposition": {
            schema: text,
            description: 'attachment; filename="<stored receipt number>.pdf"',
          },
        },
        content: {
          "application/pdf": { schema: { type: "string", format: "binary" } },
        },
      },
      ...errors,
    },
  },
};
doc.paths["/api/v1/payments/bkash/callback/{token}"] = {
  get: {
    summary: "Receive a provider-authenticated bKash browser callback",
    description:
      "Public provider return route, mounted before session authentication; neither session cookie nor CSRF header is required. Requires the unguessable callback token plus the exact paymentID and create-time provider signature, compared against the persisted intent. Only success can claim execution, and only once from READY; the durable claim commits before execute, which is never retried after an ambiguous result. failure/cancel do not themselves mark paid or reverse a payment. Every accepted callback uses independent query/search verification; status=success alone cannot create a receipt. Redirect target is the fixed PUBLIC_ORIGIN with server-derived application/attempt IDs. The frontend return URL remains navigation, not payment evidence. Do not log or publish callback credentials.",
    security: [],
    parameters: [
      {
        name: "token",
        in: "path",
        required: true,
        schema: {
          type: "string",
          pattern: "^[a-f0-9]{64}$",
          minLength: 64,
          maxLength: 64,
        },
        "x-sensitive": true,
      },
      {
        name: "paymentID",
        in: "query",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 200 },
      },
      {
        name: "status",
        in: "query",
        required: true,
        schema: { type: "string", enum: ["success", "failure", "cancel"] },
      },
      {
        name: "signature",
        in: "query",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 500 },
        "x-sensitive": true,
      },
    ],
    responses: {
      303: {
        description:
          "Navigate to the fixed application payment return page after checking provider state; redirect is not proof of paid status.",
        headers: {
          ...noStore,
          Location: {
            schema: { type: "string", format: "uri" },
            description:
              "PUBLIC_ORIGIN/payments/return?applicationId=<server UUID>&attemptId=<server UUID>",
          },
        },
      },
      403: response(
        "CALLBACK_INVALID: payment ID or provider signature does not match the saved intent.",
      ),
      404: response(
        "NOT_FOUND: callback token does not resolve to a stored intent.",
      ),
      422: response(
        "INPUT_INVALID: invalid token or strict query parameters; additional query fields are rejected.",
      ),
      429: response(
        "Callback or provider-check rate limit exceeded; no extra execution is authorized.",
      ),
    },
  },
};

// The accepted assessment stays immutable; only its read-time financial projection evolves.
schemas.ApplicationOrderSnapshot.properties.paymentStatus = {
  type: "string",
  enum: ["NOT_COLLECTED", "PENDING", "COLLECTED", "REVIEW_REQUIRED"],
  description:
    "Positive-fee financial state is derived from payment evidence when read; zero-fee snapshots retain their original NOT_COLLECTED value. GET /applications/{id}/payment reports zero-fee NOT_REQUIRED. Saved fee/preferences fields are never rewritten.",
};
doc.paths["/api/v1/admin/services/{no}/order-policies"].post.description =
  "Active tenant admin only. Explicit statutory, processing, urgency and delivery fees are integer BDT minor units; no default rate is inferred. expectedVersion is 0 initially, otherwise the current version. Publication serializes with other publishers and new order creation. Existing accepted fee/preferences snapshots and SaaS credits are unchanged. A positive payable total requires independently verified gateway payment and a stored receipt before certificate issuance.";
doc.paths["/api/v1/applications/{id}"].get.description =
  "Authorized own/tenant application with immutable payload history, events and nullable order. POLICY orders return creation-time fee/preferences; later policies never reprice them. Positive order paymentStatus is computed from verified payment evidence without altering the accepted assessment. LEGACY applications return order:null. Full payment availability/attempt/receipt details use GET /applications/{id}/payment.";
doc.paths["/api/v1/applications/{id}/issue"].post.description =
  "Separate active approver with a service grant required. New issuance validates the current approved payload, renewal eligibility, subscription and tenant credits. A positive POLICY fee requires matching immutable confirmation/receipt and no unresolved later decisive mismatch; otherwise ORDER_PAYMENT_REQUIRED blocks new issuance before debit/document creation. A later MATCHED check clears REVIEW_REQUIRED without editing the receipt. Payment does not grant approval. Zero-fee/legacy rules remain separate. Existing certificate retries return stored bytes without repricing or another debit. Certificates remain DEMO / NOT OFFICIAL; sandbox receipts are explicit test evidence.";
doc.info.version = "0.5.0";
doc.info.description =
  "Independently authored contracts for all 47 services, immutable office-specific fee assessments, and bKash v2 online checkout with provider verification, stored receipts and gateway reconciliation. These are not reference-site server contracts. Authenticated mutations require session and CSRF; the signed provider callback is separately public. Citizen fees and SaaS credits are separate. Production checkout defaults to disabled pending approved tenant merchant configuration; Nagad and bank payout reconciliation are not integrated. Official identity/signing remain unconfigured and certificates remain DEMO / NOT OFFICIAL. Source version does not establish hosted deployment or live merchant certification.";
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
console.log(
  "Updated OpenAPI online payment contracts for source version 0.5.0 (11 payment paths).",
);
