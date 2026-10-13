import React, { useEffect, useState } from "react";
import { api, items } from "./api.js";

const read = (o: any, a: string, b: string) => o?.[a] ?? o?.[b] ?? "";
export function AccountSecurity() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel narrow">
      <h2>Account security</h2>
      <p>Change your password. Other signed-in sessions will be expired.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            data = new FormData(form);
          setBusy(true);
          setMessage("");
          try {
            await api("/auth/password", "POST", {
              currentPassword: data.get("currentPassword"),
              newPassword: data.get("newPassword"),
            });
            form.reset();
            setMessage("Password updated. Other sessions have been expired.");
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="current-password">Current password</label>
        <input
          id="current-password"
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          name="newPassword"
          minLength={12}
          autoComplete="new-password"
          required
        />
        <button disabled={busy}>Update password</button>
      </form>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </section>
  );
}
export function AdminWorkspace() {
  const [recovery, setRecovery] = useState<any>(null);
  const [tab, setTab] = useState("users"),
    [office, setOffice] = useState<any>(null),
    [users, setUsers] = useState<any[]>([]),
    [services, setServices] = useState<any[]>([]),
    [notices, setNotices] = useState<any[]>([]),
    [authorizations, setAuthorizations] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const [u, s, n, a, o] = await Promise.all([
      api("/admin/users"),
      api("/admin/services"),
      api("/admin/notices"),
      api("/admin/authorizations"),
      api("/admin/office"),
    ]);
    setOffice(o);
    setUsers(items(u));
    setServices(items(s));
    setNotices(items(n));
    setAuthorizations(items(a));
  }
  async function run(fn: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await load();
      setMessage(success);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);
  return (
    <>
      <section className="panel">
        <h2>অফিস ব্যবস্থাপনা / Office administration</h2>
        <p>
          Manage your office's staff, demo service availability, explicit
          approval assignments and published notices.
        </p>
        <div
          className="tabs"
          role="tablist"
          aria-label="Administration sections"
        >
          {[
            ["office", "Office profile"],
            ["users", "Staff accounts"],
            ["services", "Service settings"],
            ["authority", "Approval authority"],
            ["notices", "Office notices"],
          ].map(([key, text]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "" : "secondary"}
              onClick={() => setTab(key)}
            >
              {text}
            </button>
          ))}
        </div>
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {recovery && (
          <div className="notice">
            <strong>Private one-use recovery link</strong>
            <p>
              Only provide this to the intended account holder through your
              trusted contact channel. Valid until{" "}
              {new Date(recovery.expiresAt).toLocaleString()}.
            </p>
            <label htmlFor="admin-recovery-link">Recovery link</label>
            <input
              id="admin-recovery-link"
              readOnly
              value={recovery.recoveryUrl}
              onFocus={(e) => e.target.select()}
            />
            <button
              className="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(recovery.recoveryUrl);
                  setMessage("Recovery link copied.");
                } catch {
                  document.getElementById("admin-recovery-link")?.focus();
                  setMessage(
                    "Select and copy the recovery link from the field.",
                  );
                }
              }}
            >
              Copy recovery link
            </button>{" "}
            <button className="text-button" onClick={() => setRecovery(null)}>
              Dismiss recovery link
            </button>
          </div>
        )}
      </section>
      {tab === "office" && office && (
        <section className="panel">
          <h2>Office profile and directory information</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void run(async () => {
                await api("/admin/office", "PATCH", Object.fromEntries(d));
              }, "Office profile saved.");
            }}
          >
            <div className="form-grid">
              {[
                ["nameBn", "Office name (Bangla)"],
                ["nameEn", "Office name (English)"],
                ["division", "Division"],
                ["district", "District"],
                ["upazila", "Upazila"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    name={key}
                    defaultValue={office[key]}
                    required
                    minLength={2}
                  />
                </label>
              ))}
              <label>
                Office type
                <select
                  aria-label="Office type"
                  name="officeType"
                  defaultValue={office.officeType}
                >
                  <option value="UNION">Union Parishad</option>
                  <option value="MUNICIPALITY">Municipality</option>
                  <option value="CITY_CORPORATION">City corporation</option>
                </select>
              </label>
            </div>
            <button disabled={busy}>Save office profile</button>
          </form>
        </section>
      )}
      {tab === "users" && (
        <>
          <section className="panel">
            <h2>Add staff account</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  d = new FormData(form);
                void run(async () => {
                  await api("/admin/users", "POST", Object.fromEntries(d));
                  form.reset();
                }, "Staff account created.");
              }}
            >
              <div className="form-grid">
                <label>
                  Staff email
                  <input name="email" type="email" required />
                </label>
                <label>
                  Staff display name
                  <input name="displayName" required />
                </label>
                <label>
                  Initial password
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    autoComplete="new-password"
                    required
                  />
                </label>
                <label>
                  Staff role
                  <select aria-label="Staff role" name="role">
                    {["staff", "reviewer", "approver", "finance", "admin"].map(
                      (r) => (
                        <option key={r}>{r}</option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              <button disabled={busy}>Create staff account</button>
            </form>
          </section>
          <section className="panel">
            <h2>Office accounts</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Update</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id || u.userId}>
                      <td>
                        {read(u, "displayName", "display_name")}
                        <small>{u.email}</small>
                      </td>
                      <td>
                        <select
                          aria-label={`Role for ${u.email}`}
                          value={u.role}
                          disabled={u.role === "citizen" || busy}
                          onChange={(e) =>
                            void run(async () => {
                              await api(
                                `/admin/users/${u.id || u.userId}`,
                                "PATCH",
                                { role: e.target.value },
                              );
                            }, "Staff role updated.")
                          }
                        >
                          {[
                            "citizen",
                            "staff",
                            "reviewer",
                            "approver",
                            "finance",
                            "admin",
                          ].map((r) => (
                            <option key={r}>{r}</option>
                          ))}
                        </select>
                      </td>
                      <td>{u.active === false ? "Suspended" : "Active"}</td>
                      <td>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api(
                                `/admin/users/${u.id || u.userId}`,
                                "PATCH",
                                { active: u.active === false },
                              );
                            }, "Account access updated.")
                          }
                        >
                          {u.active === false ? "Activate" : "Suspend"}
                        </button>
                        {u.active !== false &&
                          !["admin", "owner"].includes(u.role) && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  setRecovery(
                                    await api(
                                      `/admin/users/${u.id || u.userId}/recovery`,
                                      "POST",
                                      {},
                                    ),
                                  );
                                }, "One-use recovery link generated.")
                              }
                            >
                              Generate recovery link
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {tab === "services" && (
        <section className="panel">
          <h2>Enabled services and software credits</h2>
          <p className="hint">
            Credit cost is a SaaS charge, separate from unconfigured statutory
            government fees.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Credits per issue</th>
                  <th>Available</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => {
                  const no = s.serviceNo || s.service_no;
                  return (
                    <tr key={no}>
                      <td>
                        #{no} {read(s, "nameBn", "name_bn")}
                        <small>{read(s, "nameEn", "name_en")}</small>
                      </td>
                      <td>
                        <form
                          className="inline-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const d = new FormData(e.currentTarget);
                            void run(async () => {
                              await api(`/admin/services/${no}`, "PATCH", {
                                creditCost: Number(d.get("creditCost")),
                              });
                            }, "Service credit cost saved.");
                          }}
                        >
                          <input
                            aria-label={`Credit cost for service ${no}`}
                            type="number"
                            name="creditCost"
                            min={1}
                            max={10000}
                            defaultValue={s.creditCost ?? s.credit_cost ?? 1}
                            required
                          />
                          <button disabled={busy} className="secondary">
                            Save credits
                          </button>
                        </form>
                      </td>
                      <td>
                        <button
                          disabled={busy}
                          className={s.enabled ? "secondary" : ""}
                          onClick={() =>
                            void run(async () => {
                              await api(`/admin/services/${no}`, "PATCH", {
                                enabled: !s.enabled,
                              });
                            }, "Service availability saved.")
                          }
                        >
                          {s.enabled ? "Disable service" : "Enable service"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === "authority" && (
        <section className="panel">
          <h2>Explicit service approval authority</h2>
          <p className="notice">
            These assignments authorize demo workflow actions only. They do not
            confer government office or official signing authority.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void run(async () => {
                await api(
                  `/admin/authorizations/${d.get("userId")}/${d.get("serviceNo")}`,
                  "PUT",
                  {
                    active: d.get("active") === "true",
                    authorityNote: d.get("authorityNote"),
                  },
                );
              }, "Approval authorization recorded.");
            }}
          >
            <div className="form-grid">
              <label>
                Approver
                <select aria-label="Approver" name="userId" required>
                  <option value="">Choose approver</option>
                  {users
                    .filter((u) => u.role === "approver")
                    .map((u) => (
                      <option value={u.id || u.userId} key={u.id || u.userId}>
                        {u.email}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Authorized service
                <select aria-label="Authorized service" name="serviceNo">
                  {services.map((s) => (
                    <option
                      value={s.serviceNo || s.service_no}
                      key={s.serviceNo || s.service_no}
                    >
                      #{s.serviceNo || s.service_no}{" "}
                      {read(s, "nameEn", "name_en")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Authorization status
                <select aria-label="Authorization status" name="active">
                  <option value="true">Active</option>
                  <option value="false">Revoked</option>
                </select>
              </label>
              <label>
                Authority note
                <input
                  name="authorityNote"
                  minLength={12}
                  required
                  placeholder="Demo authorization scope and reason"
                />
              </label>
            </div>
            <button disabled={busy}>Save authorization</button>
          </form>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Approver</th>
                  <th>Service</th>
                  <th>State</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {authorizations.map((a, i) => (
                  <tr key={a.id || i}>
                    <td>
                      {a.email ||
                        users.find(
                          (u) => (u.id || u.userId) === (a.userId || a.user_id),
                        )?.email ||
                        a.userId ||
                        a.user_id}
                    </td>
                    <td>{a.serviceNo || a.service_no}</td>
                    <td>{a.active ? "Active" : "Revoked"}</td>
                    <td>{read(a, "authorityNote", "authority_note")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === "notices" && (
        <>
          <section className="panel">
            <h2>Publish an office notice</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  d = new FormData(form);
                void run(async () => {
                  await api("/admin/notices", "POST", {
                    titleBn: d.get("titleBn"),
                    titleEn: d.get("titleEn"),
                    bodyBn: d.get("bodyBn"),
                    bodyEn: d.get("bodyEn"),
                    published: d.get("published") === "true",
                  });
                  form.reset();
                }, "Office notice saved.");
              }}
            >
              <div className="form-grid">
                <label>
                  Notice title (Bangla)
                  <input name="titleBn" required />
                </label>
                <label>
                  Notice title (English)
                  <input name="titleEn" required />
                </label>
                <label>
                  Notice body (Bangla)
                  <textarea name="bodyBn" required />
                </label>
                <label>
                  Notice body (English)
                  <textarea name="bodyEn" required />
                </label>
                <label>
                  Publication
                  <select aria-label="Publication" name="published">
                    <option value="false">Save draft</option>
                    <option value="true">Publish publicly</option>
                  </select>
                </label>
              </div>
              <button disabled={busy}>Save notice</button>
            </form>
          </section>
          <section className="panel">
            <h2>Saved notices</h2>
            {notices.map((n) => (
              <article key={n.id} className="notice-entry">
                <h3>{read(n, "titleBn", "title_bn")}</h3>
                <p>{read(n, "bodyBn", "body_bn")}</p>
                <small>{read(n, "titleEn", "title_en")}</small>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/admin/notices/${n.id}`, "PATCH", {
                        published: !n.published,
                      });
                    }, "Notice publication updated.")
                  }
                >
                  {n.published ? "Unpublish notice" : "Publish notice"}
                </button>
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}

export function OwnerOnboarding({ onSaved }: { onSaved: () => Promise<void> }) {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel">
      <h2>Onboard a demo office</h2>
      <p>
        Create an isolated tenant and its first administrator. No official
        authority is asserted.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            d = new FormData(form);
          setBusy(true);
          setMessage("");
          try {
            await api("/owner/tenants", "POST", Object.fromEntries(d));
            await onSaved();
            form.reset();
            setMessage("Office and initial administrator created.");
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {[
            ["slug", "Unique office slug"],
            ["nameBn", "Office name (Bangla)"],
            ["nameEn", "Office name (English)"],
            ["division", "Division"],
            ["district", "District"],
            ["upazila", "Upazila"],
            ["adminEmail", "Administrator email"],
            ["adminName", "Administrator display name"],
            ["adminPassword", "Administrator initial password"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                required
                type={
                  key === "adminPassword"
                    ? "password"
                    : key === "adminEmail"
                      ? "email"
                      : "text"
                }
                minLength={key === "adminPassword" ? 12 : undefined}
                pattern={key === "slug" ? "[a-z0-9-]+" : undefined}
                autoComplete="off"
              />
            </label>
          ))}
          <label>
            Office type
            <select aria-label="Office type" name="officeType">
              <option value="UNION">Union Parishad</option>
              <option value="MUNICIPALITY">Municipality</option>
              <option value="CITY_CORPORATION">City corporation</option>
            </select>
          </label>
        </div>
        <button disabled={busy}>Create demo office</button>
      </form>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </section>
  );
}
