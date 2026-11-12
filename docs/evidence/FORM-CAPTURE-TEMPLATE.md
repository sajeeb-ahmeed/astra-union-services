# Form capture template (one per service)

Copy of the structure used by every file in `prottoyon-forms/`. Read the [capture rules](README.md#capture-rules) first.

## Header

| Item | Value |
| --- | --- |
| Service number and name (BN / EN) | |
| Captured by / date | |
| Account type used (e.g. UDC entrepreneur) | |
| Test citizen used | the synthetic citizen from [SYNTHETIC-CITIZEN-SPEC.md](SYNTHETIC-CITIZEN-SPEC.md) |
| Where the form is opened from (menu path) | |

## 1. Fields

One row per input, in the order shown on screen. Section headings go in their own row.

| # | Astra field | Reference field name | Label BN | Label EN | Type | Required? | Options (verbatim, in order) | Max length / format | Repeatable? | Shown when | Check |
| - | ----------- | -------------------- | -------- | -------- | ---- | --------- | ---------------------------- | ------------------- | ----------- | ---------- | ----- |

- **Type:** text, textarea, number, date, select, radio, checkbox, file, geography (cascading division → district → upazila → union/ward), other.
- **Required?:** yes / no / only when … (say the condition).
- **Options:** every option label exactly as shown, in display order, BN and EN if both appear.
- **Repeatable?:** for heir, witness, family-member style rows: min and max rows, and the "add row" label.
- **Check:** ✅ matches Astra · correction text · `?` not seen.

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

Record amounts exactly as shown, with the currency sign.

## 4. After submission

| Item | What happens |
| ---- | ------------ |
| Success screen text (summarise, do not copy prose) | |
| Tracking number format (e.g. letters + digits, length) | |
| Status names shown to the applicant | |
| Notifications (SMS / email) observed | |
| Where the application appears afterwards | |

## 5. Notes and open questions

Anything that did not fit above, or that you were unsure about.
