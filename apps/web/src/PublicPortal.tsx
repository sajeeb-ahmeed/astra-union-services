import React, { useEffect, useState } from "react";
import { serviceCatalog } from "@astra/shared-schemas";
import { api, items } from "./api.js";

const publicPages: Record<string, [string, string]> = {
  home: ["হোম", "Home"],
  services: ["নাগরিক সেবা", "Services"],
  offices: ["সেবার আওতাভুক্ত অফিস", "Office directory"],
  notices: ["বিজ্ঞপ্তি", "Notices"],
  help: ["সহায়িকা", "Help"],
  tracking: ["আবেদনের অবস্থা", "Track application"],
  verify: ["সনদ যাচাই", "Verify certificate"],
};
const value = (o: any, camel: string, snake: string) =>
  o?.[camel] ?? o?.[snake] ?? "";
function RecoveryForm() {
  const [token, setToken] = useState(
      new URLSearchParams(location.search).get("token") || "",
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    if (location.search) history.replaceState({}, "", "/recover");
  }, []);
  return (
    <section className="panel narrow">
      <h1>অ্যাকাউন্ট পুনরুদ্ধার / Account recovery</h1>
      <p>
        Contact your office administrator using your existing trusted contact
        channel. After checking the request, they can provide a one-use recovery
        link valid for 15 minutes. This demonstration does not send OTP, email
        or SMS.
      </p>
      {done ? (
        <p role="status" className="notice">
          Password reset completed. All earlier sessions have expired.{" "}
          <a href="/login">Sign in with your new password</a>.
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            if (d.get("password") !== d.get("confirm")) {
              setMessage("Passwords must match.");
              return;
            }
            setBusy(true);
            setMessage("");
            try {
              await api("/auth/recover", "POST", {
                token,
                newPassword: d.get("password"),
              });
              setDone(true);
              setToken("");
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="recovery-token">Recovery token</label>
          <input
            id="recovery-token"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
          <label htmlFor="recovery-password">New password</label>
          <input
            id="recovery-password"
            type="password"
            name="password"
            minLength={12}
            required
            autoComplete="new-password"
          />
          <label htmlFor="recovery-confirm">Confirm new password</label>
          <input
            id="recovery-confirm"
            type="password"
            name="confirm"
            minLength={12}
            required
            autoComplete="new-password"
          />
          <button disabled={busy}>Reset password</button>
        </form>
      )}
      {message && (
        <p className="notice error" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
function ApplicationTracking() {
  const [id, setId] = useState(""),
    [result, setResult] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel narrow">
      <h1>আবেদনের বর্তমান অবস্থা</h1>
      <p>
        Enter the full reference of a submitted application from your signed-in
        application page. Drafts stay private. Results contain status and
        service information only.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          setResult(null);
          try {
            setResult(await api(`/track/${encodeURIComponent(id.trim())}`));
          } catch {
            setMessage(
              "Application not found. Check the full reference and try again.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="tracking-id">Application reference</label>
        <input
          id="tracking-id"
          required
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Full application UUID"
        />
        <button disabled={busy}>Track application</button>
      </form>
      {message && (
        <p role="alert" className="notice">
          {message}
        </p>
      )}
      {result && (
        <div className="tracking-result">
          <h2>{result.serviceBn}</h2>
          <p>{result.serviceEn}</p>
          <span className="status">{result.status}</span>
          <p>
            {result.officeBn} / {result.officeEn}
          </p>
          <small>Submitted record: {String(result.createdAt)}</small>
          <p className="notice">DEMO / NOT OFFICIAL</p>
        </div>
      )}
    </section>
  );
}
export function CivicIcon({ index = 0 }: { index?: number }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {index % 3 === 0 ? (
        <>
          <path d="M13 5h17l7 7v31H13zM29 5v9h8M19 21h12M19 27h12M19 33h6" />
          <circle cx="31" cy="35" r="5" />
        </>
      ) : index % 3 === 1 ? (
        <>
          <path d="m5 18 19-12 19 12H5ZM9 41h30M12 22v14M24 22v14M36 22v14M6 36h36v5H6z" />
        </>
      ) : (
        <>
          <circle cx="24" cy="14" r="7" />
          <path d="M10 40v-6a14 14 0 0 1 28 0v6H10ZM16 27l8 7 8-7" />
        </>
      )}
    </svg>
  );
}
export function PublicPortal({ login }: { login: React.ReactNode }) {
  const initial = location.pathname.split("/")[1] || "home";
  const [page, setPage] = useState(initial),
    [search, setSearch] = useState(""),
    [serviceNo, setServiceNo] = useState<number | null>(null);
  const initialFilters = Object.fromEntries(
    new URLSearchParams(location.search),
  );
  const [filters, setFilters] = useState({
    q: initialFilters.q || "",
    division: initialFilters.division || "",
    district: initialFilters.district || "",
    upazila: initialFilters.upazila || "",
    type: initialFilters.type || "",
  });
  const [officePageSize, setOfficePageSize] = useState(
    Number(initialFilters.pageSize || 6),
  );
  const [directory, setDirectory] = useState<any>({
      items: [],
      total: 0,
      page: Number(initialFilters.page || 1),
      pageSize: 6,
    }),
    [office, setOffice] = useState<any>(null),
    [notices, setNotices] = useState<any[]>([]),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [token, setToken] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [noticePage, setNoticePage] = useState(1),
    [noticeTotal, setNoticeTotal] = useState(0),
    [noticeSearch, setNoticeSearch] = useState(
      initial === "notices" ? initialFilters.q || "" : "",
    ),
    [faqSearch, setFaqSearch] = useState("");
  const [signupSearch, setSignupSearch] = useState("");
  const [signupOffices, setSignupOffices] = useState<any[]>([]),
    [registered, setRegistered] = useState(false);
  const [registration, setRegistration] = useState({
    email: "",
    password: "",
    displayName: "",
    tenantId: "",
    nameBn: "",
    nameEn: "",
    dateOfBirth: "",
    addressBn: "",
    addressEn: "",
    syntheticReference: "DEMO-",
  });
  function nav(next: string) {
    setPage(next);
    setOffice(null);
    setError("");
    history.pushState({}, "", next === "home" ? "/" : `/${next}`);
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const pop = () => {
      setPage(location.pathname.split("/")[1] || "home");
      setOffice(null);
    };
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
  async function loadOffices(p = 1) {
    setWorking(true);
    setError("");
    const query = new URLSearchParams({
      ...filters,
      page: String(p),
      pageSize: String(officePageSize),
    });
    try {
      const result = await api(`/offices?${query}`);
      setDirectory(result);
      history.replaceState({}, "", `/offices?${query}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function loadNotices(p = 1) {
    setWorking(true);
    setError("");
    const query = new URLSearchParams({
      q: noticeSearch,
      page: String(p),
      pageSize: "6",
    });
    try {
      const result = await api(`/notices?${query}`);
      setNotices(items(result));
      setNoticeTotal(result.total);
      setNoticePage(result.page);
      history.replaceState({}, "", `/notices?${query}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  useEffect(() => {
    if (page === "offices")
      void loadOffices(
        Number(new URLSearchParams(location.search).get("page") || 1),
      );
    if (page === "notices")
      void loadNotices(
        Number(new URLSearchParams(location.search).get("page") || 1),
      );
    if (page === "home")
      api("/notices?pageSize=6")
        .then((d) => setNotices(items(d)))
        .catch(() => setNotices([]));
    if (page === "register")
      api("/offices?pageSize=100")
        .then((d) =>
          setSignupOffices((previous) => [
            ...previous.filter(
              (o) =>
                o.id === registration.tenantId &&
                !items(d).some((n) => n.id === o.id),
            ),
            ...items(d),
          ]),
        )
        .catch((e) => setError(e.message));
  }, [page]);
  const services = serviceCatalog.filter((s) =>
    `${s.service_no} ${s.name_bn} ${s.name_en}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selected = serviceCatalog.find((s) => s.service_no === serviceNo);
  const servicesView = (compact = false) => (
    <>
      <div className="public-section-heading">
        <div>
          <span className="eyebrow">CITIZEN SERVICES</span>
          <h2>আপনার প্রয়োজনীয় সেবাটি বেছে নিন</h2>
          <p>সনদ, প্রত্যয়ন ও লাইসেন্সের জন্য এক জায়গায় আবেদন।</p>
        </div>
        {compact && (
          <button className="secondary" onClick={() => nav("services")}>
            সব ৪৭টি সেবা দেখুন →
          </button>
        )}
      </div>
      {!compact && (
        <>
          <label htmlFor="public-service-search">
            সেবা খুঁজুন / Search public services
          </label>
          <input
            id="public-service-search"
            placeholder="সেবার নাম বা নম্বর লিখুন"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </>
      )}
      <div className="public-service-grid">
        {(compact
          ? services.filter((s) =>
              [1, 2, 3, 8, 42, 45, 46, 47].includes(s.service_no),
            )
          : services
        ).map((s) => (
          <button
            className="public-service"
            key={s.service_no}
            onClick={() => {
              setServiceNo(s.service_no);
              if (compact) nav("services");
            }}
          >
            <CivicIcon index={s.service_no} />
            <strong>{s.name_bn}</strong>
            <small>{s.name_en}</small>
            <span>
              আবেদনের তথ্য দেখুন <b>→</b>
            </span>
          </button>
        ))}
      </div>
      {!services.length && (
        <p role="status" className="empty-state">
          এই নামে কোনো সেবা পাওয়া যায়নি। No services match.
        </p>
      )}
      {selected && !compact && (
        <section
          className="panel service-information"
          aria-label="Service information"
        >
          <span className="eyebrow">SERVICE {selected.service_no}</span>
          <h2>{selected.name_bn}</h2>
          <p>{selected.name_en}</p>
          <ol>
            <li>
              Choose your participating office and create a synthetic demo
              account.
            </li>
            <li>
              Complete the service form and attach requested sample evidence.
            </li>
            <li>Submit for office review; follow any correction request.</li>
            <li>
              An authorized approver can issue a clearly marked demo document.
              View status in your account and verify its QR link.
            </li>
          </ol>
          <p className="notice">
            These independently authored workflows are demonstrations. Original
            government requirements, fees, identity checks and official
            certificate authority are not established by the reference audit.
          </p>
          <button onClick={() => nav("login")}>Sign in to apply</button>{" "}
          <button className="secondary" onClick={() => nav("register")}>
            Create demo account
          </button>
        </section>
      )}
    </>
  );
  return (
    <div className="public-site">
      <a className="skip" href="#public-content">
        Skip to main content
      </a>
      <div className="public-top">
        <div className="public-container">
          <span>ডিজিটাল নাগরিক সেবায় স্বাগতম</span>
          <span>স্বতন্ত্র সফটওয়্যার প্রদর্শনী · DEMO</span>
        </div>
      </div>
      <header className="public-header public-container">
        <a
          className="public-brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            nav("home");
          }}
        >
          <span className="brand-symbol">A</span>
          <span>
            <strong>অ্যাস্ট্রা</strong>
            <small>ASTRA · UNION SERVICES</small>
          </span>
        </a>
        <div className="header-promise">
          নাগরিক সেবা এখন
          <br />
          <strong>আরও সহজ, আরও কাছে</strong>
        </div>
        <div className="actions">
          <button className="secondary" onClick={() => nav("register")}>
            নিবন্ধন
          </button>
          <button onClick={() => nav("login")}>লগইন</button>
        </div>
      </header>
      <nav className="public-nav" aria-label="Public navigation">
        <div className="public-container">
          {Object.entries(publicPages).map(([key, label]) => (
            <button
              key={key}
              aria-current={page === key ? "page" : undefined}
              onClick={() => nav(key)}
            >
              {label[0]}
              <small>{label[1]}</small>
            </button>
          ))}
        </div>
      </nav>
      <main id="public-content">
        {page === "home" && (
          <>
            <section className="public-hero">
              <div className="public-container hero-grid">
                <div className="hero-copy">
                  <span className="eyebrow">
                    YOUR OFFICE. YOUR SERVICES. ONLINE.
                  </span>
                  <h1>
                    ঘরে বসেই নাগরিক সেবা,
                    <br />
                    <em>সহজ ও স্বচ্ছ প্রক্রিয়ায়।</em>
                  </h1>
                  <p>
                    আবেদন থেকে সনদ যাচাই — ইউনিয়ন পরিষদের ডিজিটাল সেবার প্রতিটি
                    ধাপে আপনার পাশে।
                  </p>
                  <div className="actions">
                    <button onClick={() => nav("services")}>
                      সেবার জন্য আবেদন করুন →
                    </button>
                    <button
                      className="secondary"
                      onClick={() => nav("offices")}
                    >
                      আপনার অফিস খুঁজুন
                    </button>
                  </div>
                  <div className="hero-metrics">
                    <span>
                      <strong>৪৭</strong>সেবার ধরন
                    </span>
                    <span>
                      <strong>১</strong>সমন্বিত প্ল্যাটফর্ম
                    </span>
                    <span>
                      <strong>QR</strong>সনদ যাচাই
                    </span>
                  </div>
                </div>
                <div className="hero-login">{login}</div>
              </div>
            </section>
            <section className="public-container public-section">
              {servicesView(true)}
            </section>
            <section className="process-band">
              <div className="public-container">
                <span className="eyebrow">HOW IT WORKS</span>
                <h2>চার ধাপেই সেবার আবেদন</h2>
                <div className="process-grid">
                  {[
                    [
                      "১",
                      "নিবন্ধন করুন",
                      "আপনার অফিস নির্বাচন করে ডেমো অ্যাকাউন্ট তৈরি করুন।",
                    ],
                    [
                      "২",
                      "আবেদন জমা দিন",
                      "সেবার তথ্য পূরণ করে প্রয়োজনীয় নথি সংযুক্ত করুন।",
                    ],
                    [
                      "৩",
                      "অগ্রগতি দেখুন",
                      "পর্যালোচনা, সংশোধন ও অনুমোদনের অবস্থা জানুন।",
                    ],
                    [
                      "৪",
                      "সনদ সংগ্রহ করুন",
                      "অনুমোদিত ডেমো সনদ ডাউনলোড ও QR যাচাই করুন।",
                    ],
                  ].map(([n, title, text]) => (
                    <div key={n}>
                      <b>{n}</b>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <section className="public-container public-section">
              <div className="public-section-heading">
                <div>
                  <span className="eyebrow">OFFICE UPDATES</span>
                  <h2>সর্বশেষ বিজ্ঞপ্তি</h2>
                </div>
                <button className="text-button" onClick={() => nav("notices")}>
                  সব বিজ্ঞপ্তি →
                </button>
              </div>
              {notices.length ? (
                <div className="notice-grid">
                  {notices.slice(0, 3).map((n) => (
                    <article className="panel" key={n.id}>
                      <h3>{value(n, "titleBn", "title_bn")}</h3>
                      <p>{value(n, "bodyBn", "body_bn")}</p>
                      <small>{value(n, "officeEn", "office_en")}</small>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="empty-state">
                  অফিসের প্রকাশিত বিজ্ঞপ্তি এখানে দেখানো হবে। No published
                  notices at this time.
                </p>
              )}
            </section>
          </>
        )}
        {page !== "home" && (
          <div className="public-container public-section">
            <div className="breadcrumbs">
              <button className="text-button" onClick={() => nav("home")}>
                হোম
              </button>{" "}
              /{" "}
              {publicPages[page]?.[0] ||
                (
                  {
                    login: "লগইন",
                    register: "নিবন্ধন",
                    policies: "ব্যবহারের নীতি",
                    recover: "অ্যাকাউন্ট পুনরুদ্ধার",
                  } as any
                )[page]}
            </div>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            {page === "services" && servicesView()}
            {page === "login" && (
              <div className="standalone-login">
                {login}
                <p>
                  নতুন ব্যবহারকারী?{" "}
                  <button
                    className="text-button"
                    onClick={() => nav("register")}
                  >
                    Create demo account
                  </button>
                </p>
              </div>
            )}
            {page === "recover" && <RecoveryForm />}
            {page === "tracking" && <ApplicationTracking />}
            {page === "offices" && (
              <>
                <span className="eyebrow">PARTICIPATING OFFICES</span>
                <h1>সেবার আওতাভুক্ত অফিসসমূহ</h1>
                <p>
                  Find a participating demo office. Filters stay in the address
                  and remain active when changing pages.
                </p>
                <form
                  className="panel directory-filters"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setOffice(null);
                    void loadOffices(1);
                  }}
                >
                  {Object.entries(filters).map(([key, val]) => (
                    <label key={key}>
                      {
                        (
                          {
                            q: "Office name",
                            division: "Division",
                            district: "District",
                            upazila: "Upazila",
                            type: "Office type",
                          } as any
                        )[key]
                      }
                      {key === "type" ? (
                        <select
                          aria-label="Office type"
                          value={val}
                          onChange={(e) =>
                            setFilters({ ...filters, type: e.target.value })
                          }
                        >
                          <option value="">All office types</option>
                          <option value="UNION">Union Parishad</option>
                          <option value="MUNICIPALITY">Municipality</option>
                          <option value="CITY_CORPORATION">
                            City corporation
                          </option>
                        </select>
                      ) : (
                        <input
                          value={val}
                          onChange={(e) =>
                            setFilters({ ...filters, [key]: e.target.value })
                          }
                        />
                      )}
                    </label>
                  ))}
                  <label>
                    Offices per page
                    <select
                      aria-label="Offices per page"
                      value={officePageSize}
                      onChange={(e) =>
                        setOfficePageSize(Number(e.target.value))
                      }
                    >
                      {[2, 6, 12, 24].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button disabled={working}>Search offices</button>
                </form>
                <p role="status">
                  {directory.total} matching offices · Page {directory.page}
                </p>
                <div className="office-grid">
                  {items(directory).map((o) => (
                    <article className="panel office-card" key={o.id}>
                      <CivicIcon index={1} />
                      <h2>{value(o, "nameBn", "name_bn")}</h2>
                      <h3>{value(o, "nameEn", "name_en")}</h3>
                      <p>
                        {[o.upazila, o.district, o.division]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <button
                        className="secondary"
                        onClick={async () => {
                          try {
                            setOffice(
                              await api(
                                `/offices/${encodeURIComponent(o.slug)}`,
                              ),
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        View office
                      </button>
                    </article>
                  ))}
                </div>
                <div className="pagination">
                  <button
                    className="secondary"
                    disabled={working || directory.page <= 1}
                    onClick={() => void loadOffices(directory.page - 1)}
                  >
                    Previous offices
                  </button>
                  <span>
                    {directory.page} /{" "}
                    {Math.max(
                      1,
                      Math.ceil(directory.total / directory.pageSize),
                    )}
                  </span>
                  <button
                    className="secondary"
                    disabled={
                      working ||
                      directory.page * directory.pageSize >= directory.total
                    }
                    onClick={() => void loadOffices(directory.page + 1)}
                  >
                    Next offices
                  </button>
                </div>
                {office && (
                  <section className="panel" aria-label="Office details">
                    <h2>{value(office.office, "nameBn", "name_bn")}</h2>
                    <p>{value(office.office, "nameEn", "name_en")}</p>
                    <h3>Available services</h3>
                    <div className="service-chips">
                      {items(office.services)
                        .filter((s) => s.enabled !== false)
                        .map((s) => (
                          <span key={s.serviceNo || s.service_no}>
                            {value(s, "nameBn", "name_bn") ||
                              `Service ${s.serviceNo || s.service_no}`}
                          </span>
                        ))}
                    </div>
                    <h3>Office notices</h3>
                    {(office.notices || []).map((n: any) => (
                      <article key={n.id}>
                        <h3>{value(n, "titleBn", "title_bn")}</h3>
                        <p>{value(n, "bodyBn", "body_bn")}</p>
                      </article>
                    ))}
                    <button
                      onClick={() => {
                        setRegistration({
                          ...registration,
                          tenantId: office.office.id,
                        });
                        setSignupOffices([office.office]);
                        nav("register");
                      }}
                    >
                      Register with this office
                    </button>
                  </section>
                )}
              </>
            )}
            {page === "notices" && (
              <>
                <h1>প্রকাশিত বিজ্ঞপ্তি</h1>
                <form
                  className="panel"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void loadNotices(1);
                  }}
                >
                  <label htmlFor="notice-search">Search notices</label>
                  <input
                    id="notice-search"
                    value={noticeSearch}
                    onChange={(e) => setNoticeSearch(e.target.value)}
                    placeholder="Notice title or body"
                  />
                  <button disabled={working}>Find notices</button>
                </form>
                <p role="status">
                  {noticeTotal} published notices · Page {noticePage}
                </p>
                {notices.length ? (
                  notices.map((n) => (
                    <article className="panel" key={n.id}>
                      <h2>{value(n, "titleBn", "title_bn")}</h2>
                      <h3>{value(n, "titleEn", "title_en")}</h3>
                      <p>{value(n, "bodyBn", "body_bn")}</p>
                      <p>{value(n, "bodyEn", "body_en")}</p>
                      <small>{value(n, "officeEn", "office_en")}</small>
                    </article>
                  ))
                ) : (
                  <p>No published notices.</p>
                )}
                <div className="pagination">
                  <button
                    className="secondary"
                    disabled={working || noticePage <= 1}
                    onClick={() => void loadNotices(noticePage - 1)}
                  >
                    Previous notices
                  </button>
                  <span>
                    {noticePage} / {Math.max(1, Math.ceil(noticeTotal / 6))}
                  </span>
                  <button
                    className="secondary"
                    disabled={working || noticePage * 6 >= noticeTotal}
                    onClick={() => void loadNotices(noticePage + 1)}
                  >
                    Next notices
                  </button>
                </div>
              </>
            )}
            {page === "register" && (
              <section className="panel">
                <h1>ডেমো নাগরিক নিবন্ধন</h1>
                <p className="notice">
                  Use synthetic information only. This creates a working local
                  account and citizen record; it does not verify government
                  identity. Your password must have at least 12 characters.
                </p>
                {!registered && (
                  <div className="signup-office-search">
                    <label htmlFor="signup-office-search">
                      Find registration office
                    </label>
                    <div className="inline-form">
                      <input
                        id="signup-office-search"
                        value={signupSearch}
                        onChange={(e) => setSignupSearch(e.target.value)}
                        placeholder="Office name"
                      />
                      <button
                        className="secondary"
                        disabled={working}
                        onClick={async () => {
                          setWorking(true);
                          try {
                            const result = await api(
                              `/offices?q=${encodeURIComponent(signupSearch)}&pageSize=100`,
                            );
                            setSignupOffices(items(result));
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setWorking(false);
                          }
                        }}
                      >
                        Find office
                      </button>
                    </div>
                    <p className="hint">
                      Up to 100 matching offices are shown. Search by office
                      name to narrow the list.
                    </p>
                  </div>
                )}
                {registered ? (
                  <div role="status">
                    <h2>Account created</h2>
                    <p>You can now sign in with your email and password.</p>
                    <button onClick={() => nav("login")}>Go to sign in</button>
                  </div>
                ) : (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setWorking(true);
                      setError("");
                      try {
                        await api("/auth/signup", "POST", registration);
                        setRegistered(true);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setWorking(false);
                      }
                    }}
                  >
                    <label htmlFor="signup-office">Select office</label>
                    <select
                      id="signup-office"
                      required
                      value={registration.tenantId}
                      onChange={(e) =>
                        setRegistration({
                          ...registration,
                          tenantId: e.target.value,
                        })
                      }
                    >
                      <option value="">Choose office</option>
                      {signupOffices.map((o) => (
                        <option key={o.id} value={o.id}>
                          {value(o, "nameEn", "name_en")}
                        </option>
                      ))}
                    </select>
                    <div className="form-grid">
                      {Object.entries(registration)
                        .filter(([k]) => k !== "tenantId")
                        .map(([key, val]) => (
                          <label key={key} htmlFor={`signup-${key}`}>
                            {
                              (
                                {
                                  email: "Email address",
                                  password: "Choose password",
                                  displayName: "Display name",
                                  nameBn: "Synthetic name (Bangla)",
                                  nameEn: "Synthetic name (English)",
                                  dateOfBirth: "Date of birth",
                                  addressBn: "Synthetic address (Bangla)",
                                  addressEn: "Synthetic address (English)",
                                  syntheticReference: "Unique demo reference",
                                } as any
                              )[key]
                            }
                            <input
                              id={`signup-${key}`}
                              required
                              type={
                                key === "password"
                                  ? "password"
                                  : key === "email"
                                    ? "email"
                                    : key === "dateOfBirth"
                                      ? "date"
                                      : "text"
                              }
                              minLength={key === "password" ? 12 : undefined}
                              autoComplete={
                                key === "password" ? "new-password" : "off"
                              }
                              value={val}
                              onChange={(e) =>
                                setRegistration({
                                  ...registration,
                                  [key]: e.target.value,
                                })
                              }
                            />
                          </label>
                        ))}
                    </div>
                    <button disabled={working}>Create synthetic account</button>
                  </form>
                )}
              </section>
            )}
            {page === "verify" && (
              <section className="panel narrow">
                <h1>সনদ যাচাই করুন</h1>
                <p>
                  Enter the complete QR verification link or verification token
                  from an Astra demo certificate.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = token.trim();
                    let parsed = input;
                    try {
                      if (input.includes("://"))
                        parsed =
                          new URL(input).pathname.split("/verify/")[1] || "";
                    } catch {
                      parsed = "";
                    }
                    if (!/^[A-Za-z0-9_-]{20,200}$/.test(parsed)) {
                      setError(
                        "Enter a valid Astra verification token or link.",
                      );
                      return;
                    }
                    location.assign(`/verify/${encodeURIComponent(parsed)}`);
                  }}
                >
                  <label htmlFor="verification-token">
                    Verification token or link
                  </label>
                  <input
                    id="verification-token"
                    required
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                  <button>Verify certificate</button>
                </form>
                <p className="hint">
                  Public results reveal only office, service, issue date and
                  status.
                </p>
              </section>
            )}
            {page === "help" && (
              <>
                <section className="panel prose">
                  <h1>সেবার সহায়িকা</h1>
                  <label htmlFor="faq-search">Search help</label>
                  <input
                    id="faq-search"
                    value={faqSearch}
                    onChange={(e) => setFaqSearch(e.target.value)}
                    placeholder="Application, password, payment…"
                  />
                  {[
                    [
                      "কীভাবে আবেদন করব? / How do I apply?",
                      "Register with a participating office, sign in, choose a service and citizen, complete its form, then save and submit. Your Applications page shows the current state.",
                    ],
                    [
                      "সংশোধনের অনুরোধ এলে? / What if changes are requested?",
                      "Open the application, read the review reason, edit the requested fields, save changes and resubmit. Earlier submitted versions remain in the audit history.",
                    ],
                    [
                      "সনদ কীভাবে পাব? / How do I get my certificate?",
                      "After authorized approval and issuance, open the application and use Download PDF. The QR verification link shows current issued or revoked status.",
                    ],
                    [
                      "পেমেন্ট কি বাস্তব? / Are payments live?",
                      "No. The current installation uses a local billing sandbox with engineering fixture prices. No real money is collected and statutory government fees are not configured.",
                    ],
                    [
                      "পরিচয় যাচাই হয় কি? / Is identity verified?",
                      "Accounts and records are synthetic demo data. Government NID/BRN, OTP and official identity verification are not connected.",
                    ],
                    [
                      "সমস্যা হলে? / What if I need help?",
                      "Contact your participating office through your existing trusted contact channel. This demo has no live call centre, email or SMS delivery provider.",
                    ],
                  ]
                    .filter(([q, a]) =>
                      `${q} ${a}`
                        .toLowerCase()
                        .includes(faqSearch.toLowerCase()),
                    )
                    .map(([q, a]) => (
                      <details key={q}>
                        <summary>{q}</summary>
                        <p>{a}</p>
                      </details>
                    ))}
                </section>
                <section className="panel prose">
                  <h2>মতামত ও সহায়তা / Feedback</h2>
                  <p>
                    Submit a message to the local platform support inbox. No
                    email or external message is sent.
                  </p>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget,
                        d = new FormData(form);
                      setWorking(true);
                      setSupportMessage("");
                      try {
                        await api("/public/feedback", "POST", {
                          name: d.get("name"),
                          ...(d.get("email") ? { email: d.get("email") } : {}),
                          subject: d.get("subject"),
                          message: d.get("message"),
                        });
                        form.reset();
                        setSupportMessage(
                          "Feedback saved to the support inbox.",
                        );
                      } catch (e) {
                        setSupportMessage((e as Error).message);
                      } finally {
                        setWorking(false);
                      }
                    }}
                  >
                    <div className="form-grid">
                      <label>
                        Your name
                        <input name="name" required minLength={2} />
                      </label>
                      <label>
                        Email (optional)
                        <input name="email" type="email" />
                      </label>
                    </div>
                    <label>
                      Subject
                      <input name="subject" required minLength={3} />
                    </label>
                    <label>
                      Message
                      <textarea name="message" required minLength={10} />
                    </label>
                    <button disabled={working}>Submit feedback</button>
                  </form>
                  {supportMessage && (
                    <p className="notice" role="status">
                      {supportMessage}
                    </p>
                  )}
                </section>
              </>
            )}
            {page === "policies" && (
              <section className="panel prose">
                <h1>ব্যবহারের নীতি / Demo policies</h1>
                <h2>Independent demonstration</h2>
                <p>
                  Astra is independently authored software. It is not the
                  reference operator or a government authority. All generated
                  documents are visibly marked DEMO / NOT OFFICIAL.
                </p>
                <h2>Data and privacy</h2>
                <p>
                  Use synthetic identities and sample attachments. Application
                  data, private files, document bytes and workflow history are
                  stored in PostgreSQL. Tenant roles control access. Public QR
                  verification excludes names, identity references and
                  application contents. Operational logs and immutable audit
                  entries may persist; do not enter sensitive personal
                  information into this demonstration.
                </p>
                <h2>Commercial and official use</h2>
                <p>
                  Subscription and prepaid credits are software accounting
                  demonstrations. Live pricing, payment providers, statutory
                  fees, retention periods, legal privacy terms and official
                  signatory authority require approved configuration and
                  policies before deployment with real citizen data.
                </p>
                <h2>Security and access</h2>
                <p>
                  Keep account credentials private, use a unique password and
                  sign out on shared devices. You may change your password from
                  Account security; doing so expires your other sessions.
                </p>
              </section>
            )}
            {!Object.keys(publicPages)
              .concat(["login", "register", "policies", "recover"])
              .includes(page) && (
              <section className="panel">
                <h1>Page not found</h1>
                <button onClick={() => nav("home")}>Return home</button>
              </section>
            )}
          </div>
        )}
      </main>
      <footer className="public-footer">
        <div className="public-container footer-grid">
          <div>
            <a className="public-brand" href="/">
              <span className="brand-symbol">A</span>
              <span>
                <strong>অ্যাস্ট্রা</strong>
                <small>ASTRA · UNION SERVICES</small>
              </span>
            </a>
            <p>নাগরিক সেবা, একটি নির্ভরযোগ্য পথে।</p>
            <p>Independent software · Synthetic demo only</p>
          </div>
          <div>
            <h3>সেবার তথ্য</h3>
            <button onClick={() => nav("services")}>Service catalog</button>
            <button onClick={() => nav("offices")}>
              Participating offices
            </button>
            <button onClick={() => nav("verify")}>
              Certificate verification
            </button>
          </div>
          <div>
            <h3>সহায়তা ও নীতি</h3>
            <button onClick={() => nav("help")}>
              Help & frequently asked questions
            </button>
            <button onClick={() => nav("policies")}>
              Privacy & demo use policies
            </button>
            <button onClick={() => nav("login")}>Office workspace</button>
          </div>
        </div>
        <div className="public-container newsletter">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                d = new FormData(form);
              setWorking(true);
              setSupportMessage("");
              try {
                await api("/public/subscribe", "POST", {
                  email: d.get("email"),
                });
                form.reset();
                setSupportMessage(
                  "Subscription preference saved locally. Email delivery is not connected.",
                );
              } catch (e) {
                setSupportMessage((e as Error).message);
              } finally {
                setWorking(false);
              }
            }}
          >
            <label htmlFor="newsletter-email">
              সেবার আপডেটের জন্য নিবন্ধন / Update preferences
            </label>
            <div className="inline-form">
              <input
                id="newsletter-email"
                name="email"
                type="email"
                placeholder="you@example.test"
                required
              />
              <button disabled={working}>Save subscription</button>
            </div>
            <small>
              Preference saved locally; outgoing email is not connected.
            </small>
          </form>
          {supportMessage && page !== "help" && (
            <p role="status">{supportMessage}</p>
          )}
        </div>
        <div className="public-container footer-bottom">
          © {new Date().getFullYear()} Astra · All certificate output is DEMO /
          NOT OFFICIAL.
        </div>
      </footer>
    </div>
  );
}
