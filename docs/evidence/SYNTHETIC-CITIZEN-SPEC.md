# Synthetic test citizen

> **Md-এর জন্য:** নিচের নকল নাগরিক দিয়েই ফর্মগুলো খুলুন। নাম ও ঠিকানা দেখেই যেন বোঝা যায় এটি পরীক্ষা। কোনো আসল মানুষের NID, জন্ম নিবন্ধন বা মোবাইল নম্বর ব্যবহার করবেন না—অন্যের তো নয়ই।

Use one obviously fake citizen for every capture, so that nothing recorded in Phase 0 belongs to a real person.

## Identity

| Field | Value | Why |
| --- | --- | --- |
| Name (BN) | পরীক্ষা নাগরিক | Reads as "test citizen" |
| Name (EN) | TEST CITIZEN ASTRA | All caps, contains TEST |
| Father's name (BN / EN) | পরীক্ষা পিতা / TEST FATHER | |
| Mother's name (BN / EN) | পরীক্ষা মাতা / TEST MOTHER | |
| Spouse (BN / EN), if asked | পরীক্ষা স্বামী/স্ত্রী / TEST SPOUSE | |
| Date of birth | 01-01-2000 | Simple, clearly chosen |
| Gender | as the form allows; prefer "Other" if offered, to observe it | |
| Blood group | O+ | Any value; record the full option list |
| Religion | as the form requires; record the full option list | |

## Numbers

| Field | Value | Note |
| --- | --- | --- |
| NID (10 digits) | `1234567890` | Fake pattern |
| NID (17 digits) | `20001234567890123` | Fake pattern starting with the birth year |
| Birth registration (17 digits) | `20001234567890123` | Same fake pattern |
| Holding number | `TEST-001` | |
| Mobile | **Md's own test SIM**, never someone else's number | Needed if an OTP is sent |
| Email | an address Md controls, e.g. a `+test` alias | |

**If the reference system checks NID or birth registration with an external authority and rejects the fake numbers:** stop that service, write "rejected fake NID: <message>" in its capture file, and move on. Do **not** use a real person's NID to get past the check. Using Md's own identity is his own decision; if he does, redact it from every capture file and screenshot before it goes anywhere near the repository.

## Address

Use a real area so the geography cascade can be observed, with a fake house line:

| Field | Value |
| --- | --- |
| Division / District / Upazila / Union | Chattogram / Cumilla / Debidwar / Subil (or any area the account may use) |
| Ward | 1 |
| Village / road | পরীক্ষা গ্রাম, TEST ROAD 1 |
| Post office / postcode | record the options offered; pick the first |
| Ownership | record the options offered (owner / tenant …); pick "owner" |

## Photo and documents

Use a plain placeholder image (a grey square with the word TEST) for any photo or document upload. Never upload a real photo or a real document.

## Payment

Do not pay. Stop at the payment screen and record what it shows (see section 3 of the [form template](FORM-CAPTURE-TEMPLATE.md)).
