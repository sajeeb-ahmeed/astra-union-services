import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

const label = (bn: string, en: string) => choose({ bn, en });
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => new Date(v).toISOString();

type Draft = {
  titleBn: string;
  titleEn: string;
  bodyBn: string;
  bodyEn: string;
  linkUrl: string;
  startsAt: string;
  endsAt: string;
  published: boolean;
};
const emptyDraft: Draft = {
  titleBn: "",
  titleEn: "",
  bodyBn: "",
  bodyEn: "",
  linkUrl: "",
  startsAt: toLocalInput(new Date().toISOString()),
  endsAt: "",
  published: true,
};

const statusText = (s: string) =>
  s === "live"
    ? label("লাইভ", "Live")
    : s === "scheduled"
      ? label("নির্ধারিত", "Scheduled")
      : s === "expired"
        ? label("মেয়াদ শেষ", "Expired")
        : label("অপ্রকাশিত", "Unpublished");

/**
 * Phase 3E: the owner's Notices screen (§3.8) — global notices for the whole
 * portal. The owner publishes a notice (title + body in both languages, an
 * optional link, a start/end window) and it shows as a banner on the homepage
 * and in the dashboards while it is live; publish/unpublish works at any time.
 * Every save carries a mandatory reason into the notice's audit history. These
 * are platform notices — the per-office notices stay in the office workspace.
 */
