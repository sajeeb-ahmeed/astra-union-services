import React from "react";
import { t, tx, useLanguage } from "./i18n.js";
import {
  GeographyFields,
  emptyGeography,
  geographyPayload,
  readGeography,
  type GeographyValue,
} from "./GeographyFields.js";

/** PAR-06: optional present address beside the registered (permanent) address. */
export type PresentAddressDraft = {
  sameAsPermanent: boolean;
  addressBn: string;
  addressEn: string;
  geography: GeographyValue;
};
export const emptyPresentAddress = (): PresentAddressDraft => ({
  sameAsPermanent: true,
  addressBn: "",
  addressEn: "",
  geography: emptyGeography(),
});
export function readPresentAddress(value: any): PresentAddressDraft {
  if (!value || value.sameAsPermanent !== false) return emptyPresentAddress();
  return {
    sameAsPermanent: false,
    addressBn: value.addressBn ?? "",
    addressEn: value.addressEn ?? "",
    geography: readGeography(value.geography),
  };
}
/** The area is sent only once it reaches upazila; a partial pick is not a location. */
export function presentAddressPayload(draft: PresentAddressDraft) {
  if (draft.sameAsPermanent) return { sameAsPermanent: true as const };
  return {
    sameAsPermanent: false as const,
    addressBn: draft.addressBn,
    addressEn: draft.addressEn,
    ...(draft.geography.upazilaCode
      ? { geography: geographyPayload(draft.geography) }
      : {}),
  };
}

/** The citizen address a form's `address_source` selects; falls back to the registered address. */
export function chosenCitizenAddress(
  citizen: any,
  source: unknown,
): { bn: string; en: string } {
  const present = citizen?.presentAddress;
  if (source === "present" && present && present.sameAsPermanent === false)
    return { bn: present.addressBn, en: present.addressEn };
  return { bn: citizen?.addressBn, en: citizen?.addressEn };
}

export function PresentAddressFields({
  value,
  onChange,
  prefix,
  disabled = false,
}: {
  value: PresentAddressDraft;
  onChange: (value: PresentAddressDraft) => void;
  prefix: string;
  disabled?: boolean;
}) {
  useLanguage();
  return (
    <fieldset className="present-address" disabled={disabled}>
      <legend>{t("বর্তমান ঠিকানা / Present address")}</legend>
      <div className="check-field">
        <label htmlFor={`${prefix}-same`}>
          <input
            id={`${prefix}-same`}
            type="checkbox"
            checked={value.sameAsPermanent}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? emptyPresentAddress()
                  : { ...value, sameAsPermanent: false },
              )
            }
          />
          <span>
            {t(
              "বর্তমান ঠিকানা স্থায়ী ঠিকানার মতোই / Present address is the same as permanent address",
            )}
          </span>
        </label>
      </div>
      {tx(
        !value.sameAsPermanent && (
          <>
            <div className="form-grid">
              <label htmlFor={`${prefix}-bn`}>
                {t("বর্তমান ঠিকানা (বাংলা) / Present address (Bangla)")}
                <input
                  id={`${prefix}-bn`}
                  required
                  minLength={4}
                  maxLength={500}
                  value={value.addressBn}
                  onChange={(event) =>
                    onChange({ ...value, addressBn: event.target.value })
                  }
                />
              </label>
              <label htmlFor={`${prefix}-en`}>
                {t("বর্তমান ঠিকানা (ইংরেজি) / Present address (English)")}
                <input
                  id={`${prefix}-en`}
                  required
                  minLength={4}
                  maxLength={500}
                  value={value.addressEn}
                  onChange={(event) =>
                    onChange({ ...value, addressEn: event.target.value })
                  }
                />
              </label>
            </div>
            <GeographyFields
              prefix={`${prefix}-geo`}
              legend="বর্তমান ঠিকানার এলাকা (ঐচ্ছিক) / Present address area (optional)"
              value={value.geography}
              onChange={(geography) => onChange({ ...value, geography })}
              disabled={disabled}
            />
            <p className="hint">
              {t(
                "এলাকা উপজেলা পর্যন্ত নির্বাচন করলে সংরক্ষিত হবে; বর্তমান ঠিকানা অফিসের এলাকার বাইরেও হতে পারে। / The area is saved once an upazila is selected; a present address may be outside the office area.",
              )}
            </p>
          </>
        ),
      )}
    </fieldset>
  );
}
