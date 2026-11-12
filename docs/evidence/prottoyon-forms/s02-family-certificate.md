# Service 2: পারিবারিক সনদ / Family certificate

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
| **Household** | | পরিবারের বিবরণ | | section | | | | | | | |
| household_name_bn | warish_info_name_bn | পরিবার প্রধানের নাম (বাংলা) | Household head name (Bangla) | text | yes |  | minLength 2; maxLength 200 |  |  | inferred |  |
| household_name_en | warish_info_name | পরিবার প্রধানের নাম (ইংরেজি) | Household head name (English) | text | yes |  | minLength 2; maxLength 200 |  |  | inferred |  |
| **Family members** | | পরিবারের সদস্য | | section | | | | | | | |
| members | warish_heir_name[], warish_heir_name_bn[], warish_heir_relation[], warish_heir_dob[], warish_heir_mobile_no[] | সদস্য তালিকা | Members | repeatable | yes |  |  | rows 1–30 |  | inferred |  |
| members ↳ name_bn | warish_heir_name_bn[] | সদস্যের নাম (বাংলা) | Member name (Bangla) | text | yes |  | minLength 2; maxLength 200 |  |  | inferred |  |
| members ↳ name_en | warish_heir_name[] | সদস্যের নাম (ইংরেজি) | Member name (English) | text | yes |  | minLength 2; maxLength 200 |  |  | inferred |  |
| members ↳ relationship | warish_heir_relation[] | সম্পর্ক | Relationship | select | yes | নিজ / Self; স্বামী/স্ত্রী / Spouse; সন্তান / Child; পিতা/মাতা / Parent; ভাই/বোন / Sibling; অন্যান্য / Other |  |  |  | inferred |  |
| members ↳ dob | warish_heir_dob[] | জন্ম তারিখ | Date of birth | date | yes |  |  |  |  | inferred |  |
| members ↳ is_minor | warish_heir_age_flag[] | অপ্রাপ্তবয়স্ক | Minor | checkbox | yes |  |  |  |  | inferred |  |
| members ↳ guardian_name_bn |  | অভিভাবকের নাম (বাংলা) | Guardian name (Bangla) | text | yes |  | minLength 2; maxLength 200 |  | is_minor = true |  |  |
| members ↳ mobile | warish_heir_mobile_no[] | মোবাইল নম্বর | Mobile number | text | no |  | maxLength 11; pattern ^01[0-9]{9}$ |  |  | inferred |  |
| members ↳ attachments |  | সহায়ক নথি | Supporting documents | repeatable | no |  |  | rows 0–5 |  |  |  |
| members ↳ attachments ↳ description |  | নথির বিবরণ | Document description | text | yes |  | minLength 2; maxLength 150 |  |  |  |  |
| members ↳ attachments ↳ file |  | নথি | Document | attachment | yes |  |  |  |  |  |  |
| members ↳ warish_heir_nid | warish_heir_nid[] | পরিচয় নথির নমুনা পরিচিতি | Demo identity reference | text | no |  | minLength 2; maxLength 250 |  | is_minor = false | inferred |  |
| members ↳ warish_heir_father_name | warish_heir_father_name[] | পিতার নাম (ইংরেজি) | Father name (English) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| members ↳ warish_heir_comment | warish_heir_comment[] | মন্তব্য (বাংলা) | Comment (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| members ↳ warish_heir_comment_en | warish_heir_comment_en[] | মন্তব্য (ইংরেজি) | Comment (English) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| confirmation |  | প্রদত্ত তথ্য সঠিক এবং এটি পরীক্ষামূলক আবেদন | I confirm the information is correct and this is a demo application. | checkbox | yes |  |  |  |  |  |  |
| **Additional household head details** | | পরিবার প্রধানের অতিরিক্ত তথ্য | | section | | | | | | | |
| warish_info_father_name | warish_info_father_name | পিতার নাম (ইংরেজি) | Father name (English) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| warish_info_father_name_bn | warish_info_father_name_bn | পিতার নাম (বাংলা) | Father name (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| warish_info_mother_name | warish_info_mother_name | মাতার নাম (ইংরেজি) | Mother name (English) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| warish_info_mother_name_bn | warish_info_mother_name_bn | মাতার নাম (বাংলা) | Mother name (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| warish_info_spouse_name | warish_info_spouse_name | স্বামী/স্ত্রীর নাম (ইংরেজি) | Spouse name (English) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| warish_info_spouse_name_bn | warish_info_spouse_name_bn | স্বামী/স্ত্রীর নাম (বাংলা) | Spouse name (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| warish_info_dod | warish_info_dod | মৃত্যুর তারিখ | Date of death | date | no |  |  |  |  | inferred |  |
| warish_info_register_no | warish_info_register_no | নিবন্ধনের নমুনা নম্বর | Demo registration reference | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |

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