export function OwnerNotices() {
  useLanguage();
  const [items, setItems] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [reason, setReason] = useState("");
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    api("/owner/notices")
      .then((r) => setItems(r.items ?? []))
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const startCreate = () => {
    setDraft({ ...emptyDraft, startsAt: toLocalInput(new Date().toISOString()) });
    setEditingId(null);
    setCreating(true);
    setMessage("");
    setError("");
  };
  const startEdit = (notice: any) => {
    setDraft({
      titleBn: notice.titleBn,
      titleEn: notice.titleEn,
      bodyBn: notice.bodyBn,
      bodyEn: notice.bodyEn,
      linkUrl: notice.linkUrl ?? "",
      startsAt: toLocalInput(notice.startsAt),
      endsAt: notice.endsAt ? toLocalInput(notice.endsAt) : "",
      published: notice.published,
    });
    setEditingId(notice.id);
    setCreating(false);
    setMessage("");
    setError("");
  };
  const cancelForm = () => {
    setCreating(false);
    setEditingId(null);
  };
  const validReason = () => {
    if (reason.trim().length < 8) {
      setError(label("কারণ আবশ্যক (কমপক্ষে ৮ অক্ষর)।", "A reason is required (at least 8 characters)."));
      return false;
    }
    return true;
  };
  const draftBody = () => {
    if (draft.titleBn.trim().length < 2 || draft.titleEn.trim().length < 2)
      throw new Error(label("দুই ভাষাতেই শিরোনাম দিন।", "Give the notice a title in both languages."));
    if (!draft.bodyBn.trim() || !draft.bodyEn.trim())
      throw new Error(label("দুই ভাষাতেই বিবরণ দিন।", "Give the notice a body in both languages."));
    if (draft.linkUrl.trim() && !/^https?:\/\//.test(draft.linkUrl.trim()))
      throw new Error(label("লিংক http:// বা https:// দিয়ে শুরু হতে হবে।", "The link must start with http:// or https://."));
    if (!draft.startsAt) throw new Error(label("শুরুর সময় দিন।", "Give the notice a start time."));
    return {
      titleBn: draft.titleBn.trim(),
      titleEn: draft.titleEn.trim(),
      bodyBn: draft.bodyBn.trim(),
      bodyEn: draft.bodyEn.trim(),
      linkUrl: draft.linkUrl.trim() ? draft.linkUrl.trim() : null,
      startsAt: fromLocalInput(draft.startsAt),
      endsAt: draft.endsAt ? fromLocalInput(draft.endsAt) : null,
      published: draft.published,
      reason: reason.trim(),
    };
  };
  const save = async () => {
    if (!validReason()) return;
    let body: ReturnType<typeof draftBody>;
    try {
      body = draftBody();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (creating) await api("/owner/notices", "POST", body);
      else await api(`/owner/notices/${editingId}`, "PUT", body);
      setMessage(label("নোটিশ সংরক্ষিত হয়েছে।", "Notice saved."));
      setReason("");
      cancelForm();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const togglePublish = async (notice: any) => {
    if (!validReason()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/owner/notices/${notice.id}/publish`, "POST", {
        published: !notice.published,
        reason: reason.trim(),
      });
      setMessage(
        !notice.published
          ? label("নোটিশ প্রকাশিত হয়েছে।", "Notice published.")
          : label("নোটিশ অপ্রকাশিত করা হয়েছে — পোর্টালে আর দেখাবে না।", "Notice unpublished — it no longer shows on the portal."),
      );
      setReason("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const showHistory = async (notice: any) => {
    if (historyFor === notice.id) {
      setHistoryFor(null);
      setHistory([]);
      return;
    }
    try {
      const r = await api(`/owner/notices/${notice.id}/changes`);
      setHistory(r.items ?? []);
      setHistoryFor(notice.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="owner-plans">
      <p className="hint">
        {label(
          "গ্লোবাল নোটিশ পুরো পোর্টালে ব্যানার হিসেবে দেখায় — হোমপেজ ও সব ড্যাশবোর্ডে — যতক্ষণ তা প্রকাশিত ও সময়সীমার মধ্যে থাকে।",
          "A global notice shows as a banner across the whole portal — the homepage and every dashboard — while it is published and inside its window.",
        )}
      </p>
      <label>
        {label("পরিবর্তনের কারণ (আবশ্যক)", "Reason for the change (required)")}
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={label("কমপক্ষে ৮ অক্ষর", "At least 8 characters")}
        />
      </label>
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!creating && !editingId && (
        <button type="button" className="secondary" disabled={busy} onClick={startCreate}>
          {label("নতুন নোটিশ", "New notice")}
        </button>
      )}
      {(creating || editingId) && (
        <form
          className="owner-plan-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h4>{creating ? label("নতুন নোটিশ", "New notice") : label("নোটিশ সম্পাদনা", "Edit notice")}</h4>
          <label>
            {label("শিরোনাম (বাংলা)", "Title (Bangla)")}
            <input value={draft.titleBn} onChange={(e) => set({ titleBn: e.target.value })} required />
          </label>
          <label>
            {label("শিরোনাম (English)", "Title (English)")}
            <input value={draft.titleEn} onChange={(e) => set({ titleEn: e.target.value })} required />
          </label>
          <label>
            {label("বিবরণ (বাংলা)", "Body (Bangla)")}
            <textarea value={draft.bodyBn} onChange={(e) => set({ bodyBn: e.target.value })} required rows={3} />
          </label>
          <label>
            {label("বিবরণ (English)", "Body (English)")}
            <textarea value={draft.bodyEn} onChange={(e) => set({ bodyEn: e.target.value })} required rows={3} />
          </label>
          <label>
            {label("লিংক (ঐচ্ছিক)", "Link (optional)")}
            <input
              value={draft.linkUrl}
              onChange={(e) => set({ linkUrl: e.target.value })}
              placeholder="https://"
            />
          </label>
          <label>
            {label("শুরু", "Starts")}
            <input
              type="datetime-local"
              value={draft.startsAt}
              onChange={(e) => set({ startsAt: e.target.value })}
              required
            />
          </label>
          <label>
            {label("শেষ (খালি = সীমাহীন)", "Ends (empty = no end)")}
            <input
              type="datetime-local"
              value={draft.endsAt}
              onChange={(e) => set({ endsAt: e.target.value })}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.published}
              onChange={(e) => set({ published: e.target.checked })}
            />
            {label("প্রকাশিত", "Published")}
          </label>
          <div className="button-row">
            <button type="submit" className="primary" disabled={busy}>
              {label("সংরক্ষণ করুন", "Save notice")}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={cancelForm}>
              {label("বাতিল", "Cancel")}
            </button>
          </div>
        </form>
      )}
      <div className="table-scroll">
        <table className="owner-plans-table">
          <thead>
            <tr>
              <th>{label("শিরোনাম", "Title")}</th>
              <th>{label("সময়সীমা", "Window")}</th>
              <th>{label("অবস্থা", "Status")}</th>
              <th>{label("পদক্ষেপ", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((notice) => (
              <tr key={notice.id}>
                <td>
                  <strong>{label(notice.titleBn, notice.titleEn)}</strong>
                  <div className="hint">{label(notice.bodyBn, notice.bodyEn)}</div>
                </td>
                <td>
                  {new Date(notice.startsAt).toLocaleString()}
                  {" → "}
                  {notice.endsAt
                    ? new Date(notice.endsAt).toLocaleString()
                    : label("সীমাহীন", "No end")}
                </td>
                <td>{statusText(notice.status)}</td>
                <td>
                  <div className="button-row">
                    <button type="button" className="secondary" disabled={busy} onClick={() => startEdit(notice)}>
                      {label("সম্পাদনা", "Edit")}
                    </button>
                    <button type="button" className="secondary" disabled={busy} onClick={() => void togglePublish(notice)}>
                      {notice.published ? label("অপ্রকাশ করুন", "Unpublish") : label("প্রকাশ করুন", "Publish")}
                    </button>
                    <button type="button" className="secondary" disabled={busy} onClick={() => void showHistory(notice)}>
                      {label("ইতিহাস", "History")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={4}>{label("এখনো কোনো গ্লোবাল নোটিশ নেই।", "No global notices yet.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {historyFor && (
        <div className="owner-plan-history">
          <h4>{label("নোটিশের ইতিহাস", "Notice history")}</h4>
          {history.map((h, i) => (
            <p key={i} className="hint">
              {h.action} · {new Date(h.createdAt).toLocaleString()} · {h.reason}
            </p>
          ))}
          {!history.length && <p className="hint">{label("কোনো ইতিহাস নেই।", "No history.")}</p>}
        </div>
      )}
    </div>
  );
}
