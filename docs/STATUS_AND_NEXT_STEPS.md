# Astra — বর্তমান অবস্থা ও পরবর্তী কাজ

সর্বশেষ নোট: **২১ অক্টোবর ২০২৬, Asia/Dhaka**। এই নথি পরে কাজ চালু করার handoff। নিচের deployment ও test ফলাফলের নিজস্ব execution date সংরক্ষিত আছে; ভবিষ্যতে কাজ শুরুর সময় বর্তমান অবস্থা আবার যাচাই করতে হবে।

## এক নজরে

- **0.8 প্রস্তুত; live acceptance এখনও বাকি:** optional authenticator login, একবার ব্যবহারযোগ্য recovery code, নিজের account-security history এবং encrypted managed backup/আলাদা restore tooling তৈরি হয়েছে। স্থানীয় ও Linux CI—দুই জায়গায় **২৫২/২৫২ পরীক্ষা**, production/Docker build ও zero-vulnerability audit পাস; স্বাধীন synthetic restore/application-startup rehearsal-এ আরও ২২টি check পাস। Source candidate `cd6b5c8a7deb8d4f5be4b6b7ee6eded8358b4479` GitHub-এ আছে। বর্তমান maintenance window-এর consent, hosted migration/export/restore ও deploy verification pending; পুরোনো 0.7-ই সর্বশেষ যাচাইকৃত live runtime। [সঠিক checkpoint ও পরবর্তী execution ধাপ](RELEASE_0_8.md)।

