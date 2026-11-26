import { getService } from "@astra/shared-schemas";
import { transaction } from "./db.js";
import {
  emailAvailable,
  emailProviderIsLog,
  isPlaceholderEmail,
  sendEmail,
} from "./mailer.js";
import {
  applicationRejectedTemplate,
  certificateIssuedTemplate,
  certificateRevokedTemplate,
  correctionRequiredTemplate,
} from "./email-templates.js";
import { sendStatusSms, smsAvailable, smsProviderIsLog } from "./sms.js";

/**
 * Phase X: email + status-SMS counterparts of the in-app notifications (Phase W).
 * Called AFTER the deciding transaction has committed — a delivery problem can never
 * roll back or fail a chairman's decision — and each helper swallows its own errors
 * after logging them. A channel that is not configured (no EMAIL_PROVIDER / OTP_PROVIDER
 * in production) simply does not send; the in-app feed remains the record of the event.
 * Recipients: the citizen's account email (platform_users) and the mobile on the citizen
 * record (citizens.contact_mobile), when present.
 *
 * W-010: every attempted channel leaves one row in notification_deliveries, so an
 * office can see whether a notification was actually sent — the send result is no
 * longer discarded. The status is honest about the log provider: 'logged' means the
 * message was recorded locally and reached no handset; it is never reported as
 * 'sent'. 'unavailable' means no provider was configured; 'no_contact' means the
 * citizen has no usable address/mobile for that channel; 'failed' means the
 * provider call threw. Recording a delivery never throws.
 */
interface CitizenContact {
  email: string | null;
  mobile: string | null;
  serviceNo: number;
}

async function citizenContact(tenantId: string, applicationId: string): Promise<CitizenContact | null> {
  return transaction(tenantId, async (db) => {
    const row = (
      await db.query(
        `SELECT u.email AS email, c.contact_mobile AS mobile, a.service_no AS service_no
           FROM applications a
           JOIN citizens c ON c.id=a.citizen_id AND c.tenant_id=a.tenant_id
           JOIN platform_users u ON u.id=c.user_id
          WHERE a.id=$1`,
        [applicationId],
      )
    ).rows[0];
    return row ? { email: row.email, mobile: row.mobile, serviceNo: row.service_no } : null;
  });
}

type DeliveryStatus = "sent" | "logged" | "failed" | "unavailable" | "no_contact";

async function recordDelivery(
  tenantId: string,
  applicationId: string,
  kind: string,
  channel: "email" | "sms",
  status: DeliveryStatus,
): Promise<void> {
  try {
    await transaction(tenantId, async (db) => {
      await db.query(
        "INSERT INTO notification_deliveries(tenant_id,application_id,kind,channel,status) VALUES($1,$2,$3,$4,$5)",
        [tenantId, applicationId, kind, channel, status],
      );
    });
  } catch (error) {
    console.error(`[notifications] delivery record failed for application ${applicationId}:`, error);
  }
}

async function deliverEmail(
  tenantId: string,
  applicationId: string,
  kind: string,
  email: string | null,
  message: { subject: string; text: string },
): Promise<void> {
  if (!email || isPlaceholderEmail(email)) {
    await recordDelivery(tenantId, applicationId, kind, "email", "no_contact");
    return;
  }
  if (!emailAvailable()) {
    await recordDelivery(tenantId, applicationId, kind, "email", "unavailable");
    return;
  }
  const sent = await sendEmail({ to: email, ...message });
  await recordDelivery(
    tenantId,
    applicationId,
    kind,
    "email",
    sent ? (emailProviderIsLog() ? "logged" : "sent") : "failed",
  );
}

async function deliverSms(
  tenantId: string,
  applicationId: string,
  kind: string,
  mobile: string | null,
  purpose: "certificate_issued" | "application_rejected" | "correction_required" | "certificate_revoked",
  message: string,
): Promise<void> {
  if (!mobile) {
    await recordDelivery(tenantId, applicationId, kind, "sms", "no_contact");
    return;
  }
  if (!smsAvailable()) {
    await recordDelivery(tenantId, applicationId, kind, "sms", "unavailable");
    return;
  }
  const sent = await sendStatusSms({ mobile, purpose, message });
  await recordDelivery(
    tenantId,
    applicationId,
    kind,
    "sms",
    sent ? (smsProviderIsLog() ? "logged" : "sent") : "failed",
  );
}

