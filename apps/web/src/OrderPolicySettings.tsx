import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.js";
import { choose, useLanguage } from "./i18n.js";

type DeliveryMode = "office_collection" | "digital_copy";
type Urgency = "normal" | "urgent";
type Policy = {
  version: number;
  statutoryFeeMinor: number;
  processingFeeMinor: number;
  emergencySurchargeMinor: number;
  deliveryFeesMinor: Record<DeliveryMode, number>;
  deliveryModes: DeliveryMode[];
  urgencies: Urgency[];
  currency: "BDT";
};
type Options = { configured: boolean; policy: Policy | null };
type AmountKey = "statutory" | "processing" | "emergency" | DeliveryMode;
type Amounts = Record<AmountKey, string>;
type Message = { bn: string; en: string };
const blankAmounts = (): Amounts => ({
  statutory: "",
  processing: "",
  emergency: "",
  office_collection: "",
  digital_copy: "",
});
const MAX_FEE_MINOR = 100_000_000;

/** Parse taka as decimal text, without binary floating-point multiplication or rounding. */
export function parseTakaToMinor(input: string): number {
  const normalized = input
    .trim()
    .replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)));
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    throw new RangeError("AMOUNT_FORMAT");
  const [whole, fraction = ""] = normalized.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor > BigInt(MAX_FEE_MINOR)) throw new RangeError("AMOUNT_RANGE");
  return Number(minor);
}
export function formatMinorAsTaka(minor: number): string {
  return `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
const fields: Array<{ key: AmountKey; label: Message }> = [
  {
    key: "statutory",
    label: { bn: "সরকারি নির্ধারিত ফি (টাকা)", en: "Statutory fee (BDT)" },
  },
  {
    key: "processing",
    label: { bn: "প্রসেসিং ফি (টাকা)", en: "Processing fee (BDT)" },
  },
  {
    key: "emergency",
    label: {
      bn: "জরুরি আবেদনের অতিরিক্ত ফি (টাকা)",
      en: "Urgent application surcharge (BDT)",
    },
  },
  {
    key: "office_collection",
    label: {
      bn: "অফিস থেকে সংগ্রহের ফি (টাকা)",
      en: "Office collection fee (BDT)",
    },
  },
  {
    key: "digital_copy",
    label: { bn: "ডিজিটাল কপির ফি (টাকা)", en: "Digital copy fee (BDT)" },
  },
];
function apiErrorMessage(error: unknown): Message {
  if (error instanceof ApiError && error.status === 409)
    return {
      bn: "অন্য প্রশাসক নতুন নীতি প্রকাশ করেছেন। সর্বশেষ নীতি লোড করে পরিবর্তন যাচাই করুন, তারপর আবার প্রকাশ করুন।",
      en: "Another administrator published a newer policy. Reload the latest policy, review your changes, then publish again.",
    };
  if (error instanceof ApiError && error.status === 403)
    return {
      bn: "এই অফিসের ফি নীতি পরিবর্তনের অনুমতি নেই। অনুমোদিত অফিস প্রশাসক দিয়ে প্রবেশ করুন।",
      en: "You cannot change this office's fee policy. Sign in as an authorized office administrator.",
    };
  return {
    bn: "ফি নীতি সংরক্ষণ বা লোড করা যায়নি। সংযোগ ও দেওয়া তথ্য যাচাই করে আবার চেষ্টা করুন।",
    en: "The fee policy could not be loaded or saved. Check your connection and entered values, then try again.",
  };
}

export function OrderPolicySettings({ services }: { services: any[] }) {
  useLanguage();
  const [serviceNo, setServiceNo] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [amounts, setAmounts] = useState<Amounts>(blankAmounts);
  const [deliveryModes, setDeliveryModes] = useState<DeliveryMode[]>([]);
  const [urgencies, setUrgencies] = useState<Urgency[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<Message | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const epoch = useRef(0);

  function hydrate(next: Policy | null) {
    setPolicy(next);
    setAmounts(
      next
        ? {
            statutory: formatMinorAsTaka(next.statutoryFeeMinor),
            processing: formatMinorAsTaka(next.processingFeeMinor),
            emergency: formatMinorAsTaka(next.emergencySurchargeMinor),
            office_collection: formatMinorAsTaka(
              next.deliveryFeesMinor.office_collection,
            ),
            digital_copy: formatMinorAsTaka(
              next.deliveryFeesMinor.digital_copy,
            ),
          }
        : blankAmounts(),
    );
    setDeliveryModes(next ? [...next.deliveryModes] : []);
    setUrgencies(next ? [...next.urgencies] : []);
    setReason("");
  }
  useEffect(() => {
    const current = ++epoch.current;
    let disposed = false;
    hydrate(null);
    setLoaded(false);
    setError(null);
    setMessage(null);
    setLoading(!!serviceNo);
    if (serviceNo) {
      api<Options>(`/services/${serviceNo}/order-options`)
        .then((result) => {
          if (disposed || epoch.current !== current) return;
          hydrate(result.policy);
          setLoaded(true);
        })
        .catch((failure) => {
          if (!disposed && epoch.current === current)
            setError(apiErrorMessage(failure));
        })
        .finally(() => {
          if (!disposed && epoch.current === current) setLoading(false);
        });
    }
    return () => {
      disposed = true;
      epoch.current++;
    };
  }, [serviceNo, revision]);

  async function publish() {
    setError(null);
    setMessage(null);
    if (!loaded || !serviceNo || loading || saving) return;
    let minor: Record<AmountKey, number>;
    try {
      minor = Object.fromEntries(
        fields.map(({ key }) => [key, parseTakaToMinor(amounts[key])]),
      ) as Record<AmountKey, number>;
    } catch {
      setError({
        bn: "প্রতিটি ফি স্পষ্টভাবে লিখুন: ০ থেকে ১০,০০,০০০ টাকা, সর্বোচ্চ দুই দশমিক ঘর। খালি ঘর শূন্য হিসেবে ধরা হয় না।",
        en: "Enter every fee explicitly: 0 to 1,000,000 BDT, with at most two decimal places. Empty fields are not treated as zero.",
      });
      return;
    }
    if (!deliveryModes.length || !urgencies.length) {
      setError({
        bn: "অন্তত একটি বিতরণ পদ্ধতি ও একটি আবেদনের ধরন নির্বাচন করুন।",
        en: "Select at least one delivery method and one urgency option.",
      });
      return;
    }
    if (reason.trim().length < 3 || reason.trim().length > 500) {
      setError({
        bn: "প্রকাশের কারণ ৩ থেকে ৫০০ অক্ষরে লিখুন।",
        en: "Enter a publication reason between 3 and 500 characters.",
      });
      return;
    }
    const current = epoch.current;
    setSaving(true);
    try {
      const result = await api<Options>(
        `/admin/services/${serviceNo}/order-policies`,
        "POST",
        {
          expectedVersion: policy?.version ?? 0,
          reason: reason.trim(),
          statutoryFeeMinor: minor.statutory,
          processingFeeMinor: minor.processing,
          emergencySurchargeMinor: minor.emergency,
          deliveryFeesMinor: {
            office_collection: minor.office_collection,
            digital_copy: minor.digital_copy,
          },
          deliveryModes,
          urgencies,
        },
      );
      if (epoch.current !== current) return;
      hydrate(result.policy);
      setMessage({
        bn: "নতুন ফি নীতি প্রকাশিত হয়েছে। আগের আবেদনে সংরক্ষিত ফি অপরিবর্তিত থাকবে।",
        en: "The new fee policy is published. Fee snapshots on earlier applications remain unchanged.",
      });
    } catch (failure) {
      if (epoch.current !== current) return;
      setError(apiErrorMessage(failure));
      if (failure instanceof ApiError && failure.status === 409)
        setLoaded(false);
    } finally {
      if (epoch.current === current) setSaving(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="order-policy-heading">
      <h2 id="order-policy-heading">
        {choose({
          bn: "ইউনিয়নভিত্তিক আবেদন ফি নীতি",
          en: "Office application fee policies",
        })}
      </h2>
      <p>
        {choose({
          bn: "এই অফিসের প্রতিটি সেবায় সরকারি নির্ধারিত ফি ও প্রসেসিং ফি আলাদাভাবে নির্ধারণ করুন। এগুলো সফটওয়্যার ক্রেডিটের খরচ থেকে আলাদা। নতুন সংস্করণ প্রকাশ করলে পুরোনো আবেদন পরিবর্তিত হয় না।",
          en: "Configure separate statutory and processing fees for each service in this office. These are separate from software credits. Publishing a new version does not change earlier applications.",
        })}
      </p>
      <p className="notice">
        {choose({
          bn: "এটি ফি নির্ধারণ ও হিসাবের ব্যবস্থা। অনলাইন অর্থ সংগ্রহ এখনো যুক্ত হয়নি; প্রদেয় ফি শূন্যের বেশি হলে পেমেন্ট সংযোগ চালু না হওয়া পর্যন্ত সনদ প্রদান বন্ধ থাকবে। অনুমোদিত কর্মকর্তা কর্তৃক আলাদা অনুমোদন আবশ্যক।",
          en: "This configures fee quotations. Online collection is not connected; applications with a positive total cannot be issued until verified payment integration is available. Separate approval by an authorized official is required.",
        })}
      </p>
      <label htmlFor="order-policy-service">
        {choose({ bn: "ফি নীতির সেবা", en: "Fee policy service" })}
      </label>
      <select
        id="order-policy-service"
        value={serviceNo}
        disabled={saving}
        onChange={(event) => setServiceNo(event.target.value)}
      >
        <option value="">
          {choose({ bn: "সেবা নির্বাচন করুন", en: "Choose a service" })}
        </option>
        {services.map((service) => {
          const no = service.serviceNo || service.service_no;
          return (
            <option key={no} value={no}>
              #{no}{" "}
              {choose({
                bn: service.nameBn || service.name_bn,
                en: service.nameEn || service.name_en,
              })}
            </option>
          );
        })}
      </select>
      {loading && (
        <p role="status">
          {choose({ bn: "ফি নীতি লোড হচ্ছে…", en: "Loading fee policy…" })}
        </p>
      )}
      {error && (
        <p className="notice" role="alert">
          {choose(error)}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {choose(message)}
        </p>
      )}
      {serviceNo && !loading && (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={saving}
            onClick={() => setRevision((value) => value + 1)}
          >
            {choose({
              bn: "সর্বশেষ নীতি লোড করুন",
              en: "Reload latest policy",
            })}
          </button>
          <span>
            {loaded &&
              (policy
                ? choose({
                    bn: `বর্তমান সংস্করণ: ${policy.version}`,
                    en: `Current version: ${policy.version}`,
                  })
                : choose({
                    bn: "এখনো কোনো ফি নীতি নেই",
                    en: "No fee policy configured",
                  }))}
          </span>
        </div>
      )}
      {loaded && !loading && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void publish();
          }}
          aria-busy={saving}
        >
          <fieldset disabled={saving}>
            <legend>
              {choose({ bn: "নির্ধারিত ফি", en: "Configured fees" })}
            </legend>
            <p className="hint">
              {choose({
                bn: "কোনো অনুমানভিত্তিক ফি বসানো হয় না। প্রতিটি ঘরে টাকা লিখুন; ফি না থাকলে স্পষ্টভাবে ০ দিন। সর্বোচ্চ দুই দশমিক ঘর, যেমন ২৫০.৫০।",
                en: "No rates are assumed. Enter each amount in BDT, explicitly entering 0 where no fee applies. Use at most two decimal places, for example 250.50.",
              })}
            </p>
            <div className="form-grid">
              {fields.map(({ key, label }) => (
                <div className="field" key={key}>
                  <label htmlFor={`order-fee-${key}`}>{choose(label)}</label>
                  <input
                    id={`order-fee-${key}`}
                    inputMode="decimal"
                    type="text"
                    value={amounts[key]}
                    required
                    maxLength={16}
                    autoComplete="off"
                    onChange={(event) =>
                      setAmounts((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={saving}>
            <legend>
              {choose({
                bn: "অনুমোদিত বিতরণ পদ্ধতি",
                en: "Allowed delivery methods",
              })}
            </legend>
            <p className="hint">
              {choose({
                bn: "শুধু নির্বাচিত পদ্ধতিগুলো আবেদনকারীকে দেখানো হবে।",
                en: "Only selected methods are offered to applicants.",
              })}
            </p>
            {(["office_collection", "digital_copy"] as DeliveryMode[]).map(
              (mode) => (
                <label
                  className="check-field"
                  key={mode}
                  htmlFor={`order-mode-${mode}`}
                >
                  <input
                    id={`order-mode-${mode}`}
                    type="checkbox"
                    checked={deliveryModes.includes(mode)}
                    onChange={(event) =>
                      setDeliveryModes((current) =>
                        event.target.checked
                          ? [...current, mode]
                          : current.filter((value) => value !== mode),
                      )
                    }
                  />
                  {mode === "office_collection"
                    ? choose({
                        bn: "অফিস থেকে সংগ্রহ",
                        en: "Office collection",
                      })
                    : choose({ bn: "ডিজিটাল কপি", en: "Digital copy" })}
                </label>
              ),
            )}
          </fieldset>
          <fieldset disabled={saving}>
            <legend>
              {choose({
                bn: "অনুমোদিত আবেদনের ধরন",
                en: "Allowed urgency options",
              })}
            </legend>
            {(["normal", "urgent"] as Urgency[]).map((urgency) => (
              <label
                className="check-field"
                key={urgency}
                htmlFor={`order-urgency-${urgency}`}
              >
                <input
                  id={`order-urgency-${urgency}`}
                  type="checkbox"
                  checked={urgencies.includes(urgency)}
                  onChange={(event) =>
                    setUrgencies((current) =>
                      event.target.checked
                        ? [...current, urgency]
                        : current.filter((value) => value !== urgency),
                    )
                  }
                />
                {urgency === "normal"
                  ? choose({ bn: "সাধারণ", en: "Normal" })
                  : choose({ bn: "জরুরি", en: "Urgent" })}
              </label>
            ))}
          </fieldset>
          <label htmlFor="order-policy-reason">
            {choose({
              bn: "নতুন সংস্করণ প্রকাশের কারণ",
              en: "Reason for publishing this version",
            })}
          </label>
          <textarea
            id="order-policy-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            minLength={3}
            maxLength={500}
            disabled={saving}
          />
          <button type="submit" disabled={saving}>
            {saving
              ? choose({ bn: "প্রকাশ হচ্ছে…", en: "Publishing…" })
              : choose({
                  bn: "নতুন ফি নীতি প্রকাশ করুন",
                  en: "Publish fee policy version",
                })}
          </button>
        </form>
      )}
    </section>
  );
}
