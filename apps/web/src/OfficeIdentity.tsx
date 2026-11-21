import { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose } from "./i18n.js";
import { CertificateAssetsSettings } from "./CertificateAssets.js";

/**
 * PROFILE-DYNAMIC (owner requirement, 20 Nov 2026): the chairman's office
 * identity, managed from his own profile page — the office (UP) name plus the
 * certificate images (office logo, office seal, chairman's signature).
 *
 * The name writes through PATCH /office/name (office actors: admin +
 * approver); the images ride the existing CertificateAssetsSettings panel
 * and its /office/certificate-assets endpoints, which already allow the
 * chairman — until now that panel was only mounted inside the admin
 * workspace, so the chairman never saw it. Every value here is resolved
 * live at issuance, so a change prints on the next certificate the office
 * issues; certificates already issued never change.
 */
export function OfficeIdentitySettings() {
  const pick = (text: { bn: string; en: string }) => choose(text);
  const [nameBn, setNameBn] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    api("/office/name")
      .then((data) => {
        setNameBn(data.nameBn ?? "");
        setNameEn(data.nameEn ?? "");
      })
      .catch((e) => setErrorMessage((e as Error).message));
  }, []);

  const save = async () => {
    setBusy(true);
    setMessage("");
    setErrorMessage("");
    try {
      const data = await api("/office/name", "PATCH", {
        nameBn: nameBn.trim(),
        nameEn: nameEn.trim(),
      });
      setNameBn(data.nameBn ?? nameBn);
      setNameEn(data.nameEn ?? nameEn);
      setMessage(
        pick({
          bn: "অফিসের নাম সংরক্ষণ হয়েছে। এখন থেকে ইস্যু করা সনদে নতুন নাম ছাপা হবে।",
          en: "Office name saved. Certificates issued from now on will print the new name.",
        }),
      );
    } catch (e) {
      setErrorMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="panel">
        <h2>{pick({ bn: "অফিসের পরিচিতি", en: "Office identity" })}</h2>
        <p>
          {pick({
            bn: "এই অফিসের নামই প্রতিটি সনদের শীর্ষে ছাপা হয়। নাম বদলালে পরের ইস্যু করা সনদ থেকেই নতুন নাম আসবে; আগের সনদ বদলায় না।",
            en: "This office name is printed at the top of every certificate. Changing it takes effect from the next certificate issued; certificates already issued never change.",
          })}
        </p>
        {message && (
          <p className="notice success" role="status">
            {message}
          </p>
        )}
        {errorMessage && (
          <p className="notice error" role="alert">
            {errorMessage}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="form-grid">
            <label>
              {pick({ bn: "অফিসের নাম (বাংলা)", en: "Office name (Bangla)" })}
              <input
                value={nameBn}
                onChange={(e) => setNameBn(e.target.value)}
                required
                minLength={2}
                maxLength={150}
              />
            </label>
            <label>
              {pick({ bn: "অফিসের নাম (ইংরেজি)", en: "Office name (English)" })}
              <input
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                required
                minLength={2}
                maxLength={150}
              />
            </label>
          </div>
          <button disabled={busy}>
            {pick({ bn: "নাম সংরক্ষণ করুন", en: "Save office name" })}
          </button>
        </form>
      </section>
      <CertificateAssetsSettings />
    </>
  );
}
