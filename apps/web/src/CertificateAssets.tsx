import { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";
import { UploadField, assetActionMeta } from "./ui/kit.js";
import { formatDateTime, localDigits } from "./ui/fmt.js";

type AssetKind = "LOGO" | "SEAL" | "SIGNATURE";
type AssetItem = {
  kind: AssetKind;
  current: {
    version: number;
    mimeType: string;
    byteLength: number;
    contentSha256: string;
    uploadedAt: string;
    // CH-006: the other kind whose current image is byte-identical to
    // this one (logo uploaded as the seal, or vice versa).
    duplicateOf?: string | null;
  } | null;
  history: Array<{
    version: number;
    action: string;
    reason: string | null;
    changedByName: string;
    createdAt: string;
  }>;
};

const KIND_TEXT: Record<AssetKind, { title: { bn: string; en: string }; hint: { bn: string; en: string } }> = {
  LOGO: {
    title: { bn: "অফিসের লোগো", en: "Office logo" },
    hint: {
      bn: "সনদের শীর্ষে অফিসের নামের পাশে ছাপা হয়। স্বচ্ছ ব্যাকগ্রাউন্ডের PNG সবচেয়ে ভালো।",
      en: "Printed in the certificate header beside the office name. A transparent PNG works best.",
    },
  },
  SEAL: {
    title: { bn: "অফিসের সিল", en: "Office seal" },
    hint: {
      bn: "একটিমাত্র সিলের ছবি আপলোড করুন — সনদের মাঝখানের হালকা ওয়াটারমার্কটি সিস্টেম নিজে তৈরি করে নেয়।",
      en: "Upload one seal image — the faint centre-page watermark on certificates is derived automatically.",
    },
  },
  SIGNATURE: {
    title: { bn: "চেয়ারম্যানের স্বাক্ষর", en: "Chairman's signature" },
    hint: {
      bn: "স্বাক্ষরের লাইনের উপরে ছাপা হয়। স্বচ্ছ ব্যাকগ্রাউন্ডের PNG ব্যবহার করুন।",
      en: "Printed above the signature line. Use a transparent PNG of the signature.",
    },
  },
};

const readFile = (file: File) =>
  new Promise<{ mimeType: string; base64: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The selected file could not be read."));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const match = /^data:([^;,]+);base64,(.+)$/.exec(url);
      if (!match) reject(new Error("The selected file could not be read."));
      else resolve({ mimeType: match[1], base64: match[2] });
    };
    reader.readAsDataURL(file);
  });

/**
 * CERTASSETS-01: the office's certificate assets (logo, seal, chairman's
 * signature). Uploaded once here, stored per office, and picked up
 * dynamically by every certificate the office issues afterwards. Replacing
 * an asset requires a reason and keeps the full version history. The
 * chairman's printed name and designation come from the issuing chairman's
 * own account profile, so they are not duplicated here.
 */
