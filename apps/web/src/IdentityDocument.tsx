import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { t, useLanguage } from "./i18n.js";
import { AttachmentStatus, type AttachmentHandle } from "./AttachmentStatus.js";

const accepted = ["image/jpeg", "image/png", "application/pdf"];
const kindLabel: Record<string, string> = {
  nid: "জাতীয় পরিচয়পত্র / NID",
  birth_reg: "জন্ম নিবন্ধন / Birth registration",
};

/**
 * Phase 3c: the optional NID or birth-registration image on the citizen record. Uploads use the private
 * attachment pipeline, so the image stays quarantined and cannot be opened until its malware scan is clean.
 */
export function IdentityDocument({
  citizen,
  canEdit,
  onChanged,
}: {
  citizen: any;
  canEdit: boolean;
  onChanged: (citizen: any) => void;
}) {
  useLanguage();
  const linked = citizen.identityDocument as { attachmentId: string; kind: string } | null;
  const [handle, setHandle] = useState<AttachmentHandle | null>(null);
  const [kind, setKind] = useState(linked?.kind ?? "nid");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setHandle(null);
    if (!linked) return;
    let active = true;
    api(`/attachments/${linked.attachmentId}/status`)
      .then((s) => active && setHandle({ attachmentId: s.attachmentId, mimeType: s.mimeType, byteLength: s.byteLength }))
      .catch((e) => active && setError((e as Error).message));
    return () => {
      active = false;
    };
  }, [linked?.attachmentId]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="citizen-details identity-document">
      <legend>{t("পরিচয়পত্রের ছবি / ID document image")}</legend>
      {linked ? (
        <>
          <p>
            <strong>{t(kindLabel[linked.kind] ?? linked.kind)}</strong>
          </p>
          {handle && <AttachmentStatus attachment={handle} />}
        </>
      ) : (
        <p className="hint">{t("No ID document image on file. Adding one is optional.")}</p>
      )}
      {canEdit && (
        <div className="form-grid">
          <div className="field">
            <label htmlFor={`identity-kind-${citizen.id.slice(0, 8)}`}>{t("নথির ধরন / Document type")}</label>
            <select
              id={`identity-kind-${citizen.id.slice(0, 8)}`}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="nid">{t(kindLabel.nid)}</option>
              <option value="birth_reg">{t(kindLabel.birth_reg)}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`identity-file-${citizen.id.slice(0, 8)}`}>
              {t(linked ? "ছবি বদলান / Replace image" : "ছবি যোগ করুন / Add image")}
            </label>
            <input
              id={`identity-file-${citizen.id.slice(0, 8)}`}
              type="file"
              accept={accepted.join(",")}
              disabled={busy}
              aria-describedby={`identity-file-hint-${citizen.id.slice(0, 8)}`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run(async () => {
                  if (!accepted.includes(file.type)) throw Error("Select a PDF, PNG or JPEG document.");
                  if (file.size > 2 * 1024 * 1024) throw Error("Uploads must be between 8 bytes and 2 MiB.");
                  const bytes = new Uint8Array(await file.arrayBuffer());
                  let binary = "";
                  for (let offset = 0; offset < bytes.length; offset += 16_384)
                    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
                  const uploaded = await api("/attachments", "POST", {
                    citizenId: citizen.id,
                    mimeType: file.type,
                    base64: btoa(binary),
                  });
                  onChanged(
                    await api(`/citizens/${citizen.id}/identity-document`, "PUT", {
                      document: { attachmentId: uploaded.attachmentId, kind },
                    }),
                  );
                });
              }}
            />
          </div>
        </div>
      )}
      {canEdit && (
        <p id={`identity-file-hint-${citizen.id.slice(0, 8)}`} className="hint">
          {t("PDF, PNG or JPEG up to 2 MB. The image can be opened only after its security scan finds no threat.")}
        </p>
      )}
      {canEdit && linked && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => onChanged(await api(`/citizens/${citizen.id}/identity-document`, "PUT", { document: null })))
          }
        >
          {t("ছবি সরান / Remove image")}
        </button>
      )}
      {error && (
        <div className="error" role="alert">
          {t(error)}
        </div>
      )}
    </fieldset>
  );
}