- **0.7 usability live:** role অনুযায়ী কাজের shortcut, mobile page picker, সহজ search/filter, আবেদন ও সংশোধনের পরবর্তী ধাপ, field-error link, public tracking/verification এবং password দেখানো/লুকানোর control। বাংলা/ইংরেজি ও ৪৭টি সেবা অক্ষত।
- **Release 0.7.0 live; hosted acceptance পাস:** [Astra ওয়েবসাইট](https://astra-union-services.onrender.com/)। [Release 0.7](RELEASE_0_7.md), [local evidence](../execution/usability-local-qa.json)।
- **Source:** [GitHub repository](https://github.com/sajeeb-ahmeed/astra-union-services), branch: codex/initial-deployment।
- **Live runtime commit:** 56fb7f56bd77cfde2887a52384d3a9b4706a421e। পরের documentation commit-কে নতুন deployed runtime ভাবা যাবে না; Render Auto-Deploy বন্ধ।
- **Deploy:** dep-dbc596mi0phs73aeldug; ২১ অক্টোবর ২০২৬, দুপুর ১২:০১:২১ বাংলাদেশ সময়।
- **CI:** [39552222856](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39552222856)-এ **২২৩/২২৩ পরীক্ষা** (backup ৫, forms ৭২, API ৯৭, web ৪৯), production/Docker build ও zero-vulnerability audit পাস। স্থানীয় ৪৯/৪৯ web test, typecheck ও build-ও পাস।
- **Live verification:** ২১ অক্টোবর 0.7-এ account security ৪টি, payment ৭টি, readback ৬টি ও geography ৫টি—মোট **২২টি API group পাস**। আরও **৮টি বাংলা/ইংরেজি/mobile browser group** ও **৮টি JS/CSS hash** পাস; page error নেই, browser শেষে signed out। পুরোনো PDF ও credit records অপরিবর্তিত। Database available, external IP allowlist খালি; migration বা access খোলা হয়নি।
- **প্রকৃত payment collection বন্ধ।** bKash merchant account/API credentials এখনও পাওয়া যায়নি; Nagad ও bank payout reconciliation যুক্ত হয়নি।
- **সনদ DEMO / NOT OFFICIAL।** Payment চালু করলেই সরকারি সনদ দেওয়ার কর্তৃত্ব তৈরি হয় না।

প্রধান evidence: [Release 0.7](RELEASE_0_7.md), [deployment record](HOSTED_DEPLOYMENT.md), [CI ফলাফল](../execution/usability-ci-qa.json), [live ফলাফল](../execution/usability-live-release.json)। আগের [0.6 ফলাফল](../execution/security-live-release.json) ও [0.5 ফলাফল](../execution/payments-live-release.json) আলাদা ইতিহাস।

## 0.7 usability কাজ — live ও যাচাইকৃত

ব্যবহার সহজ করার জন্য প্রথম পাতায় role অনুযায়ী প্রয়োজনীয় কাজ সামনে আনা হয়েছে। নতুন আবেদনে নাগরিক → সেবা → তথ্য/ফি/খসড়া ধাপ দেখানো হয়; ভুল field-এর নাম ধরে সরাসরি সংশোধনের ঘরে যাওয়া যায়। আবেদন খুললে খসড়া জমা দেওয়া, সংশোধন, যাচাই, অনুমোদন, প্রযোজ্য fee verification এবং PDF সংগ্রহের পরবর্তী করণীয় দেখা যায়। নির্দেশনাগুলো server-এর authorization বা payment/issuance শর্ত পরিবর্তন করে না।

Public service search-এ বাংলা সংখ্যা ব্যবহার, না পাওয়া গেলে সব সেবায় ফেরা, বাছাই করা সেবার তথ্য সরাসরি দেখা এবং login password দেখানো/লুকানো যোগ হয়েছে। এটি usability increment; official authority, identity verification, merchant collection বা hosted backup চালু হয়নি। পূর্ণ hosted export/independent restore ও **১২ নভেম্বরের আগে durable hosting** এখনও জরুরি অগ্রাধিকার।

## 0.6 ইতিহাস — live ও যাচাইকৃত baseline

ব্যবহারকারীর সিদ্ধান্ত অনুযায়ী **payment gateway, merchant onboarding ও activation আপাতত স্থগিত**। Merchant account ছাড়া করা যায় এমন কাজের প্রথম increment তৈরি হয়েছে:

- **Account sessions:** নিজের active login session-এর সংখ্যা/মেয়াদ দেখা এবং বর্তমান password দিয়ে অন্য session-গুলো sign out। Password পরিবর্তন করলে আগের recovery link-ও বাতিল হয়; concurrent login/recovery/password change-এর race পরীক্ষা করা হয়েছে। বাংলা/ইংরেজি UI আছে। [Account security](ACCOUNT_SECURITY.md)।
- **Public-page performance:** public JavaScript ৯৯০,৭৬৯ থেকে **৩৫২,৯২৯ bytes—৬৪.৪% কম**। ৪৭টি service অক্ষত; login-এর পরে workspace/form schema load হয়। এটি bundle-size measurement, বাস্তব নেটওয়ার্কে page-load speed-এর দাবি নয়। [Evidence](../execution/security-performance-qa.json)।
- **Local backup/restore:** ১৭টি real recovery check পাস; ৪৬টি table, ১১৭টি synthetic office ও ৪৩৫টি PDF-এর data/hash, ledger, RLS ও permissions নতুন isolated database-এ মিলেছে। Hosted full backup/offsite restore এখনও সম্পন্ন নয়। [Runbook](BACKUP_AND_RECOVERY.md)।
- **পরীক্ষা:** ২১০/২১০ local test—৫ backup, ৭২ form, ৯৭ API ও ৩৬ web; build ও dependency audit পাস। [Local ফলাফল](../execution/security-local-qa.json)। একই test-এর focused rerun আলাদা করে total-এ যোগ করা হয়নি।

Deployed runtime commit: `402903fb113799f5d7e5ec8d62307ba88f625318`; [CI 39199410740](https://github.com/sajeeb-ahmeed/astra-union-services/actions/runs/39199410740)-এ **২১০/২১০ test, Docker build ও dependency audit পাস**। Render deployment `dep-dbappb8m7kps739q5ivg`-এর live status ও hosted verification পাস। এই release-এ migration, payment credentials বা database firewall খোলা লাগেনি; external IP allowlist খালি আছে।

প্রথম CI-তে ৯৭টি API ও ৩৫টি web test পাস হলেও public bundle-size test ব্যর্থ হয়েছিল: `NODE_ENV=test` development React bundle তৈরি করেছিল। Production-build configuration ঠিক করা হয়েছে; budget কমানো হয়নি। একই environment-এ চারটি focused test এবং নতুন candidate-এর পূর্ণ ২১০টি CI test পাস; final public bundle ৩৫২,৯২৯ bytes আছে। [CI attempt history](../execution/security-ci-attempts.json)।

## যতটুকু সম্পন্ন হয়েছে

| অংশ                      | সম্পন্ন কাজ                                                                                                                                                   | প্রমাণ ও সীমা                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference audit          | Phase 0 documented audit সম্পন্ন; ৪৭টি সেবার matrix সংরক্ষিত                                                                                                  | [Reference parity](REFERENCE_PARITY.csv), [process gaps](PROCESS_PARITY.md)। অদেখা reference payment/issuance ধাপ যাচাইকৃত বলা যাবে না; audit নতুন করে শুরু করার প্রয়োজন নেই। |
| Full-stack system        | React frontend, Express/TypeScript backend, বাস্তব PostgreSQL, migrations, CI ও Render deployment                                                             | [Architecture](SYSTEM_ARCHITECTURE.md), [deployment](DEPLOYMENT.md)। Static clone নয়; মূল implementation স্বতন্ত্রভাবে তৈরি।                                                  |
| Tenant ও roles           | অফিসভিত্তিক data isolation, forced RLS, পৃথক staff/reviewer/approver/admin/finance access                                                                     | [Roles](ROLES_PERMISSIONS.md), [test matrix](TEST_MATRIX.md)। অফিসগুলোর তথ্য ও ক্ষমতার সীমা অক্ষত রাখতে হবে।                                                                  |
| Dynamic services         | ৪৭টি operational demonstration service, form validation, আবেদন/review/approval, PDF ও QR verification; family/trade/renewal expansion                         | [Delivery report](DELIVERY_REPORT.md), [process parity](PROCESS_PARITY.md)। এগুলো নিজস্ব পরীক্ষিত workflow; পূর্ণ reference equivalence বা সরকারি acceptance নয়।              |
| Geography ও UI           | সরবরাহকৃত Bangladesh hierarchy, parent validation, বাংলা/ইংরেজি, responsive UI                                                                                | [Geography](GEOGRAPHY_INTEGRATION.md), [UI](LANGUAGE_AND_UI.md)। Derived rural ward ও dataset coverage-এর সীমা সংরক্ষিত।                                                      |
| Order ও fees             | Citizen-first blank intake, language/delivery/urgency options, ইউনিয়ন/সেবাভিত্তিক সরকারি ও processing fee আলাদা, immutable assessment                         | [Order workflow](ORDER_WORKFLOW.md), [Release 0.4](RELEASE_0_4.md)। Test tariff সরকারি অনুমোদিত fee schedule নয়।                                                              |
| Subscription ও credits   | Subscription/credit ledger, অনুমোদিত issuance-এ একবার credit deduction                                                                                        | [Billing ও ledger](BILLING_AND_LEDGER.md)। বিদ্যমান subscription/top-up payment fixture synthetic/zero-money; citizen fee দিলেই SaaS credit বাড়ে না।                          |
| Payment engine           | bKash Tokenized Checkout v2 without agreement adapter; server-side amount/merchant verification; durable attempt; duplicate protection; encrypted token cache | [Gateway details](GATEWAY_PAYMENTS.md)। Local mock provider দিয়ে পরীক্ষিত; প্রকৃত bKash sandbox/live transaction হয়নি।                                                        |
| Receipt ও reconciliation | একবার immutable bilingual PDF receipt, protected download, payment register, gateway transaction checking, daily CSV; mismatch হলে নতুন issuance hold         | [Release 0.5](RELEASE_0_5.md)। Gateway transaction reconciliation আছে; ব্যাংকে টাকা জমার reconciliation নেই। Live-এ fake paid receipt তৈরি করা হয়নি।                          |
| Migration ও preservation | Migration 012, ছয়টি gateway table-এ forced RLS, idempotent replay, সব ৬৬টি recorded domain fingerprint অপরিবর্তিত                                             | [Migration evidence](../execution/payments-hosted-migration.json)। ৩টি অফিস, ১২টি user ও ২টি certificate-এর baseline অক্ষত; সাময়িক external database access বন্ধ করা হয়েছে।   |

## ইতিমধ্যে নেওয়া সিদ্ধান্ত

1. প্রথম online provider হবে **bKash**; **Nagad পরে** যুক্ত হবে। Merchant account এখনও খোলা হয়নি। ব্যবহারকারীর সর্বশেষ নির্দেশ অনুযায়ী **gateway কাজ আপাতত deferred**; merchant ছাড়া security, recovery ও quality কাজ আগে হবে।
2. আবেদন অনুমোদন করতে পৃথক চেয়ারম্যান/অনুমোদনকারীর account ও প্রযোজ্য authorization লাগবে।
3. ইউনিয়নভিত্তিক processing fee ও সরকারি service fee আলাদা থাকবে; software subscription/credits-এর হিসাবও আলাদা।
4. বর্তমান adapter একটি deployment-এ **একটি নির্দিষ্ট অফিসের merchant configuration** সমর্থন করে। সব ইউনিয়নের টাকা একই account-এ নেওয়ার অনুমোদন ধরে নেওয়া হয়নি।
5. Phase 0 audit evidence এবং ৪৭-service matrix ধরে স্বাধীন implementation চলবে; অনুপস্থিত reference evidence অনুমান দিয়ে পূরণ করা হবে না।
6. এই increment-এর test ও live update অনুমোদিত। Gateway activation, merchant application বা paid hosting purchase এই অনুমোদনের অন্তর্ভুক্ত নয়।

## এখনকার অগ্রাধিকার — merchant account-এর জন্য অপেক্ষা নয়

| ক্রম           | বাকি কাজ                                                                                                        | শেষ হওয়ার মানদণ্ড                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 · প্রথম     | Hosted database-এর পূর্ণ protected export, পৃথক key custody, offsite storage ও isolated restore; স্থায়ী hosting | **১২ নভেম্বর ২০২৬**-এর recorded expiry-এর আগে বর্তমান expiry যাচাই, পূর্ণ tenant/PDF/ledger preservation, restore readback এবং অনুমোদিত hosting/cutover। বর্তমান local PASS এই কাজ সম্পন্ন হওয়ার প্রমাণ নয়। |
| P0 · এরপর      | MFA, privileged owner/admin recovery, access review ও durable owner security audit                              | অনুমোদিত recovery policy, positive/negative role tests, audited recovery ও operator runbook; 0.6-এর session controls MFA নয়।                                                                                |
| P0 · এরপর      | Attachment quarantine/malware scanning, private storage, encryption/key separation ও retention                  | Scan না হওয়া file download বন্ধ, tenant/owner isolation, scanner failure policy, restore/retention tests।                                                                                                   |
| P1             | Monitoring, incident/rollback procedure, shared rate limiting ও recurring backup alerts                         | স্বাস্থ্য/backup failure detection, পরীক্ষিত response/restore procedure; restart/replica-safe limiter।                                                                                                      |
| P1             | Accessibility, বড় dataset/load tests ও authenticated workspace bundle                                           | Screen-reader/contrast/keyboard acceptance, measured capacity; প্রায় ৬৪৬ KB workspace chunk আরও ভাগ করা। Public bundle-এর প্রথম optimization সম্পন্ন।                                                       |
| অফিসের ইনপুটসহ | ৪৭ সেবার official rules, identity/OTP, signatory/fees ও geography gaps                                          | দায়িত্বপ্রাপ্ত অফিস/প্রযোজ্য provider-এর অনুমোদিত rules ও acceptance; ততদিন DEMO সীমা বজায়।                                                                                                                 |

বিস্তারিত owner/dependency ও definition of done: [বর্তমান backlog](DELIVERY_BACKLOG.md)।

0.8-এর source-এ MFA ও managed recovery implementation/test সম্পন্ন হলেও ওপরের operational gates পুরোপুরি বন্ধ হয়নি। পরের engineering milestone: file quarantine, scan ব্যর্থ হলে download বন্ধ রাখা এবং পরীক্ষিত scan-state workflow; scanner/storage ও retention policy আলাদাভাবে নির্ধারণ করতে হবে। Offsite backup/key custody এবং ১২ নভেম্বরের আগে স্থায়ী hosting-ও বাকি।

## Deferred — payment gateway পরে যেভাবে শুরু হবে

নিচের onboarding, provider recovery ও live collection ধাপগুলো ভবিষ্যতের জন্য সংরক্ষিত। বর্তমান কাজ এগুলো শুরু করার অনুমতি নয়; hosted checkout disabled থাকবে।

| ক্রম | কাজ                                                                                               | কার ইনপুট/কাজ                                   | শেষ হওয়ার প্রমাণ                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1    | কে টাকা গ্রহণ করবে নির্ধারণ: software company, ইউনিয়ন/অফিস, merchant ও settlement bank-এর সম্পর্ক | মালিক/দায়িত্বপ্রাপ্ত অফিস + bKash merchant team | অনুমোদিত collection/settlement arrangement; কোন fee কার account-এ যাবে স্পষ্ট                                                 |
| 2    | bKash Online Business/Payment Gateway আবেদন ও onboarding                                          | মালিক/প্রতিষ্ঠানের অনুমোদিত প্রতিনিধি           | প্রযোজ্য KYC, documents, agreement, charges ও merchant approval                                                               |
| 3    | Sandbox access ও বর্তমান integration/acceptance checklist সংগ্রহ                                  | bKash team + developer                          | সঠিক v2 environment, API credentials, merchant identity ও callback requirements নিশ্চিত                                       |
| 4    | Pending/failed/expired/unknown attempt recovery ও replacement checkout তৈরি                       | Developer                                       | পুনরায় টাকা কাটার ঝুঁকি ছাড়া recovery; concurrent retry ও timeout tests; operational runbook                                  |
| 5    | প্রকৃত bKash sandbox-এ সম্পূর্ণ end-to-end acceptance                                             | Developer + merchant team                       | Success/cancel/failure/timeout, Query/Search, duplicate callback, এক receipt, approval/credit invariants-এর সংরক্ষিত evidence |
| 6    | Live collection-এর আগের operational readiness সম্পন্ন                                             | মালিক + developer + provider                    | স্থায়ী hosting/backups, monitoring, প্রযোজ্য provider notification/IPN ও refund/reconciliation process, অনুমোদিত fee/terms    |
| 7    | Production credentials ও go-live clearance অনুযায়ী নিয়ন্ত্রিত live verification                   | অনুমোদিত account holder + developer             | প্রকৃত transaction, receipt ও settlement যাচাই; এরপর সীমিত pilot                                                              |

### bKash আবেদন করার নোট

আবেদনের অফিসিয়াল লিংক: [Online Business](https://www.bkash.com/en/business/online-business)। [Merchant form](https://www.bkash.com/en/business/merchant) এবং [Corporate & Enterprise](https://www.bkash.com/en/business/corporate-enterprise) সেবাও আছে; ইউনিয়ন/প্রাতিষ্ঠানিক ব্যবহারের উপযুক্ত category bKash-কে নিশ্চিত করতে হবে।

প্রতিষ্ঠানের নাম/ঠিকানা/ধরন, যোগাযোগকারীর মোবাইল/ইমেইল, website URL, NID, trade license-এর তথ্য ও ব্যাংক হিসাবের তথ্য প্রস্তুত রাখুন। অফিসিয়াল ফর্ম এসব তথ্য বা এগুলো আছে কি না জানতে চায়; এটি সব প্রতিষ্ঠানের জন্য চূড়ান্ত document checklist নয়। TIN/BIN, institutional registration বা authorization letter লাগবে কি না merchant team-এর কাছ থেকে নিশ্চিত করতে হবে।

Additional Information-এর খসড়া:

> আমরা Astra নামে একাধিক ইউনিয়ন/অফিসের নাগরিক সেবা পরিচালনার সফটওয়্যার তৈরি করছি। bKash Payment Gateway API ও sandbox access প্রয়োজন। অনুগ্রহ করে প্রযোজ্য merchant onboarding, প্রয়োজনীয় কাগজপত্র, ইউনিয়নভিত্তিক collection/settlement ব্যবস্থা, charges এবং approval process জানান। বর্তমান ওয়েবসাইটটি পরীক্ষামূলক সংস্করণ।

API configuration-এর জন্য bKash-issued username, password, app_key ও app_secret লাগবে; এগুলো wallet PIN/OTP নয়। Credentials GitHub, frontend, chat বা screenshots-এ রাখা যাবে না—server-side secret settings-এ থাকবে। [bKash Grant Token](https://developer.bka.sh/docs/grant-token), [token management](https://developer.bka.sh/docs/token-managment-v2)।

নির্দিষ্ট approval সময়, বিনামূল্যে API বা নির্দিষ্ট MDR ধরে budget করা হয়নি। Transaction charge, VAT, settlement সময়, refund charge ও acceptance process লিখিতভাবে নিশ্চিত করতে হবে। সহায়তা: [bKash যোগাযোগ](https://www.bkash.com/en/customer-service/contact-us), 16247। [Onboarding overview](https://developer.bka.sh/docs/product-overview) ও [without-agreement checkout](https://developer.bka.sh/docs/tokenized-without-agreement) ১৯ অক্টোবরের guidance-এর ভিত্তি; কাজ শুরুর সময় সর্বশেষ contract আবার পড়তে হবে।

## পরের milestones ও বহির্ভরতা

| অগ্রাধিকার                        | বাকি কাজ                                                                                                | শেষ হওয়ার মানদণ্ড                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| জরুরি, gateway-এর জন্য অপেক্ষা নয় | Render Free PostgreSQL-এর মেয়াদ **১২ নভেম্বর ২০২৬**; backup/export ও স্থায়ী hosting পরিকল্পনা           | মেয়াদের আগে data preservation, restore test ও মালিকের অনুমোদিত hosting ব্যবস্থা। বর্তমান নথি paid plan কেনার অনুমতি নয়।     |
| প্রকৃত ব্যবহার শুরুর আগে          | প্রতিটি সেবার form, wording, fee, eligibility, signatory ও issuing authority অফিস দিয়ে যাচাই            | দায়িত্বপ্রাপ্ত অফিসের অনুমোদিত/versioned rules এবং pilot acceptance; শুধু DEMO লেখা সরানো নয়                                |
| প্রকৃত ব্যবহার শুরুর আগে          | Identity/OTP, attachment quarantine/malware scanning, private storage, retention, encryption ও recovery | অনুমোদিত provider/storage-এ positive ও negative security tests, backup restore evidence                                     |
| Deferred                          | Multi-union merchant configuration ও token/transaction isolation                                        | প্রতিটি অফিসের অনুমোদিত merchant mapping, cross-tenant tests, পুরোনো payment-এর merchant পরিচয় অক্ষত                        |
| Deferred                          | Nagad                                                                                                   | Merchant-issued বর্তমান API contract, পৃথক adapter ও প্রকৃত sandbox acceptance; শুধু button যোগ নয়                          |
| Deferred                          | Bank settlement, gateway charge/VAT, refund/dispute ও accounting                                        | Provider/bank statement-এর সাথে gross/fee/net মিল, discrepancy queue, audit trail ও অর্থ বিভাগের acceptance                 |
| Deferred                          | বাণিজ্যিক SaaS subscription/top-up                                                                      | অনুমোদিত pricing, actual provider settlement, credit posting idempotency, refund/credit adjustment policy                   |
| P1                                | SMS/email, delivery status ও background jobs                                                            | Provider contract, retry/outbox processing, duplicate prevention, delivery receipt ও failure alerts                         |
| P0, উপরে অগ্রাধিকারপ্রাপ্ত        | MFA, privileged account recovery, access review ও multi-office switching                                | Role-based positive/negative tests, support runbook ও audited recovery; 0.6 session control দিয়ে এই gate বন্ধ হয়নি          |
| P1                                | Performance, accessibility, monitoring ও incident response                                              | বাস্তবসম্মত load/large-data tests, screen-reader/contrast checks, alerts, restore/rollback drill                            |
| P2                                | Reference-parity ও service-specific gaps                                                                | [Process parity](PROCESS_PARITY.md)-র বাকি address/coupon/holding/স্থানীয় workflow বিষয়গুলো অফিসের evidence অনুযায়ী সম্পন্ন |

## কাজ পুনরায় শুরু করার নির্দেশনা

1. এই নথি, [current backlog](DELIVERY_BACKLOG.md), [account security](ACCOUNT_SECURITY.md) ও [recovery runbook](BACKUP_AND_RECOVERY.md) পড়ুন। Phase 0 audit পুনরাবৃত্তি করবেন না।
2. Git branch/commit, Render-এর বর্তমান runtime ও database health/expiry যাচাই করুন। Candidate/local PASS-কে live deployment ভাববেন না; সংরক্ষিত ফলকে নতুন test run বলা যাবে না।
3. Merchant account ছাড়াই অগ্রাধিকারক্রমে hosted export/independent restore, durable hosting, MFA/recovery ও file protection এগিয়ে নিন। Gateway deferred এবং checkout disabled থাকবে।
4. Gateway পরে শুরু হলে [gateway contract](GATEWAY_PAYMENTS.md) পড়ুন; one-attempt-per-application, cancelled/unknown-create recovery ও এক configured tenant-এর সীমা আগে সমাধান করুন। শুধু API key বসিয়ে collection চালু করবেন না।
5. পরিবর্তনের উপযুক্ত tests, CI, migration preservation ও deployment verification রেকর্ড করুন। আগের release evidence overwrite না করে আলাদা evidence file রাখুন।
6. কাজের ফল, বাকি সীমা ও next milestone এই নথি ও backlog-এ হালনাগাদ করে source commit/push করুন; runtime deployment আলাদাভাবে যাচাই করুন।

**পরবর্তী বাস্তব milestone:** পূর্ণ hosted export + independent protected restore + expiry-এর আগে অনুমোদিত durable hosting/cutover; এরপর MFA/privileged recovery ও file protection। Gateway কাজ deferred।
