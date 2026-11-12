# Service 42: ট্রেড লাইসেন্স / Trade license

> Pre-filled from Astra's current schema. Check every row against the reference form while signed in with the [synthetic citizen](../SYNTHETIC-CITIZEN-SPEC.md), following the [capture rules](../README.md#capture-rules). In **Check**, write ✅, a correction, or `?`. Add rows for anything Astra lacks.

## Header

| Item | Value |
| --- | --- |
| Astra schema | version 3, stage `operational_demo`, evidence `proposed` |
| Reference form family | `specialist_additional_information` (2 form(s)) |
| Reference path pattern | `/portal/udcUser/application/additional-information/create/{user_track_id}/{certificate_id}` |
| Captured by / date | |
| Account type used | |
| Menu path to the form | |

## 1. Fields

Astra's fields in display order. *Reference field name* is the input name recorded in the October 2026 baseline. *Evidence* is Astra's own confidence: `proposed` and `inferred` both still need checking.

| Astra field | Reference field name | Label BN | Label EN | Type | Required? | Options (Astra; verify verbatim) | Limits | Repeatable? | Shown when | Evidence | Check |
| ----------- | -------------------- | -------- | -------- | ---- | --------- | -------------------------------- | ------ | ----------- | ---------- | -------- | ----- |
| **Business details** | | প্রতিষ্ঠানের বিবরণ | | section | | | | | | | |
| business_name_bn | trade_license_org_name_bn | প্রতিষ্ঠানের নাম (বাংলা) | Business name (Bangla) | text | yes |  | minLength 2; maxLength 200 |  |  | inferred |  |
| business_name_en | trade_license_org_name | প্রতিষ্ঠানের নাম (ইংরেজি) | Business name (English) | text | yes |  | minLength 2; maxLength 200 |  |  | inferred |  |
| business_type | nature_of_business | ব্যবসার ধরন | Business type | select | yes | খুচরা / Retail; সেবা / Service; উৎপাদন / Manufacturing; অন্যান্য / Other |  |  |  | inferred |  |
| start_date | business_starting_date | ব্যবসা শুরুর তারিখ | Business starting date | date | yes |  |  |  |  | inferred |  |
| **Business location** | | ব্যবসার ঠিকানা | | section | | | | | | | |
| business_address_bn | trade_license_org_area_holding_bn | ব্যবসার ঠিকানা (বাংলা) | Business address (Bangla) | textarea | yes |  | minLength 2; maxLength 1000 |  |  | inferred |  |
| business_address_en | trade_license_org_area_holding | ব্যবসার ঠিকানা (ইংরেজি) | Business address (English) | textarea | yes |  | minLength 2; maxLength 1000 |  |  | inferred |  |
| **Proprietor** | | স্বত্বাধিকারীর তথ্য | | section | | | | | | | |
| proprietor_name_bn | trade_license_proprietor_bn | স্বত্বাধিকারীর নাম (বাংলা) | Proprietor name (Bangla) | text | yes |  | minLength 2; maxLength 200 |  |  | inferred |  |
| proprietor_name_en | trade_license_proprietor | স্বত্বাধিকারীর নাম (ইংরেজি) | Proprietor name (English) | text | yes |  | minLength 2; maxLength 200 |  |  | inferred |  |
| mobile | trade_license_mobile | মোবাইল নম্বর | Mobile number | text | yes |  | maxLength 11; pattern ^01[0-9]{9}$ |  |  | inferred |  |
| **Previous license and documents** | | পূর্বের লাইসেন্স ও নথি | | section | | | | | | | |
| has_previous_license |  | পূর্বের লাইসেন্স রয়েছে | I have a previous license | checkbox | yes |  |  |  |  |  |  |
| previous_license_number | application_no | পূর্বের লাইসেন্স নম্বর | Previous license number | text | yes |  | minLength 2; maxLength 40 |  | has_previous_license = true | inferred |  |
| attachments | trade_license_proven_file | সহায়ক নথি | Supporting documents | repeatable | no |  |  | rows 0–5 |  | inferred |  |
| attachments ↳ description |  | নথির বিবরণ | Document description | text | yes |  | minLength 2; maxLength 150 |  |  |  |  |
| attachments ↳ file |  | নথি | Document | attachment | yes |  |  |  |  |  |  |
| confirmation |  | প্রদত্ত তথ্য সঠিক এবং এটি পরীক্ষামূলক আবেদন | I confirm the information is correct and this is a demo application. | checkbox | yes |  |  |  |  |  |  |
| **Additional business and address details** | | প্রতিষ্ঠান ও ঠিকানার অতিরিক্ত তথ্য | | section | | | | | | | |
| proprietor_mother_name_bn | proprietor_mother_name_bn | মাতার নাম (বাংলায়) | Proprietor mother name (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_mother_name | proprietor_mother_name | মাতার নাম (ইংরেজিতে) | Proprietor mother name | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_father_name_bn | proprietor_father_name_bn | পিতার নাম (বাংলায়) | Proprietor father name (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_father_name | proprietor_father_name | পিতার নাম (ইংরেজিতে) | Proprietor father name | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_spouse_name_bn | proprietor_spouse_name_bn | স্বামী/স্ত্রীর নাম (বাংলায়) | Proprietor spouse name (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| proprietor_spouse_name | proprietor_spouse_name | স্বামী/স্ত্রীর নাম (ইংরেজিতে) | Proprietor spouse name | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| trade_license_email | trade_license_email | ইমেইল | Trade license email | text | no |  | maxLength 254; pattern ^[^\s@]+@[^\s@]+\.[^\s@]+$ |  |  | inferred |  |
| trade_license_org_type_bn | trade_license_org_type_bn | প্রতিষ্ঠানের ধরণ (বাংলায়) | Trade license organization type (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| trade_license_org_type | trade_license_org_type | প্রতিষ্ঠানের ধরণ (ইংরেজিতে) | Trade license organization type | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| trade_license_type | trade_license_type | ট্রেড লাইসেন্স এর ধরণ | Trade license type | select | no | বাণিজ্যিক / Commercial; পেশাগত / Professional; অন্যান্য / Other | minLength 2; maxLength 250 |  |  | inferred |  |
| trade_license_tin_no | trade_license_tin_no | TIN নম্বর (ইংরেজিতে) | Trade license TIN number | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| trade_license_bin_no | trade_license_bin_no | BIN নম্বর (ইংরেজিতে) | Trade license bin number | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| trade_license_org_zone_bn | trade_license_org_zone_bn | কর অঞ্চল (বাংলায়) | Trade license organization zone (Bangla) | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| trade_license_org_zone | trade_license_org_zone | কর অঞ্চল (ইংরেজিতে) | Trade license organization zone | text | no |  | minLength 2; maxLength 250 |  |  | inferred |  |
| trade_license_org_zone_ward | trade_license_org_zone_ward | কর অঞ্চল এর ওয়ার্ড | Trade license organization zone ward | number | no |  | min 1; max 99 |  |  | inferred |  |
| trade_license_capital | trade_license_capital | মূলধন সংখ্যায় (ইংরেজিতে) | Trade license capital | number | no |  | min 0; max 1000000000 |  |  | inferred |  |
| trade_license_org_add_type | trade_license_org_add_type | ঠিকানার ধরণ | Trade license organization address type | select | no | ইউনিয়ন / Union; পৌরসভা / Municipality; সিটি কর্পোরেশন / City corporation |  |  |  | inferred |  |
| org_location | trade_license_org_division, district_id, thana_id, union_id | প্রতিষ্ঠানের প্রশাসনিক এলাকা | Organization administrative area | geography | no |  | geographyDepth upazila; union when trade_license_org_add_type = "union" |  |  | inferred |  |
| additional_thana_id | additional_thana_id | থানা | Additional thana reference | text | no |  | minLength 2; maxLength 150 |  |  | inferred |  |
| post_office_id | post_office_id | ডাকঘর | Post office reference | text | no |  | minLength 2; maxLength 150 |  |  | inferred |  |
| municipality_id | municipality_id | পৌরসভা | Municipality reference | text | no |  | minLength 2; maxLength 150 |  | trade_license_org_add_type = "municipality" | inferred |  |
| city_corporation_id | city_corporation_id | সিটি কর্পোরেশন | City corporation reference | text | no |  | minLength 2; maxLength 150 |  | trade_license_org_add_type = "city_corporation" | inferred |  |
| trade_license_org_ward_no | trade_license_org_ward_no | ওয়ার্ড নং | Trade license organization ward number | number | no |  | min 1; max 99 |  |  | inferred |  |

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
