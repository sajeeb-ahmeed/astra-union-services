# Service 31: অবিবাহিত অবস্থায় মৃত্যু সনদ / Death while unmarried certificate

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
| dead_info_name | dead_info_name | নাম (ইংরেজি) | Name (English) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| dead_info_name_bn | dead_info_name_bn | নাম (বাংলা) | Name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| dead_info_father_name | dead_info_father_name | পিতার নাম (ইংরেজি) | Father name (English) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| dead_info_father_name_bn | dead_info_father_name_bn | পিতার নাম (বাংলা) | Father name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| dead_info_mother_name | dead_info_mother_name | মাতার নাম (ইংরেজি) | Mother name (English) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| dead_info_mother_name_bn | dead_info_mother_name_bn | মাতার নাম (বাংলা) | Mother name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| dead_info_place | dead_info_place | স্থান (ইংরেজি) | Place (English) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| dead_info_place_bn | dead_info_place_bn | স্থান (বাংলা) | Place (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| dead_info_reason | dead_info_reason | কারণ (ইংরেজি) | Reason (English) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| dead_info_reason_bn | dead_info_reason_bn | কারণ (বাংলা) | Reason (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| optradio | optradio | নিবন্ধন/সহায়ক তথ্য যুক্ত করুন | Include registration or supporting information | checkbox | yes |  |  |  |  | inferred |  |
| dead_info_dod | dead_info_dod | মৃত্যুর তারিখ | Date of death | date | yes |  |  |  |  | inferred |  |
| dead_info_register_no | dead_info_register_no | নিবন্ধনের নমুনা নম্বর | Demo registration reference | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| dead_attachment_religion_id | dead_attachment_religion_id | ধর্ম (ঐচ্ছিক) | Religion (optional) | select | no | উল্লেখ করতে চাই না / Not specified; ইসলাম / Islam; হিন্দু / Hinduism; বৌদ্ধ / Buddhism; খ্রিষ্টান / Christianity; অন্যান্য / Other |  |  |  | inferred |  |
| dead_info_relation | dead_info_relation | সম্পর্ক | Relationship | select | yes | নিজ / Self; স্বামী/স্ত্রী / Spouse; সন্তান / Child; পিতা/মাতা / Parent; ভাই/বোন / Sibling; অন্যান্য / Other |  |  |  | inferred |  |
| supporting_documents | dead_attachment_certificate_id[], dead_attachment_file[] | সহায়ক নথি | Supporting documents | repeatable | no |  |  | rows 0–5 |  | inferred |  |
| supporting_documents ↳ dead_attachment_certificate_id | dead_attachment_certificate_id[] | সহায়ক নথির ধরন | Supporting document type | select | yes | সহায়ক রেকর্ড / Supporting record; ঘোষণা / Declaration |  |  |  | inferred |  |
| supporting_documents ↳ dead_attachment_file | dead_attachment_file[] | সহায়ক নথি | Supporting document | attachment | yes |  |  |  |  | inferred |  |
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
