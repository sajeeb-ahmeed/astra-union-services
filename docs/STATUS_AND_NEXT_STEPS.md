# Astra — বর্তমান অবস্থা ও পরবর্তী কাজ

সর্বশেষ নোট: **১৯ অক্টোবর ২০২৬, Asia/Dhaka**। এই নথি পরে কাজ চালু করার handoff। নিচের deployment ও test ফলাফল ওই তারিখের সংরক্ষিত evidence; ভবিষ্যতে কাজ শুরুর সময় বর্তমান অবস্থা আবার যাচাই করতে হবে।

## এক নজরে

- **Release 0.5.0 live:** [Astra ওয়েবসাইট](https://astra-union-services.onrender.com/)।
- **Source:** [GitHub repository](https://github.com/sajeeb-ahmeed/astra-union-services), branch: codex/initial-deployment।
- **Live runtime commit:** b86908b9a4654cc31cd1b517fc5e8ad3ae086878। পরের documentation commit-কে নতুন deployed runtime ভাবা যাবে না; Render Auto-Deploy বন্ধ।
- **Deploy:** dep-dbaob6s9v7es739a8j30; ১৯ অক্টোবর ২০২৬, সকাল ০৮:৫৩:২৫ বাংলাদেশ সময়।
- **CI:** ১৯২/১৯২ পরীক্ষা, production build ও Docker build পাস; dependency audit-এ তখন শূন্য vulnerability।
- **Live verification:** payment-এর ৭টি, পুরোনো data/PDF readback-এর ৬টি এবং geography-এর ৫টি check group পাস। বাংলা/ইংরেজি ও mobile browser inspection পাস।
- **প্রকৃত payment collection বন্ধ।** bKash merchant account/API credentials এখনও পাওয়া যায়নি; Nagad ও bank payout reconciliation যুক্ত হয়নি।
- **সনদ DEMO / NOT OFFICIAL।** Payment চালু করলেই সরকারি সনদ দেওয়ার কর্তৃত্ব তৈরি হয় না।

প্রধান evidence: [Release 0.5](RELEASE_0_5.md), [deployment record](HOSTED_DEPLOYMENT.md), [সংক্ষিপ্ত machine-readable ফলাফল](../execution/payments-live-release.json)।

## যতটুকু সম্পন্ন হয়েছে

| অংশ | সম্পন্ন কাজ | প্রমাণ ও সীমা |
| --- | --- | --- |
| Reference audit | Phase 0 documented audit সম্পন্ন; ৪৭টি সেবার matrix সংরক্ষিত | [Reference parity](REFERENCE_PARITY.csv), [process gaps](PROCESS_PARITY.md)। অদেখা reference payment/issuance ধাপ যাচাইকৃত বলা যাবে না; audit নতুন করে শুরু করার প্রয়োজন নেই। |
| Full-stack system | React frontend, Express/TypeScript backend, বাস্তব PostgreSQL, migrations, CI ও Render deployment | [Architecture](SYSTEM_ARCHITECTURE.md), [deployment](DEPLOYMENT.md)। Static clone নয়; মূল implementation স্বতন্ত্রভাবে তৈরি। |
| Tenant ও roles | অফিসভিত্তিক data isolation, forced RLS, পৃথক staff/reviewer/approver/admin/finance access | [Roles](ROLES_PERMISSIONS.md), [test matrix](TEST_MATRIX.md)। অফিসগুলোর তথ্য ও ক্ষমতার সীমা অক্ষত রাখতে হবে। |
| Dynamic services | ৪৭টি operational demonstration service, form validation, আবেদন/review/approval, PDF ও QR verification; family/trade/renewal expansion | [Delivery report](DELIVERY_REPORT.md), [process parity](PROCESS_PARITY.md)। এগুলো নিজস্ব পরীক্ষিত workflow; পূর্ণ reference equivalence বা সরকারি acceptance নয়। |
| Geography ও UI | সরবরাহকৃত Bangladesh hierarchy, parent validation, বাংলা/ইংরেজি, responsive UI | [Geography](GEOGRAPHY_INTEGRATION.md), [UI](LANGUAGE_AND_UI.md)। Derived rural ward ও dataset coverage-এর সীমা সংরক্ষিত। |
| Order ও fees | Citizen-first blank intake, language/delivery/urgency options, ইউনিয়ন/সেবাভিত্তিক সরকারি ও processing fee আলাদা, immutable assessment | [Order workflow](ORDER_WORKFLOW.md), [Release 0.4](RELEASE_0_4.md)। Test tariff সরকারি অনুমোদিত fee schedule নয়। |
| Subscription ও credits | Subscription/credit ledger, অনুমোদিত issuance-এ একবার credit deduction | [Billing ও ledger](BILLING_AND_LEDGER.md)। বিদ্যমান subscription/top-up payment fixture synthetic/zero-money; citizen fee দিলেই SaaS credit বাড়ে না। |
| Payment engine | bKash Tokenized Checkout v2 without agreement adapter; server-side amount/merchant verification; durable attempt; duplicate protection; encrypted token cache | [Gateway details](GATEWAY_PAYMENTS.md)। Local mock provider দিয়ে পরীক্ষিত; প্রকৃত bKash sandbox/live transaction হয়নি। |
| Receipt ও reconciliation | একবার immutable bilingual PDF receipt, protected download, payment register, gateway transaction checking, daily CSV; mismatch হলে নতুন issuance hold | [Release 0.5](RELEASE_0_5.md)। Gateway transaction reconciliation আছে; ব্যাংকে টাকা জমার reconciliation নেই। Live-এ fake paid receipt তৈরি করা হয়নি। |
| Migration ও preservation | Migration 012, ছয়টি gateway table-এ forced RLS, idempotent replay, সব ৬৬টি recorded domain fingerprint অপরিবর্তিত | [Migration evidence](../execution/payments-hosted-migration.json)। ৩টি অফিস, ১২টি user ও ২টি certificate-এর baseline অক্ষত; সাময়িক external database access বন্ধ করা হয়েছে। |

## ইতিমধ্যে নেওয়া সিদ্ধান্ত

1. প্রথম online provider হবে **bKash**; **Nagad পরে** যুক্ত হবে। Merchant account এখনও খোলা হয়নি।
2. আবেদন অনুমোদন করতে পৃথক চেয়ারম্যান/অনুমোদনকারীর account ও প্রযোজ্য authorization লাগবে।
3. ইউনিয়নভিত্তিক processing fee ও সরকারি service fee আলাদা থাকবে; software subscription/credits-এর হিসাবও আলাদা।
4. বর্তমান adapter একটি deployment-এ **একটি নির্দিষ্ট অফিসের merchant configuration** সমর্থন করে। সব ইউনিয়নের টাকা একই account-এ নেওয়ার অনুমোদন ধরে নেওয়া হয়নি।
5. Phase 0 audit evidence এবং ৪৭-service matrix ধরে স্বাধীন implementation চলবে; অনুপস্থিত reference evidence অনুমান দিয়ে পূরণ করা হবে না।
6. এই documentation কাজ কোনো gateway activation, নতুন merchant application, paid hosting purchase বা live configuration change নয়।

## Payment gateway নিয়ে পরে যেভাবে কাজ শুরু হবে

| ক্রম | কাজ | কার ইনপুট/কাজ | শেষ হওয়ার প্রমাণ |
| --- | --- | --- | --- |
| 1 | কে টাকা গ্রহণ করবে নির্ধারণ: software company, ইউনিয়ন/অফিস, merchant ও settlement bank-এর সম্পর্ক | মালিক/দায়িত্বপ্রাপ্ত অফিস + bKash merchant team | অনুমোদিত collection/settlement arrangement; কোন fee কার account-এ যাবে স্পষ্ট |
| 2 | bKash Online Business/Payment Gateway আবেদন ও onboarding | মালিক/প্রতিষ্ঠানের অনুমোদিত প্রতিনিধি | প্রযোজ্য KYC, documents, agreement, charges ও merchant approval |
| 3 | Sandbox access ও বর্তমান integration/acceptance checklist সংগ্রহ | bKash team + developer | সঠিক v2 environment, API credentials, merchant identity ও callback requirements নিশ্চিত |
| 4 | Pending/failed/expired/unknown attempt recovery ও replacement checkout তৈরি | Developer | পুনরায় টাকা কাটার ঝুঁকি ছাড়া recovery; concurrent retry ও timeout tests; operational runbook |
| 5 | প্রকৃত bKash sandbox-এ সম্পূর্ণ end-to-end acceptance | Developer + merchant team | Success/cancel/failure/timeout, Query/Search, duplicate callback, এক receipt, approval/credit invariants-এর সংরক্ষিত evidence |
| 6 | Live collection-এর আগের operational readiness সম্পন্ন | মালিক + developer + provider | স্থায়ী hosting/backups, monitoring, প্রযোজ্য provider notification/IPN ও refund/reconciliation process, অনুমোদিত fee/terms |
| 7 | Production credentials ও go-live clearance অনুযায়ী নিয়ন্ত্রিত live verification | অনুমোদিত account holder + developer | প্রকৃত transaction, receipt ও settlement যাচাই; এরপর সীমিত pilot |

### bKash আবেদন করার নোট

আবেদনের অফিসিয়াল লিংক: [Online Business](https://www.bkash.com/en/business/online-business)। [Merchant form](https://www.bkash.com/en/business/merchant) এবং [Corporate & Enterprise](https://www.bkash.com/en/business/corporate-enterprise) সেবাও আছে; ইউনিয়ন/প্রাতিষ্ঠানিক ব্যবহারের উপযুক্ত category bKash-কে নিশ্চিত করতে হবে।

প্রতিষ্ঠানের নাম/ঠিকানা/ধরন, যোগাযোগকারীর মোবাইল/ইমেইল, website URL, NID, trade license-এর তথ্য ও ব্যাংক হিসাবের তথ্য প্রস্তুত রাখুন। অফিসিয়াল ফর্ম এসব তথ্য বা এগুলো আছে কি না জানতে চায়; এটি সব প্রতিষ্ঠানের জন্য চূড়ান্ত document checklist নয়। TIN/BIN, institutional registration বা authorization letter লাগবে কি না merchant team-এর কাছ থেকে নিশ্চিত করতে হবে।

Additional Information-এর খসড়া:

> আমরা Astra নামে একাধিক ইউনিয়ন/অফিসের নাগরিক সেবা পরিচালনার সফটওয়্যার তৈরি করছি। bKash Payment Gateway API ও sandbox access প্রয়োজন। অনুগ্রহ করে প্রযোজ্য merchant onboarding, প্রয়োজনীয় কাগজপত্র, ইউনিয়নভিত্তিক collection/settlement ব্যবস্থা, charges এবং approval process জানান। বর্তমান ওয়েবসাইটটি পরীক্ষামূলক সংস্করণ।

API configuration-এর জন্য bKash-issued username, password, app_key ও app_secret লাগবে; এগুলো wallet PIN/OTP নয়। Credentials GitHub, frontend, chat বা screenshots-এ রাখা যাবে না—server-side secret settings-এ থাকবে। [bKash Grant Token](https://developer.bka.sh/docs/grant-token), [token management](https://developer.bka.sh/docs/token-managment-v2)।

নির্দিষ্ট approval সময়, বিনামূল্যে API বা নির্দিষ্ট MDR ধরে budget করা হয়নি। Transaction charge, VAT, settlement সময়, refund charge ও acceptance process লিখিতভাবে নিশ্চিত করতে হবে। সহায়তা: [bKash যোগাযোগ](https://www.bkash.com/en/customer-service/contact-us), 16247। [Onboarding overview](https://developer.bka.sh/docs/product-overview) ও [without-agreement checkout](https://developer.bka.sh/docs/tokenized-without-agreement) ১৯ অক্টোবরের guidance-এর ভিত্তি; কাজ শুরুর সময় সর্বশেষ contract আবার পড়তে হবে।

## Gateway-এর পরের ও পাশাপাশি চলার কাজ

| অগ্রাধিকার | বাকি কাজ | শেষ হওয়ার মানদণ্ড |
| --- | --- | --- |
| জরুরি, gateway-এর জন্য অপেক্ষা নয় | Render Free PostgreSQL-এর মেয়াদ **১২ নভেম্বর ২০২৬**; backup/export ও স্থায়ী hosting পরিকল্পনা | মেয়াদের আগে data preservation, restore test ও মালিকের অনুমোদিত hosting ব্যবস্থা। বর্তমান নথি paid plan কেনার অনুমতি নয়। |
| প্রকৃত ব্যবহার শুরুর আগে | প্রতিটি সেবার form, wording, fee, eligibility, signatory ও issuing authority অফিস দিয়ে যাচাই | দায়িত্বপ্রাপ্ত অফিসের অনুমোদিত/versioned rules এবং pilot acceptance; শুধু DEMO লেখা সরানো নয় |
| প্রকৃত ব্যবহার শুরুর আগে | Identity/OTP, attachment quarantine/malware scanning, private storage, retention, encryption ও recovery | অনুমোদিত provider/storage-এ positive ও negative security tests, backup restore evidence |
| P1 | Multi-union merchant configuration ও token/transaction isolation | প্রতিটি অফিসের অনুমোদিত merchant mapping, cross-tenant tests, পুরোনো payment-এর merchant পরিচয় অক্ষত |
| P1 | Nagad | Merchant-issued বর্তমান API contract, পৃথক adapter ও প্রকৃত sandbox acceptance; শুধু button যোগ নয় |
| P1 | Bank settlement, gateway charge/VAT, refund/dispute ও accounting | Provider/bank statement-এর সাথে gross/fee/net মিল, discrepancy queue, audit trail ও অর্থ বিভাগের acceptance |
| P1 | বাণিজ্যিক SaaS subscription/top-up | অনুমোদিত pricing, actual provider settlement, credit posting idempotency, refund/credit adjustment policy |
| P1 | SMS/email, delivery status ও background jobs | Provider contract, retry/outbox processing, duplicate prevention, delivery receipt ও failure alerts |
| P1 | MFA, privileged account recovery, access review ও multi-office switching | Role-based positive/negative tests, support runbook ও audited recovery |
| P1 | Performance, accessibility, monitoring ও incident response | বাস্তবসম্মত load/large-data tests, screen-reader/contrast checks, alerts, restore/rollback drill |
| P2 | Reference-parity ও service-specific gaps | [Process parity](PROCESS_PARITY.md)-র বাকি address/coupon/holding/স্থানীয় workflow বিষয়গুলো অফিসের evidence অনুযায়ী সম্পন্ন |

## কাজ পুনরায় শুরু করার নির্দেশনা

1. এই নথি, [current backlog](DELIVERY_BACKLOG.md), [gateway contract](GATEWAY_PAYMENTS.md) ও [Release 0.5](RELEASE_0_5.md) পড়ুন।
2. Git branch/commit, Render-এর বর্তমান runtime, database health/expiry ও merchant readiness যাচাই করুন। সংরক্ষিত ১৯ অক্টোবরের ফলকে নতুন test run বলা যাবে না।
3. Merchant account এখনও না থাকলে onboarding ও non-provider কাজ এগোবে; hosted checkout disabled থাকবে। থাকলে secret প্রকাশ না করে provider-approved sandbox দিয়ে শুরু করুন।
4. বর্তমান one-attempt-per-application সীমা, cancelled/unknown-create recovery এবং একটি configured tenant-এর সীমা আগে বিবেচনা করুন। শুধু API key বসিয়ে normal commercial collection চালু করবেন না।
5. পরিবর্তনের উপযুক্ত tests, CI, migration preservation ও deployment verification রেকর্ড করুন। আগের release evidence overwrite না করে আলাদা evidence file রাখুন।
6. কাজের ফল, বাকি সীমা ও next milestone এই নথি ও backlog-এ হালনাগাদ করে source commit/push করুন; runtime deployment আলাদাভাবে যাচাই করুন।

**পরবর্তী বাস্তব milestone:** অনুমোদিত merchant/settlement model + bKash sandbox access + operational recovery + প্রকৃত sandbox end-to-end acceptance।
