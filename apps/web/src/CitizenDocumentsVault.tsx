import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { t, useLanguage } from "./i18n.js";
import { useFormatters } from "./ui/fmt.js";
import { AttachmentStatus } from "./AttachmentStatus.js";

const accepted = ["image/jpeg", "image/png", "application/pdf"];
const kinds = ["nid", "birth_reg"] as const;
const kindLabel: Record<string, string> = {
  nid: "জাতীয় পরিচয়পত্র / NID",
  birth_reg: "জন্ম নিবন্ধন / Birth registration",
};

export type VaultDocument = {
  kind: string;
  attachmentId: string;
  mimeType: string;
  byteLength: number;
  scanState: string;
  downloadAllowed: boolean;
  updatedAt: string | null;
};

/**
 * WS-C: the citizen documents vault (migration 064) — one named slot per
 * kind (NID scan, birth-registration scan), uploaded once and reused in
 * applications through the DynamicForm picker. Uploads go through the
 * private attachment pipeline, so a document stays quarantined and
 * cannot be submitted until its malware scan is CLEAN — the vault is a
 * reuse shelf, never a scan bypass.
 *
 * Integration with the older single identity-document slot (Phase 3c):
 * the vault list dual-reads a legacy document with no vault row, and
 * the vault endpoint keeps the legacy columns in sync when they name
 * the same kind. When a citizen links a kind while the legacy slot is
 * still empty, this control also writes the legacy link so the staff
 * register (which still uses the older control) shows the same
 * document instead of an empty slot.
 */
export function CitizenDocumentsVault({
  citizen,
  canEdit,
  onChanged,
}: {
  citizen: any;
  canEdit: boolean;
  onChanged?: (citizen: any) => void;
}) {
  useLanguage();
  const fmt = useFormatters();
  const [documents, setDocuments] = useState<VaultDocument[] | null>(null);
  const [busyKind, setBusyKind] = useState<string>("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api(`/citizens/${citizen.id}/documents`)
      .then((r) => active && setDocuments(r.items ?? []))
      .catch((e) => active && setError((e as Error).message));
    return () => {
      active = false;
    };
  }, [citizen.id]);

  async function run(kind: string, fn: () => Promise<void>) {
    setBusyKind(kind);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKind("");
    }
  }

  async function link(kind: string, attachmentId: string | null) {
    const result = await api(`/citizens/${citizen.id}/documents/${kind}`, "PUT", {
      attachmentId,
    });
    setDocuments(result.items ?? []);
    // Keep the older single-slot reader (staff register) consistent: a
    // first link also fills the legacy slot when it is empty.
    if (attachmentId && !citizen.identityDocument && onChanged) {
      onChanged(
        await api(`/citizens/${citizen.id}/identity-document`, "PUT", {
          document: { attachmentId, kind },
        }),
      );
    }
  }

  return (
    <div data-testid="citizen-documents-vault">
      <p className="hint">
        {t(
          "এখানে নথি একবার আপলোড করলে আবেদনের সময় আবার আপলোড না করে বেছে নেওয়া যাবে। নিরাপত্তা পরীক্ষায় ঠিক থাকলেই নথি জমা দেওয়া যায়। / Upload a document once here and pick it in applications without uploading again. A document can be submitted only after its safety check passes.",
        )}
      </p>
      {kinds.map((kind) => {
        const doc = documents?.find((d) => d.kind === kind);
        const busy = busyKind === kind;
        return (
          <fieldset className="citizen-details vault-document" key={kind}>
            <legend>{t(kindLabel[kind])}</legend>
            {documents === null ? (
              <p className="hint">{t("নথি খোঁজা হচ্ছে… / Loading documents…")}</p>
            ) : doc ? (
              <>
                <AttachmentStatus
                  attachment={{
                    attachmentId: doc.attachmentId,
                    mimeType: doc.mimeType,
                    byteLength: doc.byteLength,
                  }}
                />
                {doc.updatedAt && (
                  <p className="hint">
                    {t("সর্বশেষ হালনাগাদ / Last updated")}: {fmt.date(doc.updatedAt)}
                  </p>
                )}
              </>
            ) : (
              <p className="hint">{t("এই নথি এখনও যোগ করা হয়নি। / This document has not been added yet.")}</p>
            )}
            {canEdit && (
              <div className="field">
                <label htmlFor={`vault-file-${kind}-${citizen.id.slice(0, 8)}`}>
                  {t(doc ? "নথি বদলান / Replace document" : "নথি যোগ করুন / Add document")}
                </label>
                <input
                  id={`vault-file-${kind}-${citizen.id.slice(0, 8)}`}
                  type="file"
                  accept={accepted.join(",")}
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    void run(kind, async () => {
                      if (!accepted.includes(file.type))
                        throw Error("Select a PDF, PNG or JPEG document.");
                      if (file.size > 2 * 1024 * 1024)
                        throw Error("Uploads must be between 8 bytes and 2 MiB.");
                      const bytes = new Uint8Array(await file.arrayBuffer());
                      let binary = "";
                      for (let offset = 0; offset < bytes.length; offset += 16_384)
                        binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
                      const uploaded = await api("/attachments", "POST", {
                        citizenId: citizen.id,
                        mimeType: file.type,
                        base64: btoa(binary),
                      });
                      await link(kind, uploaded.attachmentId);
                    });
                  }}
                />
              </div>
            )}
            {canEdit && doc && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void run(kind, () => link(kind, null))}
              >
                {t("নথি সরান / Remove document")}
              </button>
            )}
          </fieldset>
        );
      })}
      {error && (
        <div className="error" role="alert">
          {t(error)}
        </div>
      )}
    </div>
  );
}
