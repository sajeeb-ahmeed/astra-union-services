import React from "react";
import { choose, useLanguage } from "./i18n.js";

type Text = { bn: string; en: string };
type Section = { id: string; title: Text; who: Text; steps: Text[] };

/**
 * The DigitalUnion user guide, by role, written for DigitalUnion's own screens. Printing the page (or "Save as PDF" in the
 * print dialog) gives the guide as a document.
 */
const sections: Section[] = [
  {
    id: "citizen",
    title: { bn: "নাগরিক", en: "Citizens" },
    who: { bn: "নিজের জন্য সেবার আবেদন করবেন যাঁরা", en: "People applying for services for themselves" },
    steps: [
      { bn: "‘অফিস খুঁজুন’ থেকে নিজের অফিস বেছে ‘এই অফিসে নিবন্ধন করুন’ চাপুন। নাম, জন্ম তারিখ ও স্থায়ী ঠিকানা দিন; মোবাইল দিলে এককালীন কোড দিয়ে যাচাই করুন।", en: "Find your office in the Office directory and choose ‘Register with this office’. Enter your name, date of birth and permanent address; if you add a mobile number, confirm it with the one-time code." },
      { bn: "লগইনের পরে ‘আমার প্রোফাইল’-এ এনআইডি বা জন্ম নিবন্ধন নম্বর, মোবাইল বা ‘মোবাইল নেই’ ঘোষণা যোগ করে প্রোফাইল সম্পূর্ণ করুন।", en: "After signing in, complete your profile under ‘My profile’: add an NID or birth registration number, and a mobile number or the ‘no mobile’ declaration." },
      { bn: "সেবা বেছে ফর্ম পূরণ করুন, নথি যুক্ত করুন। নথি নিরাপত্তা পরীক্ষা শেষ হওয়া পর্যন্ত ‘পরীক্ষার অপেক্ষায়’ থাকে।", en: "Choose a service, fill in the form and attach documents. A document shows ‘waiting for safety check’ until its scan finishes." },
      { bn: "‘ফি দেখুন’ চাপলে ফি-র পুরো হিসাব দেখাবে; অফিসের কুপন থাকলে কোড লিখুন। তারপর আবেদন জমা দিন।", en: "‘Review fees’ shows the full fee breakdown; enter a coupon code if your office gave you one. Then submit the application." },
      { bn: "‘আবেদনসমূহ’ পাতায় অবস্থা দেখুন। সংশোধন চাইলে কারণ দেখে ঠিক করে আবার জমা দিন। চেয়ারম্যান ডাকলে কখন ও কোথায় যেতে হবে তা আবেদনে লেখা থাকবে।", en: "Follow progress under ‘Applications’. If a correction is requested, read the reason, fix it and resubmit. If the Chairman asks you to come, the application says when and where." },
      { bn: "অনুমোদনের পরে অনলাইনে ফি দিন (bKash বা কার্ড/মোবাইল ব্যাংকিং)। সনদ ইস্যুর আগে প্রয়োজনে ফি ফেরতের অনুরোধ করা যায়।", en: "After approval, pay the fee online (bKash, or card and mobile wallet). Before the certificate is issued you can ask for a refund if needed." },
      { bn: "সনদ ইস্যু হলে পিডিএফ ডাউনলোড করুন। QR কোড দিয়ে যে কেউ সনদ যাচাই করতে পারে।", en: "Once issued, download the certificate PDF. Anyone can check it with its QR code." },
    ],
  },
  {
    id: "staff",
    title: { bn: "অফিস কর্মী / উদ্যোক্তা", en: "Office staff and entrepreneurs" },
    who: { bn: "নাগরিকের পক্ষে আবেদন নেন যাঁরা", en: "People who take applications on behalf of citizens" },
    steps: [
      { bn: "‘নাগরিক’ পাতায় নাগরিক খুঁজুন বা নতুন নিবন্ধন করুন। ‘বিস্তারিত’ খুলে ব্যক্তিগত তথ্য, এনআইডি/জন্ম নিবন্ধন ও পরিচয়পত্রের ছবি যোগ করুন।", en: "Find or register the citizen on the Citizens page. Open ‘Details’ to add personal details, the NID/birth registration number and the ID image." },
      { bn: "পূর্ণ এনআইডি নম্বর দরকার হলে ‘পূর্ণ নম্বর দেখুন’ চাপুন; প্রতিবার দেখা অডিট লগে থাকে।", en: "Use ‘Show full numbers’ only when needed; every view is recorded in the audit log." },
      { bn: "নাগরিক বেছে সেবার আবেদন তৈরি করে জমা দিন। আবেদন তালিকায় তারিখ, নবায়ন, অবস্থা বা নাম/মোবাইল দিয়ে খুঁজুন।", en: "Choose the citizen, create the service application and submit it. Filter the application list by date, renewals, status, name or mobile." },
      { bn: "জীবনবৃত্তান্ত, হোল্ডিং ও সাক্ষীর বক্তব্যের কপি ‘প্রিন্ট’ পাতা থেকে তৈরি করুন এবং নাম বা তারিখ দিয়ে আগের কপি খুঁজুন।", en: "Make biodata, holding and witness copies on the Prints page, and find earlier copies by name or date." },
    ],
  },
  {
    id: "secretary",
    title: { bn: "সচিব", en: "Secretary" },
    who: { bn: "অফিসের নথি ও আবেদন দেখভাল করেন যাঁরা", en: "People who look after office records and applications" },
    steps: [
      { bn: "জমা পড়া আবেদন ও নাগরিকের তথ্য দেখুন; কোনো তথ্য বাকি থাকলে নাগরিক বা কর্মীকে জানান।", en: "View submitted applications and citizen records; tell the citizen or staff member if anything is missing." },
      { bn: "আবেদন যাচাই ও সিদ্ধান্ত চেয়ারম্যানের কাজ — সচিব অনুমোদন বা প্রত্যাখ্যান করেন না।", en: "Verifying applications and deciding them is the Chairman's work — the Secretary does not approve or reject." },
    ],
  },
  {
    id: "chairman",
    title: { bn: "চেয়ারম্যান (অনুমোদনকারী)", en: "Chairman (approver)" },
    who: { bn: "যাচাই, অনুমোদন ও সনদ ইস্যু করেন যাঁরা", en: "People who verify, approve and issue certificates" },
    steps: [
      { bn: "জমা পড়া আবেদন খুলে তথ্য ও নথি নিজে যাচাই করুন। প্রোফাইল অসম্পূর্ণ হলে সতর্কবার্তা দেখাবে; অফিস বাধ্যতামূলক করলে সম্পূর্ণ না হওয়া পর্যন্ত সনদ ইস্যু হবে না।", en: "Open a submitted application and verify its details and documents yourself. An incomplete profile shows a warning; if the office requires complete profiles, the certificate cannot be issued until it is complete." },
      { bn: "প্রয়োজনে কখন ও কোথায় আসতে হবে লিখে ‘আবেদনকারীকে আসতে বলুন’ চাপুন, বা কারণ লিখে সংশোধন চান।", en: "If needed, write when and where to come and choose ‘Ask the applicant to come’, or request a correction with a reason." },
      { bn: "‘অনুমোদন করে সনদ ইস্যু করুন’ দিলেই অনুমোদনের সঙ্গে সঙ্গে সনদ ইস্যু হয়ে যাবে; ভুল আবেদন কারণসহ প্রত্যাখ্যান করুন। প্রিন্ট করা সনদে নিজ হাতে স্বাক্ষর করুন।", en: "Choose ‘Approve and issue certificate’ to approve and issue in one step; reject an invalid application with a reason. Sign the printed certificate by hand." },
    ],
  },
  {
    id: "admin",
    title: { bn: "অফিস অ্যাডমিন ও হিসাব", en: "Office admin and finance" },
    who: { bn: "অফিসের সেটিংস ও টাকার হিসাব দেখেন যাঁরা", en: "People who run the office's settings and money" },
    steps: [
      { bn: "‘অফিস ব্যবস্থাপনা’-তে কর্মীর অ্যাকাউন্ট, সেবা চালু/বন্ধ, অনুমোদনের দায়িত্ব ও নোটিশ পরিচালনা করুন।", en: "Use Office administration for staff accounts, services on/off, approval authority and notices." },
      { bn: "‘আবেদন ফি নীতি’-তে প্রতিটি সেবার ফি ও সেবা প্রদানের সময় প্রকাশ করুন; এগুলো অফিসের পাবলিক মূল্য তালিকায় দেখায়। ‘কুপন’ ট্যাবে ছাড়ের কোড তৈরি করুন।", en: "Publish each service's fees and service time under Application fee policies; they appear on the office's public price list. Create discount codes on the Coupons tab." },
      { bn: "‘অনলাইন পেমেন্ট’ ট্যাবে অফিসের নিজস্ব SSLCommerz স্টোর ও bKash মার্চেন্টের তথ্য দিন। গোপন তথ্য একবার দিলে আর দেখানো হয় না।", en: "Enter the office's own SSLCommerz store and bKash merchant on the Online payments tab. Secret values are never shown again after saving." },
      { bn: "‘সাবস্ক্রিপশন ও ক্রেডিট’ পাতায় পয়েন্ট ব্যালান্স দেখুন, ব্যাংকে জমার রসিদ দিয়ে রিচার্জের অনুরোধ করুন এবং নাগরিকের ফি ফেরতের অনুরোধ অনুমোদন বা বাতিল করুন।", en: "On Subscription & credits, see the points balance, request a recharge with the bank deposit slip, and approve or reject citizens' refund requests." },
      { bn: "‘অফিস প্রোফাইল’-এ সম্পূর্ণ প্রোফাইল ছাড়া সনদ ইস্যু বন্ধ রাখার সুইচ আছে।", en: "Office profile has the switch that requires complete citizen profiles before issuing." },
    ],
  },
  {
    id: "owner",
    title: { bn: "প্ল্যাটফর্ম মালিক", en: "Platform owner" },
    who: { bn: "পুরো DigitalUnion পরিচালনা করেন যিনি", en: "The person who runs DigitalUnion as a whole" },
    steps: [
      { bn: "‘প্ল্যাটফর্ম ব্যবস্থাপনা’ থেকে নতুন অফিস যুক্ত করুন, অফিসের অ্যাকাউন্ট অনুরোধ ও ‘অফিস যুক্ত করার অনুরোধ’ যাচাই করুন।", en: "In Platform management, add offices and review office account requests and office inclusion requests." },
      { bn: "সনদ প্রতি পয়েন্টের মূল্য নির্ধারণ করুন, জমার ব্যাংক হিসাব যোগ করুন, রিচার্জের রসিদ দেখে নিশ্চিত বা বাতিল করুন এবং প্রয়োজনে পয়েন্ট সমন্বয় করুন।", en: "Set the points price per certificate, add the deposit bank accounts, confirm or reject recharges after viewing the slip, and adjust points when needed." },
      { bn: "সাক্ষীর প্রত্যয়নের জন্য ধর্ম ও সনদের ধরনের তালিকা রাখুন; পাবলিক পাতায় শুধু এগুলোই দেখায়।", en: "Keep the list of religions and certificate types for witness statements; the public page offers only these." },
    ],
  },
];

