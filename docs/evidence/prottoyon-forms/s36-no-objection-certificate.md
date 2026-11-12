# Service 36: অনাপত্তি সনদ / No objection certificate

> Pre-filled from Astra's current schema. Check every row against the reference form while signed in with the [synthetic citizen](../SYNTHETIC-CITIZEN-SPEC.md), following the [capture rules](../README.md#capture-rules). In **Check**, write ✅, a correction, or `?`. Add rows for anything Astra lacks.

## Header

| Item | Value |
| --- | --- |
| Astra schema | version 3, stage `operational_demo`, evidence `proposed` |
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
| noc_proprietor_bn | noc_proprietor_bn | স্বত্ত্বাধিকারী/প্রোপাইটর নাম (বাংলায়) | No objection proprietor (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| noc_proprietor | noc_proprietor | স্বত্ত্বাধিকারী/প্রোপাইটর নাম (ইংরেজিতে) | No objection proprietor | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_mother_name_bn | proprietor_mother_name_bn | মাতার নাম (বাংলায়) | Proprietor mother name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_mother_name | proprietor_mother_name | মাতার নাম (ইংরেজিতে) | Proprietor mother name | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_father_name_bn | proprietor_father_name_bn | পিতার নাম (বাংলায়) | Proprietor father name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_father_name | proprietor_father_name | পিতার নাম (ইংরেজিতে) | Proprietor father name | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_spouse_name_bn | proprietor_spouse_name_bn | স্বামী/স্ত্রীর নাম (বাংলায়) | Proprietor spouse name (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_spouse_name | proprietor_spouse_name | স্বামী/স্ত্রীর নাম (ইংরেজিতে) | Proprietor spouse name | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| noc_email | noc_email | ইমেইল | No objection email | text | no |  | maxLength 254; pattern ^[^\s@]+@[^\s@]+\.[^\s@]+$ |  |  | inferred |  |
| noc_mobile | noc_mobile | মোবাইল নম্বর | No objection mobile | text | no |  | maxLength 11; pattern ^01[0-9]{9}$ |  |  | inferred |  |
| noc_org_name_bn | noc_org_name_bn | প্রতিষ্ঠানের নাম (বাংলায়) | No objection organization name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| noc_org_name | noc_org_name | প্রতিষ্ঠানের নাম (ইংরেজিতে) | No objection organization name | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| noc_org_type_bn | noc_org_type_bn | প্রতিষ্ঠানের ধরণ (বাংলায়) | No objection organization type (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| noc_org_type | noc_org_type | প্রতিষ্ঠানের ধরণ (ইংরেজিতে) | No objection organization type | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| noc_org_mouza_name_bn | noc_org_mouza_name_bn | মৌজার নাম (বাংলায়) | No objection organization mouza name (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| noc_org_mouza_name | noc_org_mouza_name | মৌজার নাম (ইংরেজিতে) | No objection organization mouza name | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| noc_org_khatian_no | noc_org_khatian_no | খতিয়ান নং | No objection organization khatian number | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| noc_org_dag_no | noc_org_dag_no | দাগ নং | No objection organization dag number | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| noc_org_land_classification_bn | noc_org_land_classification_bn | জমির ধরণ (বাংলায়) | No objection organization land classification (Bangla) | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| noc_org_land_classification | noc_org_land_classification | জমির ধরণ (ইংরেজিতে) | No objection organization land classification | text | yes |  | minLength 2; maxLength 250 |  |  | inferred |  |
| noc_org_total_area | noc_org_total_area | মোট জমির পরিমাণ সংখ্যায় (ইংরেজিতে) | No objection organization total area | number | yes |  | min 0; max 1000000000 |  |  | inferred |  |
| land_unit | land_unit | জমির পরিমাপের একক | Land area unit | select | yes | শতক / Decimal; একর / Acre; বর্গমিটার / Square metre |  |  |  | inferred |  |
| noc_org_area_holding_bn | noc_org_area_holding_bn | প্রতিষ্ঠানের গ্রাম/হোল্ডিং/এলাকা (বাংলায়) | No objection organization area holding (Bangla) | textarea | yes |  | minLength 2; maxLength 2000 |  |  | inferred |  |
| noc_org_area_holding | noc_org_area_holding | প্রতিষ্ঠানের গ্রাম/হোল্ডিং/এলাকা (ইংরেজিতে) | No objection organization area holding | textarea | yes |  | minLength 2; maxLength 2000 |  |  | inferred |  |
| noc_org_add_type | noc_org_add_type | ঠিকানার ধরণ | No objection organization address type | select | yes | ইউনিয়ন / Union; পৌরসভা / Municipality; সিটি কর্পোরেশন / City corporation |  |  |  | inferred |  |
| org_location | noc_org_division, district_id, thana_id, union_id | প্রতিষ্ঠানের প্রশাসনিক এলাকা | Organization administrative area | geography | yes |  | geographyDepth upazila; union when noc_org_add_type = "union" |  |  | inferred |  |
| additional_thana_id | additional_thana_id | থানা | Additional thana reference | text | no |  | minLength 2; maxLength 150 |  |  | inferred |  |
| post_office_id | post_office_id | ডাকঘর | Post office reference | text | yes |  | minLength 2; maxLength 150 |  |  | inferred |  |
| municipality_id | municipality_id | পৌরসভা | Municipality reference | text | yes |  | minLength 2; maxLength 150 |  | noc_org_add_type = "municipality" | inferred |  |
| city_corporation_id | city_corporation_id | সিটি কর্পোরেশন | City corporation reference | text | yes |  | minLength 2; maxLength 150 |  | noc_org_add_type = "city_corporation" | inferred |  |
| noc_org_ward_no | noc_org_ward_no | ওয়ার্ড নং | No objection organization ward number | number | yes |  | min 1; max 99 |  |  | inferred |  |
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
