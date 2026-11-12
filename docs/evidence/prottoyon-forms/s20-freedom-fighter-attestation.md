# Service 20: মুক্তিযোদ্ধা প্রত্যয়ন / Freedom fighter attestation

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
| other_freedom_fighter | other_freedom_fighter | অন্য মুক্তিযোদ্ধার পক্ষে আবেদন | Apply in relation to another freedom fighter | checkbox | yes |  |  |  |  | inferred |  |
| other_freedom_fighter_name | other_freedom_fighter_name | মুক্তিযোদ্ধার নাম (ইংরেজিতে) | Other freedom fighter name | text | yes |  | minLength 2; maxLength 250 |  | other_freedom_fighter = true | inferred |  |
| other_freedom_fighter_name_bn | other_freedom_fighter_name_bn | মুক্তিযোদ্ধার নাম (বাংলায়) | Other freedom fighter name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  | other_freedom_fighter = true | inferred |  |
| other_freedom_fighter_relation | other_freedom_fighter_relation | সম্পর্ক (আপনি মুক্তিযোদ্ধার কি হন?) | Other freedom fighter relation | select | yes | নিজ / Self; স্বামী/স্ত্রী / Spouse; সন্তান / Child; পিতা/মাতা / Parent; ভাই/বোন / Sibling; অন্যান্য / Other |  |  | other_freedom_fighter = true | inferred |  |
| freedom_fighter_id_number | freedom_fighter_id_number | পরিচিতি নম্বর | Identification reference | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| freedom_fighter_batch_number | freedom_fighter_batch_number | ব্যাচ নম্বর | Batch reference | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| freedom_fighter_certificate_number | freedom_fighter_certificate_number | সনদ নম্বর | Certificate reference | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| freedom_fighter_certificate_given_date | freedom_fighter_certificate_given_date | সনদ প্রদানের তারিখ | Certificate issue date | date | no |  |  |  |  | inferred |  |
| freedom_fighter_muktibarta_number | freedom_fighter_muktibarta_number | মুক্তিবার্তা নম্বর | Muktibarta reference | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| freedom_fighter_indian_gazette | freedom_fighter_indian_gazette | ভারতীয় গেজেট নম্বর | Indian gazette reference | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| freedom_fighter_gazette_option | freedom_fighter_gazette_option | গেজেটের ধরন | Gazette category | select | yes | বেসামরিক / Civil; সামরিক / Military; অন্যান্য / Other |  |  |  | inferred |  |
| freedom_fighter_gazette_number | freedom_fighter_gazette_number | গেজেট নম্বর | Gazette reference | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
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
