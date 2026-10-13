# Language and interface release guide

This release adds selectable Bangla/English presentation, a calmer green/slate interface, and Bangladesh geography selection to the working Astra application. The UI remains a **public preview**: the database, accounts, approval workflow, PDF/QR verification and credit ledger are functional, while government identity verification, official certificate authority and live payment settlement are not connected. Keep the relevant certificate, payment and personal-data disclosures visible.

## Using the interface

Select **বাংলা** or **English** in the public header, signed-in workspace header or certificate verification page. English is the initial default. The selected value (`bn` or `en`) is saved under `localStorage["astra.language"]`, survives navigation/reload, updates the document's `lang` attribute, and synchronizes through browser storage events. Switching still works within the open page if storage is unavailable; persistence is then unavailable.

The switch changes display language without submitting or resetting the form. Selected geography codes and entered account/form values remain unchanged. Separately named Bangla and English data fields still collect their respective language; switching the interface does not translate entered names, addresses, uploaded files or document contents.

| Area | Available interface |
|---|---|
| Public entry | `/`, `/login`, `/register`, `/recover` |
| Discovery | `/services`, `/offices`, `/notices` |
| Help and trust | `/help`, `/policies`, `/tracking`, `/verify`, `/verify/:token` |
| Citizen and operational workspace | Overview, service catalog, citizens, applications, profile, print requests and notifications; visibility follows the signed-in role |
| Administration and finance | Office administration, platform management, account security, subscription/credits, reports and support inbox; existing authorization applies |

Workspace sections are application navigation states, not newly introduced public URL routes. Labels, actions, form/schema labels and supplied bilingual service/place/office text use the selected language. User-authored content is displayed from the corresponding stored language when available; the application does not claim automatic translation of arbitrary content or every external/server diagnostic.

## Geography and registration

Registration proceeds through **area → participating office → account details**. Select division, district, upazila, union and ward. Changing a parent clears its descendants; selecting a different union also clears the selected office. Lookup failures provide retry controls, and a known empty child list is shown as a coverage gap.

Geographic places and participating offices are different records. A supplied union does not automatically become an available office. When no participating office matches, an explicit preview-office option can list existing unmapped preview offices; it does not assert local government representation. A mapped office must match the selected jurisdiction. The server validates the hierarchy and tenant jurisdiction independently of the controls. Account references are generated automatically rather than requiring applicants to invent one.

Office onboarding and profile editing share the selectors. Union offices map through union; urban office references stop at upazila because this package has no municipality/city ward hierarchy. Existing unmapped offices can retain their legacy text until deliberately mapped.

See [Bangladesh geography integration](GEOGRAPHY_INTEGRATION.md) for data provenance, API contracts and independent validation. Coverage is 8 divisions, 64 districts, 495 upazilas, 4,586 unions and 41,274 **derived** union wards. Dataset codes are not official BBS identifiers. Shaistaganj (`upa-388`) has no supplied unions; urban wards and surveyed ward boundaries are absent. The interface does not invent missing places or turn these source limitations into verified official coverage.

## Maintaining translations

The implementation is in `apps/web/src/i18n.tsx`; public and workspace dictionaries live under `apps/web/src/locales/` as paired `.bn.json` and `.en.json` files.

1. Add the normalized source phrase to the relevant dictionary pair. Keys normalize whitespace; punctuation and spelling still matter. Missing dictionary entries fall back to the source text. A simple existing `বাংলা / English` pair can also be selected by `t()`.
2. Use `t("Save profile")` for authored interface text, including labels and accessible names. `tx()` handles a string or array of display strings; it does not recursively translate an arbitrary React element tree.
3. Use `choose({ bn: record.nameBn, en: record.nameEn })` for a record that already has both languages. It selects the requested language and falls back to the available counterpart.
4. Subscribe through `useLanguage()` in a component that needs to rerender on a language change. Reuse `LanguageSwitcher` rather than a separate language state.
5. Keep API paths, enum values, service numbers, geography codes, identifiers, stored form values and permission checks unchanged. Translate an option's visible label, not its submitted value. Do not key/remount forms by language, and do not translate user-entered data through a dictionary.

For example:

```tsx
useLanguage();
return (
  <label>
    {t("Office type")}
    <select value={officeType} onChange={e => setOfficeType(e.target.value)}>
      <option value="UNION">{t("Union Parishad")}</option>
    </select>
  </label>
);
```

The selected language is presentation state; it must not control authorization, currency arithmetic, geography validation or certificate issuance behavior. PDF content remains governed by the document's own supported language/template rules.

## Visual system and verification evidence

`apps/web/src/style.css` contains the shared interface refinements: restrained green/slate surfaces, consistent cards and inputs, clear navigation, compact language controls with visible selected/focus states, and responsive registration/workspace layouts. Both scripts and screenshots below were captured against the local application on **13 October 2026**; they are not claims that a particular commit is already live.

- **24 layout observations:** eight public routes (`/`, `/register`, `/services`, `/offices`, `/login`, `/help`, `/verify`, `/tracking`) at 1440, 390 and 320 CSS pixels. No overall horizontal overflow or captured browser JavaScript errors. [Initial layout report](../execution/ui-minimal-qa.json).
- **27 final layout observations:** four routes (`/`, `/register`, `/services`, `/offices`) in each language at those three widths, plus the signed-in staff dashboard at each width. No overall horizontal overflow. The recorded public language buttons meet 44-pixel minimum width/height after the final sizing adjustment. [Language/layout report](../execution/ui-minimal-language-qa.json). The earlier 24-observation report predates that target-size adjustment.
- Representative images include [English desktop home](../execution/screenshots/ui-minimal-home-en-1440.png), [Bangla registration](../execution/screenshots/ui-minimal-register-bn-1440.png), [mobile registration](../execution/screenshots/ui-minimal-register-en-390.png), and [mobile workspace](../execution/screenshots/ui-minimal-workspace-390.png).

These are **51 layout observations**, not 51 independent workflow tests or exhaustive human review of every translated page, dataset name or role. Separate automated geography/language tests in `apps/web/test/geography.test.ts` check source translation coverage, selector behavior, registration and language preference persistence. Run `npm run typecheck` and `npm run test:web` with the development API/PostgreSQL stack available; use the API suite for hierarchy and authorization checks. Current release-wide execution and hosted results belong in [hosted deployment](HOSTED_DEPLOYMENT.md).

The interface update does not change the documented free-hosting expiry/availability limits or establish production operating authority. Current provider gaps and the next operational work remain documented in [geography integration](GEOGRAPHY_INTEGRATION.md) and [hosted deployment](HOSTED_DEPLOYMENT.md).
