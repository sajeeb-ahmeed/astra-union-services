import { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

/**
 * W-010: owner-visible notification provider health. Fetches the read-only
 * GET /owner/notification-health once: per channel (email, SMS, mobile
 * OTP) the configured provider, and whether it is the log provider — a
 * log provider records messages locally and sends nothing, so it is
 * shown as "Log only", never as live. Until the fetch resolves — or if
 * it fails — the card shows a loading dash, never a confident "ready".
 * No secrets, hosts, or message contents are ever rendered.
 */
type Channel = { provider: string | null; available: boolean; logOnly: boolean };
type Health = {
  email: Channel;
  sms: Channel;
  otp: Channel;
  readyForLive: boolean;
  warnings: string[];
};

function channelState(channel: Channel): string {
  if (!channel.available)
    return choose({ bn: "কনফিগার করা হয়নি", en: "Not configured" });
  if (channel.logOnly)
    return choose({ bn: "শুধু লগ — কিছু পাঠায় না", en: "Log only — sends nothing" });
  return choose({ bn: "চালু", en: "Live" });
}

export function NotificationHealthCard() {
  // Subscribe to language changes so choose() re-renders on switch.
  useLanguage();
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api("/owner/notification-health")
      .then((r: any) => {
        if (live) setHealth(r);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="panel notification-health" aria-labelledby="notification-health-title">
      <h3 id="notification-health-title">
        {choose({ bn: "বিজ্ঞপ্তি প্রোভাইডার", en: "Notification providers" })}
      </h3>
      {health === null ? (
        <p>{failed ? choose({ bn: "প্রোভাইডারের অবস্থা লোড করা যায়নি।", en: "Provider status could not be loaded." }) : "—"}</p>
      ) : (
        <>
          <p>
            {health.readyForLive
              ? choose({ bn: "লাইভ বিজ্ঞপ্তির জন্য প্রস্তুত।", en: "Ready for live notifications." })
              : choose({ bn: "লাইভ বিজ্ঞপ্তির জন্য প্রস্তুত নয়।", en: "Not ready for live notifications." })}
          </p>
          <ul>
            <li>
              {choose({ bn: "ইমেইল", en: "Email" })}: {health.email.provider ?? "—"} —{" "}
              {channelState(health.email)}
            </li>
            <li>
              {choose({ bn: "এসএমএস", en: "SMS" })}: {health.sms.provider ?? "—"} —{" "}
              {channelState(health.sms)}
            </li>
            <li>
              {choose({ bn: "মোবাইল ওটিপি", en: "Mobile OTP" })}: {health.otp.provider ?? "—"} —{" "}
              {channelState(health.otp)}
            </li>
          </ul>
          {health.warnings.length > 0 && (
            <ul>
              {health.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