export function UserGuide() {
  useLanguage();
  // Anchor links (the section index above) open their accordion panel.
  React.useEffect(() => {
    const openFromHash = () => {
      const id = location.hash.replace("#", "");
      if (!id.startsWith("guide-")) return;
      const target = document.getElementById(id);
      if (target instanceof HTMLDetailsElement) target.open = true;
    };
    openFromHash();
    addEventListener("hashchange", openFromHash);
    return () => removeEventListener("hashchange", openFromHash);
  }, []);
  return (
    <article className="panel prose user-guide">
      <h1>{choose({ bn: "DigitalUnion ব্যবহারের নির্দেশিকা", en: "DigitalUnion user guide" })}</h1>
      <p>
        {choose({
          bn: "নিজের ভূমিকা অনুযায়ী অংশটি পড়ুন। নির্দেশিকা পিডিএফ হিসেবে রাখতে নিচের বোতাম চাপুন এবং প্রিন্টে ‘Save as PDF’ বেছে নিন।",
          en: "Read the part for your role. To keep the guide as a PDF, use the button below and choose ‘Save as PDF’ when printing.",
        })}
      </p>
      <p className="no-print">
        <button type="button" className="secondary" onClick={() => window.print()}>
          {choose({ bn: "প্রিন্ট বা পিডিএফ", en: "Print or save as PDF" })}
        </button>
      </p>
      <nav aria-label={choose({ bn: "নির্দেশিকার অংশ", en: "Guide sections" })} className="no-print">
        <ul>
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#guide-${s.id}`}>{choose(s.title)}</a>
            </li>
          ))}
        </ul>
      </nav>
      {/* FULL-UIUX-01 (A12): the guide renders as the designed themed
          accordion — one role open at a time, same details/summary pattern
          as the public FAQ — instead of one long undifferentiated stack. */}
      <div className="guide-accordion">
        {sections.map((s, index) => (
          <details key={s.id} id={`guide-${s.id}`} className="guide-section" open={index === 0}>
            <summary>
              <span className="guide-section-title">{choose(s.title)}</span>
              <span className="guide-section-who">{choose(s.who)}</span>
            </summary>
            <ol>
              {s.steps.map((step, i) => (
                <li key={i}>{choose(step)}</li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </article>
  );
}
