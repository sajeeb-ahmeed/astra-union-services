import fs from "node:fs";

// Idempotent documentation patch. Does not connect to an API or database.
const file = "apps/api/openapi.json";
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const text = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const service = integer(1, 47);
const version = integer(1, 2147483647);
const fee = integer(0, 100000000);
const delivery = {
  type: "string",
  enum: ["office_collection", "digital_copy"],
};
const urgency = { type: "string", enum: ["normal", "urgent"] };
const choices = (items) => ({
  type: "array",
  minItems: 1,
  maxItems: 2,
  uniqueItems: true,
  items,
});
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const json = (schema) => ({ "application/json": { schema } });
const response = (description, schema = ref("Error")) => ({
  description,
  content: json(schema),
});
const schemas = doc.components.schemas;
const policyFields = {
  statutoryFeeMinor: fee,
  processingFeeMinor: fee,
  emergencySurchargeMinor: fee,
  deliveryFeesMinor: object({ office_collection: fee, digital_copy: fee }),
  deliveryModes: choices(delivery),
  urgencies: choices(urgency),
};
schemas.OrderPreferences = object({
  addressBasis: { const: "registered_profile" },
  certificateLanguage: { type: "string", enum: ["bn", "en"] },
  deliveryMode: delivery,
  urgency,
});
schemas.ApplicationOrderInput = object({
  policyVersion: version,
  preferences: ref("OrderPreferences"),
});
schemas.OrderPolicyInput = object({
  expectedVersion: integer(0, 2147483646),
  reason: {
    type: "string",
    minLength: 3,
    maxLength: 500,
    description: "Trimmed publication reason; whitespace alone is invalid.",
  },
  ...policyFields,
});
schemas.OrderPolicy = object({
  version,
  ...policyFields,
  currency: { const: "BDT" },
});
schemas.OrderOptions = {
  oneOf: [
    object({ configured: { const: false }, policy: { type: "null" } }),
    object({ configured: { const: true }, policy: ref("OrderPolicy") }),
  ],
};
schemas.OrderQuoteInput = object({ preferences: ref("OrderPreferences") });
schemas.OrderFeeComponent = object({
  code: {
    type: "string",
    enum: [
      "statutory_fee",
      "processing_fee",
      "emergency_surcharge",
      "delivery_fee",
    ],
  },
  amountMinor: fee,
});
const quoteFields = {
  policyVersion: version,
  preferences: ref("OrderPreferences"),
  currency: { const: "BDT" },
  components: {
    type: "array",
    minItems: 4,
    maxItems: 4,
    items: ref("OrderFeeComponent"),
    description:
      "Exactly one each, in order: statutory_fee, processing_fee, emergency_surcharge, delivery_fee.",
  },
  totalMinor: {
    ...integer(0, 400000000),
    description:
      "Server-calculated sum in BDT minor units (100 = BDT 1.00). Not a payment or a tenant credit amount.",
  },
  paymentStatus: { const: "NOT_COLLECTED" },
};
schemas.OrderQuote = object(quoteFields);
schemas.ApplicationOrderSnapshot = object({
  applicationId: uuid,
  serviceNo: service,
  ...quoteFields,
  createdAt: { type: "string", format: "date-time" },
});
schemas.ApplicationLookup = object({
  application: object({ id: uuid, serviceNo: service, state: text }),
  certificate: nullable(
    object({
      id: uuid,
      number: text,
      status: { type: "string", enum: ["ISSUED", "REVOKED"] },
    }),
  ),
});
schemas.ApplicationInput.properties.order = ref("ApplicationOrderInput");
schemas.ApplicationInput.description =
  "Citizen-owned or authorized tenant staff/admin draft. Order is required when this office/service has a fee policy; absent policies retain the explicit legacy demo workflow. Client prices, paid flags and tenant overrides are rejected.";

