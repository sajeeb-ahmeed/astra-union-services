import { app } from "./app.js";
import { pool } from "./db.js";
import { closePdfBrowser } from "./pdf.js";
import { enforceRuntimeConfig, configureProxyTrust } from "./http-hardening.js";
import { mountWeb } from "./web-assets.js";
import { emailProviderIsLog } from "./mailer.js";
import { otpProviderIsLog } from "./otp.js";
import { smsProviderIsLog } from "./sms.js";
enforceRuntimeConfig();
// Security Audit 01, F1: a log provider in production delivers nothing — codes and
// messages are recorded (hint-only) in the server log instead of reaching a handset
// or inbox. That state is a deliberate interim for a deployment without a provider,
// never a silent one: name it loudly at every boot.
if (process.env.NODE_ENV === "production") {
  const logChannels = [
    ...(emailProviderIsLog() ? ["email (EMAIL_PROVIDER=log)"] : []),
    ...(otpProviderIsLog() ? ["mobile OTP (OTP_PROVIDER=log)"] : []),
    ...(smsProviderIsLog() ? ["status SMS (OTP_PROVIDER=log)"] : []),
  ];
  if (logChannels.length)
    console.warn(
      `[security] WARNING: log provider active in production for ${logChannels.join(", ")}. ` +
        "Nothing is delivered to citizens on these channels; configure a real provider (EMAIL_PROVIDER=smtp / a real SMS provider) as soon as possible.",
    );
}
configureProxyTrust(app);
if (process.env.NODE_ENV === "production" || process.env.SERVE_WEB === "true")
  mountWeb(app);
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(
    process.env.ISSUANCE_MODE === "official"
      ? `DigitalUnion server on http://${host}:${port}; PostgreSQL; official issuance enabled.`
      : `DigitalUnion server on http://${host}:${port}; PostgreSQL; official issuance disabled.`,
  ),
);
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    const timeout = setTimeout(() => process.exit(1), 15_000);
    timeout.unref();
    server.close(async () => {
      await closePdfBrowser();
      await pool.end();
      process.exit(0);
    });
  });
