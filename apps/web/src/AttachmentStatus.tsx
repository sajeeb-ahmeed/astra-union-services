import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

export type AttachmentHandle = {
  attachmentId: string;
  mimeType: string;
  byteLength: number;
};
type ScanState = "QUARANTINED" | "SCANNING" | "CLEAN" | "REJECTED" | "ERROR";
type Metadata = AttachmentHandle & {
  scanState: ScanState | "UNSCANNED";
  downloadAllowed: boolean;
  retryAllowed: boolean;
  retryAfter: string | null;
  reasonCode: string | null;
  scannedAt: string | null;
  scannerAvailable: boolean;
};
type Copy = { bn: string; en: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const labels: Record<Metadata["scanState"], Copy> = {
  QUARANTINED: { bn: "পরীক্ষার অপেক্ষায়", en: "Waiting for safety check" },
  SCANNING: { bn: "নিরাপত্তা পরীক্ষা চলছে", en: "Safety check in progress" },
  CLEAN: { bn: "পরীক্ষায় ক্ষতিকর ফাইল পাওয়া যায়নি", en: "No threat detected" },
  REJECTED: { bn: "নথিটি গ্রহণ করা হয়নি", en: "Document rejected" },
  ERROR: { bn: "পরীক্ষা শেষ হয়নি", en: "Safety check incomplete" },
  UNSCANNED: { bn: "এখনও পরীক্ষা হয়নি", en: "Not yet checked" },
};
const pending = (state?: string) =>
  state === "QUARANTINED" || state === "SCANNING";
const errorCopy: Copy = {
  bn: "নথির পরীক্ষার অবস্থা পাওয়া যায়নি। আবার অবস্থা দেখুন।",
  en: "The document's safety status could not be checked. Refresh its status.",
};

/** Server metadata stays separate from the immutable application handle. */
export function AttachmentStatus({
  attachment,
  editable = false,
  inputId,
}: {
  attachment: AttachmentHandle;
  editable?: boolean;
  inputId?: string;
}) {
  useLanguage();
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [error, setError] = useState<Copy | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const validId = uuid.test(attachment.attachmentId);

  useEffect(() => {
    const epoch = ++generation.current;
    let active = true;
    let pageActive = true;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checks = 0;
    let terminalFailure = false;
    let lastState: string | undefined;
    const current = () => active && pageActive && generation.current === epoch;
    setMetadata(null);
    setError(null);
    setLoading(false);
    setPaused(false);
    setRetrying(false);

    async function load() {
      if (
        !current() ||
        document.visibilityState === "hidden" ||
        terminalFailure
      )
        return;
      if (!validId) {
        setError(errorCopy);
        return;
      }
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setLoading(true);
      try {
        const response = await fetch(
          `/api/v1/attachments/${attachment.attachmentId}/status`,
          { credentials: "include", cache: "no-store", signal: request.signal },
        );
        if (!current() || request.signal.aborted) return;
        if (!response.ok) {
          terminalFailure = [401, 403, 404].includes(response.status);
          throw new Error("Attachment status unavailable.");
        }
        const source = await response.json();
        if (!current() || request.signal.aborted) return;
        if (
          source.attachmentId !== attachment.attachmentId ||
          source.mimeType !== attachment.mimeType ||
          source.byteLength !== attachment.byteLength ||
          typeof source.scanState !== "string" ||
          typeof source.downloadAllowed !== "boolean" ||
          typeof source.retryAllowed !== "boolean" ||
          typeof source.scannerAvailable !== "boolean" ||
          !(
            source.retryAfter === null ||
            (typeof source.retryAfter === "string" &&
              Number.isFinite(Date.parse(source.retryAfter)))
          )
        )
          throw new Error("Invalid attachment status.");
        // Legacy and unrecognised states can never imply a clean file.
        const scanState: Metadata["scanState"] = Object.hasOwn(
          labels,
          source.scanState,
        )
          ? source.scanState
          : "UNSCANNED";
        const result: Metadata = { ...source, scanState };
        setMetadata(result);
        setError(null);
        lastState = scanState;
        checks += 1;
        if (pending(scanState)) {
          if (checks < 12) timer = setTimeout(() => void load(), 5000);
          else setPaused(true);
        }
      } catch {
        if (!current() || request.signal.aborted) return;
        setMetadata(null);
        setError(errorCopy);
      } finally {
        if (current() && !request.signal.aborted) setLoading(false);
      }
    }
    function suspend() {
      controller?.abort();
      clearTimeout(timer);
      setLoading(false);
    }
    function visibility() {
      if (document.visibilityState === "hidden") suspend();
      else if (checks < 12 && (!lastState || pending(lastState))) void load();
    }
    function hide() {
      pageActive = false;
      generation.current += 1;
      suspend();
      setMetadata(null);
      setRetrying(false);
    }
    function show() {
      // A new effect invalidates every response from the previous page lifetime.
      if (!pageActive && active) setRevision((value) => value + 1);
    }
    void load();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      active = false;
      generation.current += 1;
      controller?.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, [
    attachment.attachmentId,
    attachment.mimeType,
    attachment.byteLength,
    revision,
    validId,
  ]);

  async function retry() {
    if (
      !validId ||
      metadata?.attachmentId !== attachment.attachmentId ||
      !metadata?.retryAllowed ||
      metadata.scanState !== "ERROR" ||
      retrying
    )
      return;
    const epoch = generation.current;
    setRetrying(true);
    setError(null);
    try {
      await api(`/attachments/${attachment.attachmentId}/retry`, "POST", {});
      if (generation.current === epoch) setRevision((value) => value + 1);
    } catch {
      if (generation.current === epoch)
        setError({
          bn: "আবার পরীক্ষার অনুরোধ করা যায়নি। অবস্থা হালনাগাদ করে পরে চেষ্টা করুন।",
          en: "The safety check could not be requested again. Refresh the status and try later.",
        });
    } finally {
      if (generation.current === epoch) setRetrying(false);
    }
  }
  const canDownload =
    validId &&
    metadata?.attachmentId === attachment.attachmentId &&
    metadata.scanState === "CLEAN" &&
    metadata.downloadAllowed;
  const replacementNeeded =
    metadata && ["REJECTED", "UNSCANNED"].includes(metadata.scanState);
  const retryDate = metadata?.retryAfter ? new Date(metadata.retryAfter) : null;
  const waitForRetry =
    retryDate &&
    !Number.isNaN(retryDate.getTime()) &&
    retryDate.getTime() > Date.now();
  return (
    <div
      className="attachment-status"
      data-testid="attachment-status"
      aria-busy={loading || retrying}
    >
      <p className="hint" role="status">
        <strong>
          {choose(
            metadata
              ? labels[metadata.scanState]
              : error
                ? {
                    bn: "নিরাপত্তা পরীক্ষার অবস্থা পাওয়া যায়নি",
                    en: "Safety status unavailable",
                  }
                : {
                    bn: "নিরাপত্তা পরীক্ষার অবস্থা যাচাই হচ্ছে…",
                    en: "Checking document safety status…",
                  },
          )}
        </strong>
        {" · "}
        {attachment.byteLength.toLocaleString()}{" "}
        {choose({ bn: "বাইট", en: "bytes" })}
      </p>
      {metadata && !canDownload && (
        <p className="hint">
          {choose(
            pending(metadata.scanState) && !metadata.scannerAvailable
              ? {
                  bn: "স্ক্যানারের অপেক্ষায় আছে। পরীক্ষা শেষ না হওয়া পর্যন্ত নথি ডাউনলোড বা আবেদন এগিয়ে নেওয়া যাবে না।",
                  en: "Waiting for the scanner. The document cannot be downloaded or the application progressed until the check finishes.",
                }
              : metadata.scanState === "REJECTED"
                ? {
                    bn: "নথিটি নিরাপত্তা পরীক্ষায় গ্রহণ করা হয়নি। অন্য একটি নথি দিন।",
                    en: "The document did not pass the safety check. Choose a replacement document.",
                  }
                : metadata.scanState === "ERROR"
                  ? {
                      bn: "নথিটি নিরাপদ বলে নিশ্চিত করা যায়নি। পরে আবার পরীক্ষা করুন।",
                      en: "The document has not been cleared. Request another check when available.",
                    }
                  : metadata.scanState === "CLEAN"
                    ? {
                        bn: "নথিটি এখন ডাউনলোড করা যাচ্ছে না। সংশ্লিষ্ট অফিসের সঙ্গে যোগাযোগ করুন।",
                        en: "This document is unavailable for download. Contact the office.",
                      }
                    : {
                        bn: "পরীক্ষা শেষ না হওয়া পর্যন্ত ডাউনলোড ও আবেদন এগিয়ে নেওয়া বন্ধ থাকবে। খসড়া সংরক্ষণ করতে পারবেন।",
                        en: "Download and application progress remain blocked until the check finishes. You can save a draft.",
                      },
          )}
        </p>
      )}
      {replacementNeeded && !editable && (
        <p className="hint">
          {choose({
            bn: "নথি বদলাতে আবেদনটি সংশোধনের জন্য ফেরত নিতে হবে। সংশ্লিষ্ট অফিসের সঙ্গে যোগাযোগ করুন।",
            en: "The application must be returned for correction before its document can be replaced. Contact the office.",
          })}
        </p>
      )}
      {paused && (
        <p className="hint">
          {choose({
            bn: "স্বয়ংক্রিয় যাচাই আপাতত বন্ধ। নিচের বোতামে সর্বশেষ অবস্থা দেখুন।",
            en: "Automatic checks have paused. Refresh below for the latest status.",
          })}
        </p>
      )}
      {waitForRetry && (
        <p className="hint">
          {choose({
            bn: "আবার পরীক্ষার অনুরোধের আগে কিছুক্ষণ অপেক্ষা করুন, তারপর অবস্থা হালনাগাদ করুন।",
            en: "Wait before requesting another check, then refresh the status.",
          })}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {choose(error)}
        </p>
      )}
      <div className="actions">
        {canDownload && (
          <a
            className="button secondary"
            href={`/api/v1/attachments/${attachment.attachmentId}`}
            download
          >
            {choose({ bn: "নথি ডাউনলোড করুন", en: "Download document" })}
          </a>
        )}
        <button
          type="button"
          className="text-button"
          disabled={!validId || loading || retrying}
          onClick={() => setRevision((value) => value + 1)}
        >
          {choose({ bn: "অবস্থা হালনাগাদ করুন", en: "Refresh status" })}
        </button>
        {metadata?.scanState === "ERROR" && metadata.retryAllowed && (
          <button
            type="button"
            className="secondary"
            disabled={loading || retrying || !!waitForRetry}
            onClick={() => void retry()}
          >
            {choose({ bn: "আবার পরীক্ষা করুন", en: "Retry safety check" })}
          </button>
        )}
        {replacementNeeded && editable && inputId && (
          <button
            type="button"
            className="text-button"
            onClick={() => document.getElementById(inputId)?.focus()}
          >
            {choose({ bn: "অন্য নথি বেছে নিন", en: "Choose a replacement" })}
          </button>
        )}
      </div>
    </div>
  );
}