export function CertificateAssetsSettings() {
  const pick = (text: { bn: string; en: string }) => choose(text);
  const [language] = useLanguage();
  const [items, setItems] = useState<AssetItem[]>([]);
  const [files, setFiles] = useState<Partial<Record<AssetKind, File>>>({});
  const [reasons, setReasons] = useState<Partial<Record<AssetKind, string>>>({});
  const [previewService, setPreviewService] = useState(12);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  // WS-5 ASSETS-REMOVE: the kind awaiting removal confirmation, the reason
  // typed inside the dialog, and a dialog-local validation error.
  const [removeKind, setRemoveKind] = useState<AssetKind | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [removeError, setRemoveError] = useState("");

  const load = async () => {
    const data = await api("/office/certificate-assets");
    setItems(data.items ?? []);
  };
  useEffect(() => {
    load().catch((e) => setErrorMessage((e as Error).message));
  }, []);

  const upload = async (kind: AssetKind) => {
    const file = files[kind];
    if (!file) {
      setErrorMessage(pick({ bn: "আগে একটি ছবি বেছে নিন।", en: "Choose an image file first." }));
      return;
    }
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setErrorMessage(pick({ bn: "শুধু PNG বা JPEG ছবি দেওয়া যাবে।", en: "Only PNG or JPEG images are accepted." }));
      return;
    }
    setBusy(true);
    setMessage("");
    setErrorMessage("");
    try {
      const { base64 } = await readFile(file);
      await api(`/office/certificate-assets/${kind.toLowerCase()}`, "PUT", {
        mimeType: file.type,
        base64,
        ...(reasons[kind]?.trim() ? { reason: reasons[kind]!.trim() } : {}),
      });
      setFiles((prev) => ({ ...prev, [kind]: undefined }));
      setReasons((prev) => ({ ...prev, [kind]: "" }));
      await load();
      setMessage(
        pick({
          bn: `${KIND_TEXT[kind].title.bn} সংরক্ষণ হয়েছে। এখন থেকে ইস্যু করা সনদে এটি ছাপা হবে।`,
          en: `${KIND_TEXT[kind].title.en} saved. Certificates issued from now on will print it.`,
        }),
      );
    } catch (e) {
      setErrorMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * WS-5 ASSETS-REMOVE: remove the current asset of one kind. The server
   * keeps a tombstone version (nothing is deleted): history keeps the
   * REMOVED entry, already-issued certificates never change, and the kind
   * can be uploaded again afterwards. The reason is mandatory (8–500 chars,
   * same rule as replace) and is asked inside the confirmation dialog.
   */
  const remove = async () => {
    if (!removeKind) return;
    const kind = removeKind;
    const reason = removeReason.trim();
    if (reason.length < 8 || reason.length > 500) {
      setRemoveError(
        pick({
          bn: "সরানোর কারণ লিখুন (কমপক্ষে ৮ অক্ষর)।",
          en: "Write a reason for removing (at least 8 characters).",
        }),
      );
      return;
    }
    setBusy(true);
    setMessage("");
    setErrorMessage("");
    setRemoveError("");
    try {
      await api(`/office/certificate-assets/${kind.toLowerCase()}`, "DELETE", { reason });
      setReasons((prev) => ({ ...prev, [kind]: "" }));
      setRemoveKind(null);
      setRemoveReason("");
      await load();
      setMessage(
        pick({
          bn: `${KIND_TEXT[kind].title.bn} সরানো হয়েছে। এখন থেকে ইস্যু করা সনদে এই অংশটি ছাপা হবে না।`,
          en: `${KIND_TEXT[kind].title.en} removed. Certificates issued from now on will not print it.`,
        }),
      );
    } catch (e) {
      setRemoveError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>{pick({ bn: "সনদে ব্যবহৃত ছবি", en: "Certificate images" })}</h2>
      <p>
        {pick({
          bn: "অফিসের লোগো, সিল এবং চেয়ারম্যানের স্বাক্ষরের ছবি একবার এখানে আপলোড করুন। এরপর এই অফিসের প্রতিটি সনদে এগুলো নিজে থেকে ছাপা হবে। কোনো ছবি আর দরকার না হলে সেটি সরিয়েও ফেলা যায় — সরানোর কারণসহ ইতিহাসে থেকে যায়, আর ইতিমধ্যে ইস্যু করা সনদ কখনো বদলায় না।",
          en: "Upload the office logo, seal and the chairman's signature once here. Every certificate this office issues afterwards prints them automatically. An image that is no longer needed can also be removed — the removal stays in the history with its reason, and certificates already issued never change.",
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
      {items.map((item) => {
        const text = KIND_TEXT[item.kind];
        return (
          <fieldset key={item.kind} className="cert-asset">
            <legend>{pick(text.title)}</legend>
            <p className="hint">{pick(text.hint)}</p>
            {item.current ? (
              <div className="cert-asset-current">
                <img
                  src={`/api/v1/office/certificate-assets/${item.kind.toLowerCase()}/image?v=${item.current.version}`}
                  alt={pick(text.title)}
                  style={{ maxHeight: 90, maxWidth: 220, objectFit: "contain", background: "#fff", border: "1px solid #ccc", padding: 4 }}
                />
                <p className="hint">
                  {pick({ bn: "সংস্করণ", en: "Version" })} {item.current.version} ·{" "}
                  {Math.max(1, Math.round(item.current.byteLength / 1024))} KB ·{" "}
                  {formatDateTime(item.current.uploadedAt, language)}
                </p>
                {item.current.duplicateOf && (
                  <p className="notice" role="alert">
                    {pick({
                      bn: `এই ছবিটি ${KIND_TEXT[item.current.duplicateOf as AssetKind]?.title.bn ?? item.current.duplicateOf} এর ছবির হুবহু একই — সনদে ভুল ছবি ছাপা হবে। আসল ${text.title.bn} আপলোড করুন।`,
                      en: `This image is byte-identical to the ${KIND_TEXT[item.current.duplicateOf as AssetKind]?.title.en ?? item.current.duplicateOf} — certificates will print the wrong image. Upload the real ${text.title.en}.`,
                    })}
                  </p>
                )}
              </div>
            ) : (
              <p className="hint">
                {pick({ bn: "এখনো আপলোড করা হয়নি — সনদে এই অংশটি আগের মতোই থাকবে।", en: "Not uploaded yet — certificates keep the previous behaviour for this part." })}
              </p>
            )}
            <div className="form-grid">
              <div className="field">
                {/* FULL-UIUX-01 (C38): the shared UploadField replaces the
                    last native file input in the workspace. */}
                <UploadField
                  id={`cert-asset-${item.kind}`}
                  label={pick({ bn: "নতুন ছবি (PNG/JPEG, সর্বোচ্চ ২ MB)", en: "New image (PNG/JPEG, max 2 MB)" })}
                  accept="image/png,image/jpeg"
                  fileName={files[item.kind]?.name ?? null}
                  onPick={(f) =>
                    setFiles((prev) => ({ ...prev, [item.kind]: f ?? undefined }))
                  }
                  onClear={() =>
                    setFiles((prev) => ({ ...prev, [item.kind]: undefined }))
                  }
                />
              </div>
              {item.current && (
                <label>
                  {pick({ bn: "বদলানোর কারণ (বাধ্যতামূলক)", en: "Reason for replacing (required)" })}
                  <input
                    value={reasons[item.kind] ?? ""}
                    onChange={(e) =>
                      setReasons((prev) => ({ ...prev, [item.kind]: e.target.value }))
                    }
                    minLength={8}
                    maxLength={500}
                  />
                </label>
              )}
            </div>
            <button disabled={busy} onClick={() => void upload(item.kind)}>
              {item.current
                ? pick({ bn: "বদলে সংরক্ষণ করুন", en: "Replace and save" })
                : pick({ bn: "আপলোড করুন", en: "Upload" })}
            </button>
            {item.current && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                style={{ marginLeft: 10 }}
                onClick={() => {
                  setRemoveKind(item.kind);
                  setRemoveReason("");
                  setRemoveError("");
                }}
              >
                {pick({ bn: "সরান", en: "Remove" })}
              </button>
            )}
            {item.history.length > 0 && (
              <ul className="cert-asset-history">
                {item.history.map((h) => (
                  <li key={h.version}>
                    v{localDigits(h.version, language)} ·{" "}
                    {pick(assetActionMeta(h.action))} · {h.changedByName} ·{" "}
                    {formatDateTime(h.createdAt, language)}
                    {h.reason ? ` — ${h.reason}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        );
      })}
      <fieldset className="cert-asset">
        <legend>{pick({ bn: "সনদের প্রিভিউ", en: "Certificate preview" })}</legend>
        <p className="hint">
          {pick({
            bn: "বর্তমান ছবিগুলো দিয়ে একটি সনদ তৈরি করে দেখুন। এটি শুধু প্রিভিউ — কোনো আসল সনদ ইস্যু হয় না। সনদে ছাপা চেয়ারম্যানের নাম ও পদবি ইস্যুকারী চেয়ারম্যানের নিজের অ্যাকাউন্ট প্রোফাইল থেকে আসে।",
            en: "Render a certificate with the current assets. This is a preview only — no real certificate is issued. The chairman name and designation printed on certificates come from the issuing chairman's own account profile.",
          })}
        </p>
        <div className="form-grid">
          <label>
            {pick({ bn: "সেবা নম্বর", en: "Service number" })}
            <input
              type="number"
              min={1}
              max={47}
              value={previewService}
              onChange={(e) => setPreviewService(Number(e.target.value) || 12)}
            />
          </label>
        </div>
        <a
          className="button"
          href={`/api/v1/office/certificate-assets/preview?serviceNo=${previewService}`}
          target="_blank"
          rel="noreferrer"
        >
          {pick({ bn: "প্রিভিউ দেখুন (PDF)", en: "Open preview (PDF)" })}
        </a>
      </fieldset>
      {/* WS-5 ASSETS-REMOVE: the irreversible-decision confirmation — an
          in-app modal following the WorkspaceApp pattern (QAFIX-09/B1),
          never window.confirm. It names the image it will act on and asks
          for the mandatory removal reason before anything is removed. */}
      {removeKind && (
        <div
          className="ws-confirm-backdrop"
          onClick={() => {
            setRemoveKind(null);
            setRemoveReason("");
            setRemoveError("");
          }}
        >
          <div
            className="ws-confirm"
            role="dialog"
            aria-modal="true"
            aria-label={pick({ bn: "ছবি সরান", en: "Remove image" })}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>
              {pick({
                bn: `${KIND_TEXT[removeKind].title.bn} সরিয়ে ফেলবেন?`,
                en: `Remove the ${KIND_TEXT[removeKind].title.en.toLowerCase()}?`,
              })}
            </h2>
            <p>
              {pick({
                bn: "এখন থেকে ইস্যু করা সনদে এই অংশটি ছাপা হবে না। সরানোর কারণসহ ইতিহাসে থেকে যাবে, আর ইতিমধ্যে ইস্যু করা সনদ বদলাবে না। প্রয়োজনে পরে আবার আপলোড করা যাবে।",
                en: "Certificates issued from now on will not print this part. The removal stays in the history with its reason, already-issued certificates will not change, and the image can be uploaded again later if needed.",
              })}
            </p>
            <label>
              {pick({ bn: "সরানোর কারণ (বাধ্যতামূলক)", en: "Reason for removing (required)" })}
              <input
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
                minLength={8}
                maxLength={500}
              />
            </label>
            {removeError && (
              <p className="notice error" role="alert">
                {removeError}
              </p>
            )}
            <div className="ws-confirm-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setRemoveKind(null);
                  setRemoveReason("");
                  setRemoveError("");
                }}
              >
                {pick({ bn: "বাতিল", en: "Cancel" })}
              </button>
              <button
                type="button"
                className="danger"
                data-testid="confirm-remove-asset"
                disabled={busy}
                onClick={() => void remove()}
              >
                {pick({ bn: "সরান", en: "Remove" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
