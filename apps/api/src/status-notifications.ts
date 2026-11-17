import { getService } from "@astra/shared-schemas";
import { transaction } from "./db.js";
import { sendEmail } from "./mailer.js";
import { sendStatusSms } from "./sms.js";

/**
 * Phase X: email + status-SMS counterparts of the in-app notifications (Phase W).
 * Called AFTER the deciding transaction has committed — a delivery problem can never
 * roll back or fail a chairman's decision — and each helper swallows its own errors
 * after logging them. A channel that is not configured (no EMAIL_PROVIDER / OTP_PROVIDER
 * in production) simply does not send; the in-app feed remains the record of the event.
 * Recipients: the citizen's account email (platform_users) and the mobile on the citizen
 * record (citizens.contact_mobile), when present.
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
    if (contact.email) {
      await sendEmail({
        to: contact.email,
        subject: `সনদ ইস্যু হয়েছে / Certificate issued — ${input.certificateNumber}`,
        text: [
          "আপনার আবেদনের সনদ ইস্যু হয়েছে।",
          "Your certificate has been issued.",
          "",
          `সেবা / Service: ${service}`,
          `সনদ নম্বর / Certificate number: ${input.certificateNumber}`,
          "",
          "সাইন ইন করে সনদটি ডাউনলোড করুন। / Sign in to download your certificate.",
        ].join("\n"),
      });
    }
    if (contact.mobile) {
      await sendStatusSms({
        mobile: contact.mobile,
        purpose: "certificate_issued",
        message: `Astra Union Services: আপনার সনদ ইস্যু হয়েছে। সনদ নম্বর: ${input.certificateNumber} / Your certificate has been issued. Certificate no: ${input.certificateNumber}`,
      });
    }
  } catch (error) {
    console.error(`[notifications] issuance notification failed for application ${input.applicationId}:`, error);
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
    if (contact.email) {
      await sendEmail({
        to: contact.email,
        subject: "আবেদন বাতিল হয়েছে / Application rejected — Astra Union Services",
        text: [
          "আপনার আবেদনটি বাতিল করা হয়েছে।",
          "Your application has been rejected.",
          "",
          `সেবা / Service: ${service}`,
          `কারণ / Reason: ${input.reason}`,
          "",
          "বিস্তারিত জানতে সাইন ইন করুন অথবা আপনার অফিসে যোগাযোগ করুন। / Sign in or contact your office for details.",
        ].join("\n"),
      });
    }
    if (contact.mobile) {
      await sendStatusSms({
        mobile: contact.mobile,
        purpose: "application_rejected",
        message: `Astra Union Services: আপনার আবেদন বাতিল হয়েছে। কারণ: ${input.reason} / Your application was rejected. Reason: ${input.reason}`,
      });
    }
  } catch (error) {
    console.error(`[notifications] rejection notification failed for application ${input.applicationId}:`, error);
  }
}
