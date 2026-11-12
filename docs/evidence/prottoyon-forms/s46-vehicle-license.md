# Service 46: যানবাহন লাইসেন্স / Vehicle license

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
| transport_license_proprietor_bn | transport_license_proprietor_bn | মালিক/স্বত্ত্বাধিকারীর নাম (বাংলায়) | Transport license proprietor (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| transport_license_proprietor | transport_license_proprietor | মালিক/স্বত্ত্বাধিকারীর নাম (ইংরেজিতে) | Transport license proprietor | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_father_name_bn | proprietor_father_name_bn | পিতার নাম (বাংলায়) | Proprietor father name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_father_name | proprietor_father_name | পিতার নাম (ইংরেজিতে) | Proprietor father name | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_mother_name_bn | proprietor_mother_name_bn | মাতার নাম (বাংলায়) | Proprietor mother name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_mother_name | proprietor_mother_name | মাতার নাম (ইংরেজিতে) | Proprietor mother name | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_spouse_name_bn | proprietor_spouse_name_bn | স্বামী/স্ত্রীর নাম (বাংলায়) | Proprietor spouse name (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_spouse_name | proprietor_spouse_name | স্বামী/স্ত্রীর নাম (ইংরেজিতে) | Proprietor spouse name | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| transport_license_email | transport_license_email | ইমেইল | Transport license email | text | no |  | maxLength 254; pattern ^[^\s@]+@[^\s@]+\.[^\s@]+$ |  |  | inferred |  |
| transport_license_mobile | transport_license_mobile | মোবাইল নম্বর | Transport license mobile | text | no |  | maxLength 11; pattern ^01[0-9]{9}$ |  |  | inferred |  |
| transport_license_transport_name_bn | transport_license_transport_name_bn | যানবাহনের নাম (বাংলায়) | Transport license transport name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| transport_license_transport_name | transport_license_transport_name | যানবাহনের নাম (ইংরেজিতে) | Transport license transport name | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| transport_license_no | transport_license_no | লাইসেন্স নম্বর (ইংরেজিতে) | Transport license number | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| transport_license_engine_no | transport_license_engine_no | ইঞ্জিন নম্বর (ইংরেজিতে) | Transport license engine number | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| transport_license_horse_power | transport_license_horse_power | হর্স পাওয়ার বা অশ্বশক্তি সংখ্যায় (ইংরেজিতে) | Transport license horse power | number | no |  | min 0; max 1000000000 |  |  | inferred |  |
| transport_license_capacity | transport_license_capacity | ধারণ ক্ষমতা | Transport license capacity | number | no |  | min 0; max 1000000000 |  |  | inferred |  |
| transport_license_weight | transport_license_weight | ওজন সংখ্যায় (ইংরেজিতে) | Transport license weight | number | no |  | min 0; max 1000000000 |  |  | inferred |  |
| transport_license_length | transport_license_length | দৈর্ঘ্য সংখ্যায় (ইংরেজিতে) | Transport license length | number | no |  | min 0; max 1000000000 |  |  | inferred |  |
| transport_license_width | transport_license_width | প্রস্থ সংখ্যায় (ইংরেজিতে) | Transport license width | number | no |  | min 0; max 1000000000 |  |  | inferred |  |
| transport_license_height | transport_license_height | বাগা | Transport license height | number | no |  | min 0; max 1000000000 |  |  | inferred |  |
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
