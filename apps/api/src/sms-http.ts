/**
 * Phase 7: the real SMS transport behind OTP_PROVIDER=http, shared by the OTP module
 * (otp.ts) and the status-SMS module (sms.ts) so both channels leave through one
 * configured gateway. The request shape is the one Bangladeshi SMS gateways
 * (BulkSMSBD, GreenWeb, SSL Wireless-style resellers) commonly accept: an API key, a
 * sender id, the recipient number and the message, sent as form fields — or as a JSON
 * body when SMS_HTTP_FORMAT=json for gateways that take JSON. Configuration is env
 * only (SMS_HTTP_URL, SMS_HTTP_API_KEY, optional SMS_HTTP_SENDER_ID); with either
 * required value missing the provider reports itself unconfigured and callers fall
 * back to "unavailable", never to pretending a message was sent. A send counts as
 * delivered only on an HTTP 2xx answer; anything else throws, and the callers'
 * never-throw wrappers record the failure.
 */
export function smsHttpConfigured(): boolean {
  return Boolean(process.env.SMS_HTTP_URL && process.env.SMS_HTTP_API_KEY);
}

export async function sendSmsViaHttp(
  mobile: string,
  message: string,
): Promise<void> {
  const url = process.env.SMS_HTTP_URL;
  const apiKey = process.env.SMS_HTTP_API_KEY;
  if (!url || !apiKey)
    throw Object.assign(new Error("SMS HTTP provider is not configured."), {
      code: "SMS_PROVIDER_NOT_CONFIGURED",
    });
  const senderId = process.env.SMS_HTTP_SENDER_ID;
  const fields: Record<string, string> = {
    api_key: apiKey,
    number: mobile,
    message,
    ...(senderId ? { senderid: senderId } : {}),
  };
  const asJson = process.env.SMS_HTTP_FORMAT === "json";
  const response = await fetch(url, {
    method: "POST",
    headers: asJson
      ? { "Content-Type": "application/json", Accept: "application/json" }
      : { "Content-Type": "application/x-www-form-urlencoded" },
    body: asJson
      ? JSON.stringify(fields)
      : new URLSearchParams(fields).toString(),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok)
    throw Object.assign(
      new Error(`SMS gateway answered HTTP ${response.status}.`),
      { code: "SMS_GATEWAY_UNAVAILABLE" },
    );
}