const errors = {
  401: response("Session missing, expired or inactive."),
  403: response("Role, tenant, CSRF or Origin denied."),
  422: response(
    "Strict input validation failed (INPUT_INVALID); quote also rejects disabled service or unavailable options.",
  ),
};
const serviceParam = {
  name: "no",
  in: "path",
  required: true,
  schema: service,
};
const mutationSecurity = [{ session: [], csrf: [] }];
doc.paths["/api/v1/services/{no}/order-options"] = {
  get: {
    summary: "Read the current office/service fee policy",
    description:
      "Citizen, staff, admin, reviewer, approver or finance in the active tenant. An unconfigured policy returns configured:false and policy:null, not an approved zero fee. This endpoint does not imply service enablement or collect money.",
    security: [{ session: [] }],
    parameters: [serviceParam],
    responses: {
      200: response(
        "Current tenant policy or unconfigured state.",
        ref("OrderOptions"),
      ),
      ...errors,
    },
  },
};
doc.paths["/api/v1/services/{no}/order-quote"] = {
  post: {
    summary: "Calculate a citizen fee assessment without saving or charging",
    description:
      "Citizen, staff or admin. Reads the enabled service's current policy. Fees are computed from server-held amounts; urgency and delivery must be permitted. No quote ID, expiry, persisted reservation, payment success or ledger entry is created. Creation/renewal rechecks policyVersion and recalculates the quote atomically.",
    security: mutationSecurity,
    parameters: [serviceParam],
    requestBody: { required: true, content: json(ref("OrderQuoteInput")) },
    responses: {
      200: response(
        "Read-only assessment; paymentStatus is always NOT_COLLECTED.",
        ref("OrderQuote"),
      ),
      ...errors,
      409: response(
        "ORDER_POLICY_NOT_CONFIGURED: this office/service has no policy.",
      ),
    },
  },
};
doc.paths["/api/v1/admin/services/{no}/order-policies"] = {
  post: {
    summary: "Publish an immutable office/service fee policy version",
    description:
      "Active tenant admin only. Explicit statutory, processing, urgency and delivery fees are integer BDT minor units; no default rate is inferred. expectedVersion is 0 initially, otherwise the current version. Publication serializes with other publishers and new order creation. Existing accepted snapshots and SaaS credits are unchanged. Publishing any positive payable total blocks that order's certificate issuance until verified collection is implemented.",
    security: mutationSecurity,
    parameters: [serviceParam],
    requestBody: { required: true, content: json(ref("OrderPolicyInput")) },
    responses: {
      201: response(
        "New immutable version and audit event stored.",
        object({ configured: { const: true }, policy: ref("OrderPolicy") }),
      ),
      ...errors,
      404: response("Service configuration not found in this tenant."),
      409: response(
        "ORDER_POLICY_STALE: reload and review the current policy before publishing.",
      ),
    },
  },
};
doc.paths["/api/v1/applications/lookup"] = {
  get: {
    summary: "Resolve an exact Astra application ID or certificate number",
    description:
      "Citizen sees only their own records; permitted staff see their active tenant. Matches a full application UUID or certificate number case-insensitively. No prefix search, private payload or cross-site reference lookup. A revoked certificate may be resolved but remains ineligible for renewal under the existing renewal checks.",
    security: [{ session: [] }],
    parameters: [
      {
        name: "reference",
        in: "query",
        required: true,
        schema: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[^\\u0000-\\u001f\\u007f]+$",
        },
        description: "Trimmed exact reference; no control characters.",
      },
    ],
    responses: {
      200: response(
        "Minimal matching application/certificate references.",
        ref("ApplicationLookup"),
      ),
      400: response("INPUT_INVALID: missing or invalid reference."),
      401: errors[401],
      403: errors[403],
      404: response("NOT_FOUND: unavailable in the caller's authorized scope."),
    },
  },
};

const create = doc.paths["/api/v1/applications"].post;
create.description =
  "Valid complete service payload required even for draft creation. Server serializes policy acceptance, validates payload/order language equality, recalculates fees and persists the draft, payload and immutable order atomically. No generic create-retry deduplication is provided. No policy means LEGACY origin, not paid status.";
