import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

const kinds = [
  { kind: "mobile", bn: "মোবাইল নম্বর", en: "Mobile number", example: "01XXXXXXXXX" },
  { kind: "nid", bn: "জাতীয় পরিচয়পত্র (NID) নম্বর", en: "National ID (NID) number", example: "10, 13 or 17 digits" },
  { kind: "birth_reg", bn: "জন্ম নিবন্ধন নম্বর", en: "Birth registration number", example: "17 digits" },
] as const;

/** Phase 2b: extra ways to sign in. Numbers are stored only as a keyed digest; the page shows a masked hint. */
export function SignInIdentifiers() {
  useLanguage();
  const [state, setState] = useState<any>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    api("/account/identifiers")
      .then(setState)
      .catch((error) => setMessage((error as Error).message));
  useEffect(() => {
    void load();
  }, []);
  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setEditing(null);
      setValue("");
      setCurrentPassword("");
      await load();
      setMessage(done);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel narrow" aria-labelledby="sign-in-identifiers-title">
      <h2 id="sign-in-identifiers-title">
        {choose({ bn: "লগইনের উপায়", en: "Sign-in identifiers" })}
      </h2>
      <p>
        {choose({
          bn: "ইমেইলের পাশাপাশি মোবাইল, NID বা জন্ম নিবন্ধন নম্বর দিয়েও লগইন করা যাবে। নম্বরগুলো সাংকেতিক রূপে রাখা হয়; এখানে শুধু শেষ অংশ দেখানো হয়।",
          en: "Besides your email you can sign in with your mobile, NID or birth registration number. Numbers are kept only in coded form; this page shows just their last digits.",
        })}
      </p>
      {state && !state.available && (
        <p className="notice" role="status">
          {choose({
            bn: "এই সার্ভারে এখনো চালু নেই। ইমেইল দিয়ে লগইন করুন।",
            en: "Not enabled on this server yet. Sign in with your email.",
          })}
        </p>
      )}
      {state && (
        <dl className="identifier-list">
          <dt>{choose({ bn: "ইমেইল", en: "Email" })}</dt>
          <dd>{state.email}</dd>
          {kinds.map((k) => {
            const item = state.items.find((i: any) => i.kind === k.kind);
            return (
              <React.Fragment key={k.kind}>
                <dt>{choose(k)}</dt>
                <dd>
                  <span>{item?.set ? item.hint : choose({ bn: "যোগ করা হয়নি", en: "Not added" })}</span>{" "}
                  {state.available && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setEditing(k.kind);
                        setValue("");
                        setCurrentPassword("");
                        setMessage("");
                      }}
                    >
                      {item?.set ? choose({ bn: "বদলান", en: "Change" }) : choose({ bn: "যোগ করুন", en: "Add" })}
                    </button>
                  )}
                  {item?.set && editing !== k.kind && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setEditing(`remove:${k.kind}`);
                        setCurrentPassword("");
                        setMessage("");
                      }}
                    >
                      {choose({ bn: "সরান", en: "Remove" })}
                    </button>
                  )}
                </dd>
              </React.Fragment>
            );
          })}
        </dl>
      )}
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const removing = editing.startsWith("remove:");
            const kind = removing ? editing.slice(7) : editing;
            void act(
              () =>
                removing
                  ? api(`/account/identifiers/${kind}`, "DELETE", { currentPassword })
                  : api(`/account/identifiers/${kind}`, "PUT", { value, currentPassword }),
              removing
                ? choose({ bn: "সরানো হয়েছে।", en: "Removed." })
                : choose({ bn: "সংরক্ষিত হয়েছে। এখন এটি দিয়েও লগইন করা যাবে।", en: "Saved. You can now sign in with it." }),
            );
          }}
        >
          {!editing.startsWith("remove:") && (
            <label htmlFor="identifier-value">
              {choose(kinds.find((k) => k.kind === editing)!)}
              <input
                id="identifier-value"
                inputMode="numeric"
                autoComplete="off"
                placeholder={kinds.find((k) => k.kind === editing)!.example}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
            </label>
          )}
          <label htmlFor="identifier-current-password">
            {choose({ bn: "বর্তমান পাসওয়ার্ড", en: "Current password" })}
            <input
              id="identifier-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <div className="actions">
            <button disabled={busy}>
              {editing.startsWith("remove:")
                ? choose({ bn: "সরিয়ে ফেলুন", en: "Remove identifier" })
                : choose({ bn: "সংরক্ষণ করুন", en: "Save identifier" })}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              {choose({ bn: "বাতিল", en: "Cancel" })}
            </button>
          </div>
        </form>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
