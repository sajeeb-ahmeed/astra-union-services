import { useId } from "react";
import { useIssuanceMode } from "./mode.js";
import { choose, useLanguage } from "./i18n.js";

export type ApplicationGuidanceProps = {
  state: string;
  role: string;
  hasCertificate: boolean;
  revoked: boolean;
  order?: { totalMinor: number; paymentStatus: string } | null;
  /** Phase UX: false only in a proven OFFICIAL deployment; demo deployments keep the honesty sentence. */
  demo?: boolean;
};

type Copy = { bn: string; en: string };
type Guidance = {
  title: Copy;
  description: Copy;
  step?: number;
  warning?: boolean;
  action?: {
    target: "application-actions" | "application-certificate";
    label: Copy;
  };
};
const text = (bn: string, en: string): Copy => ({ bn, en });
const actions = (label: Copy): Guidance["action"] => ({
  target: "application-actions",
  label,
});

function guidanceFor({
  state,
  role,
  hasCertificate,
  revoked,
  order,
  demo,
}: ApplicationGuidanceProps): Guidance {
  const applicant = ["citizen", "staff", "admin"].includes(role);
  if (revoked || state === "REVOKED")
    return {
      title: text("সনদ প্রত্যাহার করা হয়েছে", "Certificate revoked"),
      description: text(
        "সনদটি আর সক্রিয় নেই। কারণ জানতে আবেদনের ইতিহাস দেখুন এবং প্রয়োজন হলে সংশ্লিষ্ট অফিসের সঙ্গে যোগাযোগ করুন। সংরক্ষিত PDF-কে সক্রিয় সনদ ধরে নেবেন না।",
        "This certificate is no longer active. Read the application history for the reason and contact the office if needed. A retained PDF does not make the certificate active.",
      ),
      warning: true,
      ...(hasCertificate
        ? {
            action: {
              target: "application-certificate" as const,
              label: text("সনদের রেকর্ড দেখুন", "View certificate record"),
            },
          }
        : {}),
    };
  if (state === "REJECTED")
    return {
      title: text("আবেদন গ্রহণ করা হয়নি", "Application rejected"),
      description: text(
        "আবেদনের ইতিহাসে সিদ্ধান্তের কারণ দেখুন। পরবর্তী করণীয় জানতে সংশ্লিষ্ট অফিসে যোগাযোগ করুন। এই আবেদন থেকে সনদ ইস্যু করা যাবে না।",
        "Read the decision reason in the application history. Contact the office about the next steps. This application cannot proceed to certificate issuance.",
      ),
      warning: true,
    };
  if (state === "CANCELLED")
    return {
      title: text("আবেদন বাতিল করা হয়েছে", "Application cancelled"),
      description: text(
        "এই আবেদনের কাজ বন্ধ হয়েছে। সেবা এখনও প্রয়োজন হলে আবেদন তালিকা থেকে নতুন আবেদন শুরু করুন। আগের আবেদনের ইতিহাস সংরক্ষিত আছে।",
        "Work on this application has stopped. If you still need the service, start a new application from the application list. The earlier history is retained.",
      ),
    };
  if (state === "DRAFT")
    return {
      title: text("খসড়া জমা দেওয়া বাকি", "Draft not yet submitted"),
      description: applicant
        ? text(
            "সংরক্ষিত তথ্য মিলিয়ে নিন। কিছু বদলালে আগে সংরক্ষণ করুন, তারপর আবেদন জমা দিন। শুধু খসড়া সংরক্ষণ করলে যাচাই শুরু হয় না।",
            "Review the saved information. Save any edits, then submit the application. Saving a draft alone does not start review.",
          )
        : text(
            "আবেদনকারী বা অনুমোদিত কাউন্টার কর্মীকে আগে খসড়াটি জমা দিতে হবে। এরপর যাচাই ও অনুমোদনের কাজ শুরু হবে।",
            "The applicant or authorised counter staff must submit this draft first. Review and approval follow submission.",
          ),
      step: 0,
      ...(applicant
        ? {
            action: actions(
              text("জমা দেওয়ার বোতামে যান", "Go to submission controls"),
            ),
          }
        : {}),
    };
  if (state === "CORRECTION_REQUIRED")
    return {
      title: text("তথ্য সংশোধন প্রয়োজন", "Corrections needed"),
      description: applicant
        ? text(
            "আবেদনের ইতিহাসে সংশোধনের কারণ পড়ুন। প্রয়োজনীয় তথ্য ঠিক করে পরিবর্তন সংরক্ষণ করুন, তারপর পুনরায় আবেদন জমা দিন।",
            "Read the correction reason in the application history. Update the requested information, save the changes, then resubmit the application.",
          )
        : text(
            "আবেদনকারী বা কাউন্টার কর্মীর সংশোধনের অপেক্ষায় আছে। তাঁরা পরিবর্তন সংরক্ষণ করে পুনরায় জমা দিলে আবার যাচাই করা যাবে।",
            "Waiting for the applicant or counter staff to make corrections. Review can resume after they save and resubmit the application.",
          ),
      warning: true,
      step: 0,
      ...(applicant
        ? {
            action: actions(
              text(
                "পুনরায় জমা দেওয়ার বোতামে যান",
                "Go to resubmission controls",
              ),
            ),
          }
        : {}),
    };
  if (["SUBMITTED", "RESUBMITTED"].includes(state))
    return {
      title: text(
        "চেয়ারম্যানের যাচাইয়ের অপেক্ষায়",
        "Waiting for the Chairman's verification",
      ),
      description:
        role === "approver"
          ? text(
              "আবেদনটি জমা হয়েছে। তথ্য ও সংযুক্তি দেখে সিদ্ধান্ত নিন: অনুমোদন করলেই সনদ ইস্যু হবে; প্রয়োজনে সংশোধন চাইতে, আবেদনকারীকে আসতে বলতে বা কারণসহ প্রত্যাখ্যান করতে পারবেন।",
              "The application has been submitted. Check its information and attachments, then decide: approval issues the certificate at once; you can also request a correction, ask the applicant to come, or reject with a reason.",
            )
          : role === "reviewer"
            ? text(
                "আবেদনটি জমা হয়েছে। তথ্য ও সংযুক্তি দেখতে পারবেন; যাচাই ও সিদ্ধান্ত চেয়ারম্যানের কাজ।",
                "The application has been submitted. You can view its information and attachments; verification and the decision are the Chairman's work.",
              )
            : text(
                "আবেদনটি জমা হয়েছে। চেয়ারম্যান তথ্য যাচাই করবেন; সংশোধন লাগলে এখানে জানানো হবে। এখন একই আবেদন আবার জমা দেওয়ার প্রয়োজন নেই।",
                "The application has been submitted. The Chairman will verify the information; any correction request will appear here. You do not need to submit the same application again now.",
              ),
      step: 1,
      ...(role === "approver"
        ? {
            action: actions(
              text("সিদ্ধান্তের বোতামে যান", "Go to decision controls"),
            ),
          }
        : {}),
    };
  if (state === "UNDER_REVIEW")
    // Legacy state from before Phase W (no transition leads here now); the Chairman decides it
    // exactly like a submitted application.
    return {
      title: text("যাচাই চলছে", "Verification in progress"),
      description:
        role === "approver"
          ? text(
              "তথ্য ও সংযুক্তি দেখুন। এই সেবায় অনুমোদনের ক্ষমতা থাকলে অনুমোদন করুন — অনুমোদন করলেই সনদ ইস্যু হবে — অথবা কারণসহ প্রত্যাখ্যান করুন।",
              "Check the information and attachments. If authorised for this service, approve — approval issues the certificate at once — or reject with a reason.",
            )
          : role === "reviewer"
            ? text(
                "আবেদনটি যাচাইয়ের পর্যায়ে আছে। যাচাই ও সিদ্ধান্ত চেয়ারম্যানের কাজ।",
                "This application is being verified. Verification and the decision are the Chairman's work.",
              )
            : text(
                "অফিস আবেদনটি যাচাই করছে। সংশোধন বা সিদ্ধান্ত এলে এই পাতায় অবস্থা বদলাবে। চেয়ারম্যান অনুমোদন করলেই সনদ ইস্যু হবে।",
                "The office is verifying this application. Corrections or a decision will update its status here. When the Chairman approves, the certificate is issued at once.",
              ),
      step: 1,
      ...(role === "approver"
        ? {
            action: actions(
              text("সিদ্ধান্তের বোতামে যান", "Go to decision controls"),
            ),
          }
        : {}),
    };
  if (["APPROVED", "ISSUANCE_PENDING"].includes(state)) {
    // COLLECTED is the application's server-computed payment state. A provider
    // attempt's PAID flag is not equivalent. The separate payment card refreshes
    // independently, so guidance asks users to inspect its current information.
    const feeNeedsVerification =
      !!order && order.totalMinor > 0 && order.paymentStatus !== "COLLECTED";
    if (feeNeedsVerification)
      return {
        title: text(
          "অনুমোদিত — ফি পরিশোধের অবস্থা দেখুন",
          "Approved — check fee payment",
        ),
        description: text(
          "সনদ ইস্যুর আগে ফি পরিশোধ সার্ভারে যাচাই হতে হবে। নিচে পেমেন্টের বর্তমান তথ্য দেখুন। অনলাইন পেমেন্ট চালু না থাকলে সংশ্লিষ্ট অফিসে যোগাযোগ করুন। অনুমোদনকে পরিশোধের রসিদ ধরে নেবেন না।",
          "Certificate issuance requires server-verified fee payment. Check the current payment information below. Contact the office if online payment is unavailable. Approval is not a payment receipt.",
        ),
        step: 2,
        warning: true,
      };
    return {
      title:
        state === "ISSUANCE_PENDING"
          ? text("সনদ ইস্যুর অপেক্ষায়", "Certificate issuance pending")
          : text(
              "অনুমোদিত — সনদ ইস্যু বাকি",
              "Approved — certificate not yet issued",
            ),
      description:
        role === "approver"
          ? text(
              "বর্তমান ফি ও আবেদনের তথ্য মিলিয়ে নিন। এই সেবায় ইস্যুর ক্ষমতা থাকলে নিচের বোতাম ব্যবহার করুন। সার্ভার অনুমোদন, প্রযোজ্য পরিশোধ ও ক্রেডিট আবার যাচাই করবে। ইস্যু সফল হলে PDF পাওয়া যাবে।",
              "Check the current fee and application information. If authorised to issue this service, use the controls below. The server checks approval, any required payment and credits again. The PDF becomes available after successful issuance.",
            )
          : text(
              "অনুমোদন হয়েছে। প্রযোজ্য ফি পরিশোধ যাচাইয়ের পরে অনুমোদিত কর্মকর্তা সনদ ইস্যু করবেন। পেমেন্টের বর্তমান তথ্য নিচে দেখুন; সনদ তৈরি হলে এখান থেকে PDF পাওয়া যাবে।",
              "Approval is recorded. An authorised officer must issue the certificate after any required fee verification. Check the current payment information below; the PDF will appear here after issuance.",
            ),
      step: 2,
      ...(role === "approver"
        ? {
            action: actions(
              text("সনদ ইস্যুর বোতামে যান", "Go to issuance controls"),
            ),
          }
        : {}),
    };
  }
  if (state === "ISSUED")
    return hasCertificate
      ? {
          title: text("সনদের PDF পাওয়া যাচ্ছে", "Certificate PDF available"),
          description: text(
            "নিচে তৈরি হওয়া PDF ও QR যাচাইয়ের লিংক আছে।" +
              (demo === false ? "" : " এই সনদে DEMO / NOT OFFICIAL চিহ্ন রয়েছে।"),
            "Open the generated PDF and its QR verification below." +
              (demo === false
                ? ""
                : " This certificate is marked DEMO / NOT OFFICIAL."),
          ),
          step: 3,
          action: {
            target: "application-certificate",
            label: text("সনদের PDF ও QR দেখুন", "View certificate PDF and QR"),
          },
        }
      : {
          title: text(
            "সনদের রেকর্ড যাচাই করুন",
            "Check the certificate record",
          ),
          description: text(
            "আবেদনটি ইস্যু দেখাচ্ছে, তবে এই পাতায় সনদের রেকর্ড পাওয়া যাচ্ছে না। পাতাটি হালনাগাদ করুন অথবা সংশ্লিষ্ট অফিসে যোগাযোগ করুন।",
            "The application is marked issued, but its certificate record is unavailable on this page. Reload the page or contact the office.",
          ),
          warning: true,
        };
  return {
    title: text("আবেদনের অবস্থা যাচাই করুন", "Check the application status"),
    description: text(
      "বর্তমান অবস্থার জন্য পরবর্তী ধাপ নিশ্চিত করা যায়নি। পাতাটি হালনাগাদ করুন অথবা সংশ্লিষ্ট অফিসে যোগাযোগ করুন।",
      "The next step for this status could not be determined. Reload the page or contact the office.",
    ),
    warning: true,
  };
}

