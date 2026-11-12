# Service 47: বিবিধ সনদ / Miscellaneous certificate

> Pre-filled from Astra's current schema. Check every row against the reference form while signed in with the [synthetic citizen](../SYNTHETIC-CITIZEN-SPEC.md), following the [capture rules](../README.md#capture-rules). In **Check**, write ✅, a correction, or `?`. Add rows for anything Astra lacks.

## Header

| Item | Value |
| --- | --- |
| Astra schema | version 2, stage `operational_demo`, evidence `proposed` |
| Reference form family | `common_order_payment` (1 form(s)) |
| Reference path pattern | `/portal/udcUser/application/create/{user_track_id}/{certificate_id}` |
| Captured by / date | |
| Account type used | |
| Menu path to the form | |

## 1. Fields

Astra's fields in display order. *Reference field name* is the input name recorded in the October 2026 baseline. *Evidence* is Astra's own confidence: `proposed` and `inferred` both still need checking.

| Astra field | Reference field name | Label BN | Label EN | Type | Required? | Options (Astra; verify verbatim) | Limits | Repeatable? | Shown when | Evidence | Check |
| ----------- | -------------------- | -------- | -------- | ---- | --------- | -------------------------------- | ------ | ----------- | ---------- | -------- | ----- |
| **Service details** | | সেবার তথ্য | | section | | | | | | | |
| application_prottoyon_for | application_prottoyon_for | বিবিধ সনদপত্র নেয়ার কারণ | Application prottoyon for | select | yes | শিক্ষা / Education; কর্মসংস্থান / Employment; প্রশাসনিক / Administrative; অন্যান্য / Other |  |  |  | inferred |  |
| certificate_type_bn | certificate_type_bn | ধরণ / সনদের নাম (বাংলায়) | Certificate type (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| certificate_details_bn | certificate_details_bn | বিস্তারিত (বাংলায়) | Certificate details (Bangla) | textarea | yes |  | minLength 2; maxLength 2000 |  |  | inferred |  |
| certificate_footer_bn | certificate_footer_bn | পরিশেষ (বাংলায়) | Certificate footer (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| certificate_type_en | certificate_type_en | ধরণ / সনদের নাম (ইংরেজিতে) | Certificate type (English) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| certificate_details_en | certificate_details_en | বিস্তারিত (ইংরেজিতে) | Certificate details (English) | textarea | yes |  | minLength 2; maxLength 2000 |  |  | inferred |  |
| certificate_footer_en | certificate_footer_en | পরিশেষ (ইংরেজিতে) | Certificate footer (English) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
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
