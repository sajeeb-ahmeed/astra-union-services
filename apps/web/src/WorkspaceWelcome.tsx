import { choose, useLanguage } from "./i18n.js";

type Task = {
  title: { bn: string; en: string };
  hint: { bn: string; en: string };
  page: string;
  state?: string;
};
export function WorkspaceWelcome({
  role,
  navigate,
}: {
  role: string;
  navigate: (page: string, state?: string) => void;
}) {
  useLanguage();
  const tasks: Task[] =
    role === "owner"
      ? [
          {
            title: { bn: "অফিস পরিচালনা", en: "Manage offices" },
            hint: {
              bn: "অফিস ও ব্যবহারকারীর প্রবেশাধিকার দেখুন।",
              en: "Manage offices and access.",
            },
            page: "owner",
          },
          {
            title: { bn: "সেবা দেখুন", en: "Explore services" },
            hint: {
              bn: "৪৭টি সেবার ফর্ম ও বিবরণ দেখুন।",
              en: "Browse forms and details for 47 services.",
            },
            page: "services",
          },
          {
            title: { bn: "অ্যাকাউন্ট সুরক্ষা", en: "Protect your account" },
            hint: {
              bn: "পাসওয়ার্ড ও সক্রিয় লগইন নিয়ন্ত্রণ করুন।",
              en: "Manage your password and active sign-ins.",
            },
            page: "security",
          },
        ]
      : role === "finance"
        ? [
            {
              title: {
                bn: "পেমেন্ট ও রসিদ দেখুন",
                en: "View payments and receipts",
              },
              hint: {
                bn: "সংগ্রহের হিসাব ও মিলকরণ দেখুন।",
                en: "Check collections and reconciliation.",
              },
              page: "payments",
            },
            {
              title: { bn: "সাবস্ক্রিপশন দেখুন", en: "Manage subscription" },
              hint: {
                bn: "অফিসের সাবস্ক্রিপশন ও ক্রেডিট দেখুন।",
                en: "Check the office subscription and credits.",
              },
              page: "billing",
            },
            {
              title: { bn: "প্রতিবেদন দেখুন", en: "View reports" },
              hint: {
                bn: "অফিসের কার্যক্রমের প্রতিবেদন খুলুন।",
                en: "Open office activity reports.",
              },
              page: "reports",
            },
          ]
        : role === "reviewer"
          ? [
              {
                title: {
                  bn: "জমা দেওয়া আবেদন দেখুন",
                  en: "Review submitted applications",
                },
                hint: {
                  bn: "তথ্য ও সংযুক্তি পরীক্ষা শুরু করুন।",
                  en: "Start checking details and attachments.",
                },
                page: "applications",
                state: "SUBMITTED",
              },
              {
                title: {
                  bn: "পুনরায় জমা দেওয়া আবেদন",
                  en: "Review resubmitted applications",
                },
                hint: {
                  bn: "সংশোধনের পরে আসা আবেদন দেখুন।",
                  en: "Check applications returned after corrections.",
                },
                page: "applications",
                state: "RESUBMITTED",
              },
              {
                title: { bn: "সব আবেদন দেখুন", en: "View applications" },
                hint: {
                  bn: "চলমান পর্যালোচনা ও পুরোনো আবেদন খুঁজুন।",
                  en: "Find ongoing reviews and earlier applications.",
                },
                page: "applications",
              },
            ]
          : role === "approver"
            ? [
                {
                  title: {
                    bn: "অনুমোদনের জন্য দেখুন",
                    en: "Review for approval",
                  },
                  hint: {
                    bn: "পর্যালোচনাধীন আবেদন ও তথ্য দেখুন।",
                    en: "Read applications under review before deciding.",
                  },
                  page: "applications",
                  state: "UNDER_REVIEW",
                },
                {
                  title: {
                    bn: "অনুমোদিত আবেদন দেখুন",
                    en: "View approved applications",
                  },
                  hint: {
                    bn: "ফি ও ইস্যুর শর্ত পরীক্ষা করুন।",
                    en: "Check fees and requirements before issuance.",
                  },
                  page: "applications",
                  state: "APPROVED",
                },
                {
                  title: { bn: "সব আবেদন দেখুন", en: "View applications" },
                  hint: {
                    bn: "আগের সিদ্ধান্ত ও সনদ খুঁজে নিন।",
                    en: "Find previous decisions and certificates.",
                  },
                  page: "applications",
                },
              ]
            : [
                {
                  title: { bn: "আবেদন শুরু করুন", en: "Start an application" },
                  hint: {
                    bn: "নাগরিক ও সেবা বেছে তথ্য পূরণ করুন।",
                    en: "Choose a citizen and service, then fill in the details.",
                  },
                  page: "services",
                },
                {
                  title: { bn: "আবেদন খুঁজুন", en: "Find an application" },
                  hint: {
                    bn: "অবস্থা দেখুন, খসড়া খুলুন বা সনদ সংগ্রহ করুন।",
                    en: "Check progress, resume a draft or download a certificate.",
                  },
                  page: "applications",
                },
                {
                  title: {
                    bn: "সংশোধনের আবেদন দেখুন",
                    en: "View correction requests",
                  },
                  hint: {
                    bn: "অফিসের চাওয়া পরিবর্তন করে আবার জমা দিন।",
                    en: "Update the requested details and submit again.",
                  },
                  page: "applications",
                  state: "CORRECTION_REQUIRED",
                },
              ];
  return (
    <section
      className="panel workspace-welcome"
      aria-labelledby="welcome-heading"
    >
      <span className="eyebrow">
        {choose({ bn: "আপনার কাজ", en: "YOUR WORKSPACE" })}
      </span>
      <h2 id="welcome-heading">
        {choose({ bn: "আজ কী করতে চান?", en: "What would you like to do?" })}
      </h2>
      <p className="hint">
        {choose({
          bn: "নিচে কাজ বেছে শুরু করুন। পাশের মেনু থেকে অন্য সব সুবিধা পাওয়া যাবে।",
          en: "Choose a task below. All other tools are available in the navigation.",
        })}
      </p>
      <div className="workspace-tasks">
        {tasks.map((task, index) => (
          <button
            className={`workspace-task ${index ? "secondary" : ""}`}
            key={task.title.en}
            onClick={() => navigate(task.page, task.state)}
          >
            <span className="task-number" aria-hidden="true">
              {index + 1}
            </span>
            <span>
              <strong>{choose(task.title)}</strong>
              <small>{choose(task.hint)}</small>
            </span>
            <span aria-hidden="true">→</span>
          </button>
        ))}
      </div>
    </section>
  );
}