/** Read-only guidance. It never changes workflow, payment or certificate state. */
export function ApplicationGuidance(props: ApplicationGuidanceProps) {
  useLanguage();
  const headingId = useId();
  const mode = useIssuanceMode();
  const guidance = guidanceFor({ ...props, demo: mode !== "OFFICIAL" });
  const corrections = props.state === "CORRECTION_REQUIRED";
  const steps = [
    corrections
      ? text("তথ্য সংশোধন", "Correct details")
      : text("খসড়া", "Draft"),
    corrections ? text("পুনরায় জমা", "Resubmit") : text("জমা", "Submitted"),
    text("যাচাই ও সিদ্ধান্ত", "Verification and decision"),
    text("সনদ", "Certificate"),
  ];
  return (
    <section
      className={`application-guidance${guidance.warning ? " guidance-warning" : ""}`}
      aria-labelledby={headingId}
      data-guidance-state={props.revoked ? "REVOKED" : props.state}
    >
      <h2 id={headingId}>
        {choose(text("এরপর কী করবেন", "What happens next"))}
      </h2>
      <h3 className="guidance-status">{choose(guidance.title)}</h3>
      <p className="guidance-description">{choose(guidance.description)}</p>
      {guidance.step !== undefined && (
        <ol
          className="application-progress"
          aria-label={choose(text("আবেদনের ধাপ", "Application steps"))}
        >
          {steps.map((step, index) => (
            <li
              key={index}
              className={`progress-step${index < guidance.step! ? " is-complete" : ""}${index === guidance.step ? " is-current" : ""}`}
              aria-current={index === guidance.step ? "step" : undefined}
            >
              <span className="step-number" aria-hidden="true">
                {(index + 1).toLocaleString(choose(text("bn-BD", "en-GB")))}
              </span>
              <span className="step-label">{choose(step)}</span>
            </li>
          ))}
        </ol>
      )}
      {guidance.action && (
        <a
          className="button secondary guidance-link"
          href={`#${guidance.action.target}`}
        >
          {choose(guidance.action.label)}
        </a>
      )}
    </section>
  );
}
