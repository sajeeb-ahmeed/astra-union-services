# Service 25: বিবাহিত প্রত্যয়ন / Married attestation

> Pre-filled from Astra's current schema. Check every row against the reference form while signed in with the [synthetic citizen](../SYNTHETIC-CITIZEN-SPEC.md), following the [capture rules](../README.md#capture-rules). In **Check**, write ✅, a correction, or `?`. Add rows for anything Astra lacks.

## Header

| Item | Value |
| --- | --- |
| Astra schema | version 2, stage `operational_demo`, evidence `proposed` |
| Reference form family | `specialist_additional_information` (1 form(s)) |
| Reference path pattern | `/portal/udcUser/application/additional-information/create/{user_track_id}/{certificate_id}` |
| Captured by / date | |
| Account type used | |
| Menu path to the form | |

## 1. Fields

Astra's fields in display order. *Reference field name* is the input name recorded in the October 2026 baseline. *Evidence* is Astra's own confidence: `proposed` and `inferred` both still need checking.

| Astra field | Reference field name | Label BN | Label EN | Type | Required? | Options (Astra; verify verbatim) | Limits | Repeatable? | Shown when | Evidence | Check |
| ----------- | -------------------- | -------- | -------- | ---- | --------- | -------------------------------- | ------ | ----------- | ---------- | -------- | ----- |
| **Service details** | | সেবার তথ্য | | section | | | | | | | |
| marriage_info_spouse_name | marriage_info_spouse_name | স্বামী/স্ত্রীর নাম (ইংরেজি) | Spouse name (English) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| marriage_info_spouse_name_bn | marriage_info_spouse_name_bn | স্বামী/স্ত্রীর নাম (বাংলা) | Spouse name (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| marriage_info_spouse_age_flag | marriage_info_spouse_age_flag | স্বামী/স্ত্রীর বয়সের শ্রেণি | Spouse age category | select | yes | প্রাপ্তবয়স্ক / Adult; অপ্রাপ্তবয়স্ক / Minor |  |  |  | inferred |  |
| marriage_info_spouse_nid | marriage_info_spouse_nid | স্বামী/স্ত্রীর পরিচয় নথির নমুনা পরিচিতি | Spouse demo identity reference | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| marriage_info_spouse_dob | marriage_info_spouse_dob | স্বামী/স্ত্রীর জন্ম তারিখ | Spouse date of birth | date | yes |  |  |  |  | inferred |  |
| marriage_info_spouse_place | marriage_info_spouse_place | বিবাহের স্থান (ইংরেজি) | Marriage place (English) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| marriage_info_spouse_place_bn | marriage_info_spouse_place_bn | বিবাহের স্থান (বাংলা) | Marriage place (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| marriage_info_date | marriage_info_date | বিবাহের তারিখ | Marriage date | date | yes |  |  |  |  | inferred |  |
| supporting_documents |  | সহায়ক নথি | Supporting documents | repeatable | no |  |  | rows 0–5 |  | proposed |  |
| supporting_documents ↳ description |  | নথির বিবরণ | Document description | text | yes |  | minLength 2; maxLength 150 |  |  | proposed |  |
| supporting_documents ↳ file |  | নথি | Document | attachment | yes |  |  |  |  | proposed |  |
| **Purpose and language** | | আবেদনের উদ্দেশ্য ও ভাষা | | section | | | | | | | |
| address_source |  | প্রযোজ্য ঠিকানা | Applicable citizen address | select | yes | স্থায়ী ঠিকানা / Permanent address; বর্তমান ঠিকানা / Present address |  |  |  | proposed |  |
| purpose_bn |  | আবেদনের উদ্দেশ্য (বাংলা) | Purpose (Bangla) | text | yes |  | minLength 2; maxLength 500 |  |  | proposed |  |
| purpose_en |  | আবেদনের উদ্দেশ্য (ইংরেজি) | Purpose (English) | text | yes |  | minLength 2; maxLength 500 |  |  | proposed |  |
| delivery_language |  | নথির ভাষা | Document language | select | yes | দ্বিভাষিক / Bilingual; বাংলা / Bangla; ইংরেজি / English |  |  |  | proposed |  |
| confirmation |  | প্রদত্ত তথ্য সঠিক এবং এটি পরীক্ষামূলক আবেদন | I confirm the information is correct and this is a demo application. | checkbox | yes |  |  |  |  | proposed |  |

### Reference field names with no Astra field

None: every baseline field name is claimed by an Astra field.


## 2. Uploads

| Document | Required? | Accepted types | Max size | Count | Notes |
| -------- | --------- | -------------- | -------- | ----- | ----- |

## 3. Checkout controls (before payment)

| Control | Present? | Choices / values | Default | Notes |
| ------- | -------- | ---------------- | ------- | ----- |
| Fee lines (base, service, other) | | | | |
| Delivery (pickup / courier / digital) | | | | |
| Urgency (normal / urgent) and its days | | | | |
| Certificate language (BN / EN / both) | | | | |
| Payment methods shown | | | | |
| Coupon / discount code | | | | |
| Points balance used / deducted | | | | |

## 4. After submission

| Item | What happens |
| ---- | ------------ |
| Success screen (summarise, do not copy prose) | |
| Tracking number format | |
| Status names shown to the applicant | |
| Notifications (SMS / email) observed | |
| Where the application appears afterwards | |

## 5. Notes and open questions