delete create.responses[200];
create.responses[201] = {
  description:
    "Persistent draft application (camelCase fields including orderMode: LEGACY or POLICY).",
};
create.responses[409] = response(
  "ORDER_REQUIRED, ORDER_POLICY_STALE or ORDER_POLICY_NOT_CONFIGURED; no partial draft is saved.",
);
create.responses[422] = response(
  "Invalid service payload/preferences or ORDER_LANGUAGE_MISMATCH.",
);
const renew = doc.paths["/api/v1/applications/{id}/renew"].post;
renew.description =
  "Citizen own/staff/admin tenant only. Creates a linked draft for the same service/citizen, with one active successor per source. Source must be issued and unrevoked; trade prior number is server-pinned. Requires a fresh current-policy order when configured, including when the source is legacy. Optional payload is validated against the current schema; otherwise source facts are reused. Current policy fees are recalculated, not copied from the source. Normal separate review/approval and exactly-once SaaS issuance credit apply.";
renew.requestBody = {
  required: false,
  content: json(
    object(
      { payload: { type: "object" }, order: ref("ApplicationOrderInput") },
      [],
    ),
  ),
};
renew.responses[409] = response(
  "Renewal lineage/state conflict, ORDER_REQUIRED, ORDER_POLICY_STALE or ORDER_POLICY_NOT_CONFIGURED.",
);
renew.responses[422] = response(
  "Invalid current-schema payload/preferences or ORDER_LANGUAGE_MISMATCH.",
);
const detail = doc.paths["/api/v1/applications/{id}"].get;
detail.description =
  "Authorized own/tenant application with immutable payload history, events and nullable order. POLICY orders return the creation-time fee/preferences snapshot; later policy changes never reprice it. LEGACY applications return order:null. No payment is asserted.";
detail.responses[200] = response(
  "Application detail; order is the immutable accepted assessment or null.",
  {
    type: "object",
    required: [
      "application",
      "order",
      "serviceConfiguration",
      "payload",
      "versions",
      "events",
      "citizen",
      "certificate",
      "renewal",
    ],
    properties: {
      application: {
        type: "object",
        properties: {
          orderMode: { type: "string", enum: ["LEGACY", "POLICY"] },
        },
      },
      order: nullable(ref("ApplicationOrderSnapshot")),
      serviceConfiguration: { type: "object" },
      payload: { type: "object" },
      versions: { type: "array", items: { type: "object" } },
      events: { type: "array", items: { type: "object" } },
      citizen: nullable({ type: "object" }),
      certificate: nullable(ref("Certificate")),
      renewal: nullable({ type: "object" }),
    },
  },
);
doc.paths["/api/v1/applications/{id}"].patch.description =
  "Append a payload version only in DRAFT or CORRECTION_REQUIRED. A policy-backed application's order is immutable; changing payload.delivery_language to disagree with its order returns 422 ORDER_LANGUAGE_MISMATCH. No price/preference/payment edits are accepted.";
const issue = doc.paths["/api/v1/applications/{id}/issue"].post;
issue.description =
  "Separate active approver with the service grant required. New issuance validates current approved payload, renewal eligibility, subscription and tenant credits. A POLICY order with totalMinor > 0 is blocked with ORDER_PAYMENT_REQUIRED: verified citizen payment collection is not implemented. Explicit zero-fee or historical legacy applications retain existing approval/credit rules. Existing certificate retries return the stored document without repricing or another debit.";
issue.responses[402] = response(
  "ORDER_PAYMENT_REQUIRED for an unpaid positive citizen-fee order, SUBSCRIPTION_INACTIVE or INSUFFICIENT_CREDITS. Application retained; no new certificate, issuance ledger entry or credit debit.",
);
issue.responses[201].description =
  "New templateVersion4 DEMO certificate or safe concurrent return.";
schemas.Certificate.properties.serviceNo = service;
schemas.Certificate.properties.templateVersion.description =
  "New issues use version 4; previously stored PDF/template versions remain unchanged on retry.";
doc.info.version = "0.4.0";
doc.info.description =
  "Independently authored DEMO contracts for all 47 services, including office-specific fee policies and immutable application assessments. These are not reference-site server contracts. Session and CSRF protect authenticated mutations. Citizen fees, processing charges and tenant SaaS credits remain separate. Real identity, official issuance and commercial payment providers are unconfigured. Source version is not evidence of hosted deployment or passing tests.";
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
console.log(
  "Updated OpenAPI order workflow contracts for source version 0.4.0.",
);
