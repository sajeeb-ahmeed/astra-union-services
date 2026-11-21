import React, { useState } from "react";
import { api } from "./api.js";
import { t, tx } from "./i18n.js";

/** Service-update preference form (moved here from the legacy public footer; same labels and API). */
export function SubscriptionForm() {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <div className="ax-subscribe">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            data = new FormData(form);
          setWorking(true);
          setMessage("");
          try {
            await api("/public/subscribe", "POST", { email: data.get("email") });
            form.reset();
            setMessage(
              "Subscription preference saved locally. Email delivery is not connected.",
            );
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setWorking(false);
          }
        }}
      >
        <label htmlFor="ax-subscribe-email">
          {t("সেবার আপডেটের জন্য নিবন্ধন / Update preferences ")}
        </label>
        <div className="ax-subscribe-row">
          <input
            id="ax-subscribe-email"
            name="email"
            type="email"
            placeholder={t("ইমেইল ঠিকানা / Email address")}
            required
          />
          <button disabled={working}>{t("Save subscription")}</button>
        </div>
        <small>{t("Preference saved locally; outgoing email is not connected. ")}</small>
      </form>
      {message && <p role="status">{tx(message)}</p>}
    </div>
  );
}