const serviceLabel = (serviceNo: number) => {
  const service = getService(serviceNo);
  return service ? `${service.name_bn} / ${service.name_en}` : `Service ${serviceNo}`;
};

export async function notifyCertificateIssued(input: {
  tenantId: string;
  applicationId: string;
  certificateNumber: string;
}): Promise<void> {
  try {
    const contact = await citizenContact(input.tenantId, input.applicationId);
    if (!contact) return;
    const service = serviceLabel(contact.serviceNo);
    await deliverEmail(input.tenantId, input.applicationId, "APPLICATION_ISSUED", contact.email, {
      ...certificateIssuedTemplate({
        certificateNumber: input.certificateNumber,
        service,
      }),
    });
    await deliverSms(
      input.tenantId,
      input.applicationId,
      "APPLICATION_ISSUED",
      contact.mobile,
      "certificate_issued",
      `DigitalUnion: আপনার সনদ ইস্যু হয়েছে। সনদ নম্বর: ${input.certificateNumber} / Your certificate has been issued. Certificate no: ${input.certificateNumber}`,
    );
  } catch (error) {
    console.error(`[notifications] issuance notification failed for application ${input.applicationId}:`, error);
  }
}

/** QA-08: email + status SMS when the chairman asks for a correction. */
export async function notifyCorrectionRequired(input: {
  tenantId: string;
  applicationId: string;
  reason: string;
}): Promise<void> {
  try {
    const contact = await citizenContact(input.tenantId, input.applicationId);
    if (!contact) return;
    const service = serviceLabel(contact.serviceNo);
    await deliverEmail(input.tenantId, input.applicationId, "APPLICATION_CORRECTION_REQUIRED", contact.email, {
      ...correctionRequiredTemplate({ reason: input.reason, service }),
    });
    await deliverSms(
      input.tenantId,
      input.applicationId,
      "APPLICATION_CORRECTION_REQUIRED",
      contact.mobile,
      "correction_required",
      `DigitalUnion: আপনার আবেদনে সংশোধন প্রয়োজন। কারণ: ${input.reason} / Correction requested: ${input.reason}`,
    );
  } catch (error) {
    console.error(`[notifications] correction notification failed for application ${input.applicationId}:`, error);
  }
}

/** QA-08: email + status SMS when a certificate is revoked. */
export async function notifyCertificateRevoked(input: {
  tenantId: string;
  applicationId: string;
  certificateNumber: string;
  reason: string;
}): Promise<void> {
  try {
    const contact = await citizenContact(input.tenantId, input.applicationId);
    if (!contact) return;
    const service = serviceLabel(contact.serviceNo);
    await deliverEmail(input.tenantId, input.applicationId, "CERTIFICATE_REVOKED", contact.email, {
      ...certificateRevokedTemplate({
        reason: input.reason,
        service,
        certificateNumber: input.certificateNumber,
      }),
    });
    await deliverSms(
      input.tenantId,
      input.applicationId,
      "CERTIFICATE_REVOKED",
      contact.mobile,
      "certificate_revoked",
      `DigitalUnion: আপনার সনদ (${input.certificateNumber}) প্রত্যাহার করা হয়েছে। কারণ: ${input.reason} / Certificate ${input.certificateNumber} revoked. Reason: ${input.reason}`,
    );
  } catch (error) {
    console.error(`[notifications] revocation notification failed for application ${input.applicationId}:`, error);
  }
}

export async function notifyApplicationRejected(input: {
  tenantId: string;
  applicationId: string;
  reason: string;
}): Promise<void> {
  try {
    const contact = await citizenContact(input.tenantId, input.applicationId);
    if (!contact) return;
    const service = serviceLabel(contact.serviceNo);
    await deliverEmail(input.tenantId, input.applicationId, "APPLICATION_REJECTED", contact.email, {
      ...applicationRejectedTemplate({ reason: input.reason, service }),
    });
    await deliverSms(
      input.tenantId,
      input.applicationId,
      "APPLICATION_REJECTED",
      contact.mobile,
      "application_rejected",
      `DigitalUnion: আপনার আবেদন বাতিল হয়েছে। কারণ: ${input.reason} / Your application was rejected. Reason: ${input.reason}`,
    );
  } catch (error) {
    console.error(`[notifications] rejection notification failed for application ${input.applicationId}:`, error);
  }
}
