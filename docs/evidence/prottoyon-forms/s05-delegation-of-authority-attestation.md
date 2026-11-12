# Service 5: ক্ষমতা অর্পণ প্রত্যয়ন / Delegation of authority attestation

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
| authority_delegation_letter_type | authority_delegation_letter_type | ক্ষমতা অর্পণকারী | Authority delegation letter type | select | yes | ব্যক্তি / Individual; প্রতিষ্ঠান / Organization |  |  |  | inferred |  |
| authority_delegation_letter_subject | authority_delegation_letter_subject | ক্ষমতা অর্পণপত্র বিষয় | Authority delegation letter subject | select | yes | নথি সংগ্রহ / Document collection; প্রতিনিধিত্ব / Representation; অন্যান্য / Other |  |  |  | inferred |  |
| authority_delegation_letter_name_bn | authority_delegation_letter_name_bn | ক্ষমতা গ্রহণকারীর নাম (বাংলা) | Delegate name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| authority_delegation_letter_name_en | authority_delegation_letter_name_en | ক্ষমতা গ্রহণকারীর নাম (ইংরেজি) | Delegate name (English) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| authority_delegation_letter_father_name_bn | authority_delegation_letter_father_name_bn | ক্ষমতা গ্রহণকারীর পিতার নাম (বাংলা) | Delegate father name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| authority_delegation_letter_father_name_en | authority_delegation_letter_father_name_en | ক্ষমতা গ্রহণকারীর পিতার নাম (ইংরেজি) | Delegate father name (English) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| heirs | warish_heir_age_flag[], warish_heir_nid[], warish_heir_dob[], warish_heir_relation[], warish_heir_name[], warish_heir_name_bn[], dead_person_name[], warish_heir_mobile_no[], warish_heir_comment[], warish_heir_comment_en[] | সংশ্লিষ্ট ব্যক্তিদের তালিকা | Related people | repeatable | yes |  |  | rows 1–30 |  | inferred |  |
| heirs ↳ warish_heir_age_flag | warish_heir_age_flag[] | বয়সের শ্রেণি | Age category | select | yes | প্রাপ্তবয়স্ক / Adult; অপ্রাপ্তবয়স্ক / Minor |  |  |  | inferred |  |
| heirs ↳ warish_heir_nid | warish_heir_nid[] | পরিচয় নথির নমুনা পরিচিতি | Demo identity reference | text | no |  | minLength 2; maxLength 250 |  | warish_heir_age_flag = "adult" | inferred |  |
| heirs ↳ warish_heir_dob | warish_heir_dob[] | জন্ম তারিখ | Date of birth | date | yes |  |  |  |  | inferred |  |
| heirs ↳ warish_heir_relation | warish_heir_relation[] | সম্পর্ক | Relationship | select | yes | নিজ / Self; স্বামী/স্ত্রী / Spouse; সন্তান / Child; পিতা/মাতা / Parent; ভাই/বোন / Sibling; অন্যান্য / Other |  |  |  | inferred |  |
| heirs ↳ warish_heir_name | warish_heir_name[] | নাম (ইংরেজি) | Name (English) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| heirs ↳ warish_heir_name_bn | warish_heir_name_bn[] | নাম (বাংলা) | Name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| heirs ↳ dead_person_name | dead_person_name[] | সংশ্লিষ্ট মৃত ব্যক্তির নাম | Related deceased person name | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| heirs ↳ warish_heir_mobile_no | warish_heir_mobile_no[] | মোবাইল নম্বর | Mobile number | text | no |  | maxLength 11; pattern ^01[0-9]{9}$ |  |  | inferred |  |
| heirs ↳ warish_heir_comment | warish_heir_comment[] | মন্তব্য (বাংলা) | Comment (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| heirs ↳ warish_heir_comment_en | warish_heir_comment_en[] | মন্তব্য (ইংরেজি) | Comment (English) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| heirs ↳ guardian_name |  | অপ্রাপ্তবয়স্কের অভিভাবকের নাম | Minor guardian name | text | yes |  | minLength 2; maxLength 500 |  | warish_heir_age_flag = "minor" | proposed |  |
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
