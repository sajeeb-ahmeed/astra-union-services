# Service 45: স্থায়ী বাসিন্দা সনদ / Permanent resident certificate

> Pre-filled from Astra's current schema. Check every row against the reference form while signed in with the [synthetic citizen](../SYNTHETIC-CITIZEN-SPEC.md), following the [capture rules](../README.md#capture-rules). In **Check**, write ✅, a correction, or `?`. Add rows for anything Astra lacks.

## Header

| Item | Value |
| --- | --- |
| Astra schema | version 1, stage `operational_demo`, evidence `proposed` |
| Reference form family | `common_order_payment` (1 form(s)) |
| Reference path pattern | `/portal/udcUser/application/create/{user_track_id}/{certificate_id}` |
| Captured by / date | |
| Account type used | |
| Menu path to the form | |

## 1. Fields

Astra's fields in display order. *Reference field name* is the input name recorded in the October 2026 baseline. *Evidence* is Astra's own confidence: `proposed` and `inferred` both still need checking.

| Astra field | Reference field name | Label BN | Label EN | Type | Required? | Options (Astra; verify verbatim) | Limits | Repeatable? | Shown when | Evidence | Check |
| ----------- | -------------------- | -------- | -------- | ---- | --------- | -------------------------------- | ------ | ----------- | ---------- | -------- | ----- |
| **Residence details** | | বাসিন্দার তথ্য | | section | | | | | | | |
| permanent_address_bn |  | স্থায়ী ঠিকানা (বাংলা) | Permanent address (Bangla) | textarea | yes |  | minLength 2; maxLength 1000 |  |  |  |  |
| permanent_address_en |  | স্থায়ী ঠিকানা (ইংরেজি) | Permanent address (English) | textarea | yes |  | minLength 2; maxLength 1000 |  |  |  |  |
| residence_since |  | বসবাস শুরুর তারিখ | Resident since | date | yes |  |  |  |  |  |  |
| purpose_bn |  | আবেদনের উদ্দেশ্য (বাংলা) | Purpose (Bangla) | text | yes |  | minLength 2; maxLength 500 |  |  |  |  |
| purpose_en |  | আবেদনের উদ্দেশ্য (ইংরেজি) | Purpose (English) | text | yes |  | minLength 2; maxLength 500 |  |  |  |  |
| **Language and declaration** | | ভাষা ও ঘোষণা | | section | | | | | | | |
| delivery_language |  | সনদের ভাষা | Certificate language | select | yes | বাংলা / Bangla; ইংরেজি / English; দ্বিভাষিক / Bilingual |  |  |  |  |  |
| confirmation |  | প্রদত্ত তথ্য সঠিক এবং এটি পরীক্ষামূলক আবেদন | I confirm the information is correct and this is a demo application. | checkbox | yes |  |  |  |  |  |  |

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
