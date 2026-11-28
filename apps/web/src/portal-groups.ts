/**
 * PORTAL-LANDING: the home page's seven citizen-facing service groups (the
 * owner's reference portal design). They group the same 47 catalog services
 * as the ten internal catalog categories, by service number, in the order
 * the reference lists them. Every service appears exactly once (checked by
 * apps/web/test/portal-groups.test.ts).
 */
export type PortalGroup = {
  id: string;
  bn: string;
  en: string;
  icon: "license" | "family" | "marriage" | "identity" | "voter" | "income" | "other";
  services: number[];
};

export const PORTAL_GROUPS: readonly PortalGroup[] = [
  { id: "tax-licence", bn: "কর ও লাইসেন্স", en: "Tax & licences", icon: "license", services: [42, 1, 41, 46] },
  { id: "family", bn: "পরিবার ও উত্তরাধিকার", en: "Family & inheritance", icon: "family", services: [3, 2, 4, 24, 34, 19] },
  { id: "marital", bn: "বৈবাহিক অবস্থা", en: "Marital status", icon: "marriage", services: [22, 25, 13, 44, 26, 16, 31] },
  {
    id: "identity",
    bn: "পরিচয় ও বসবাস",
    en: "Identity & residence",
    icon: "identity",
    services: [12, 35, 45, 11, 8, 39, 28, 40, 18],
  },
  { id: "voter", bn: "ভোটার, এনআইডি ও পাসপোর্ট", en: "Voter, NID & passport", icon: "voter", services: [15, 9, 37, 43, 33, 27] },
  { id: "income", bn: "আয় ও পেশা", en: "Income & occupation", icon: "income", services: [23, 29, 30, 32, 10, 14, 17, 21] },
  { id: "other", bn: "অন্যান্য প্রত্যয়ন", en: "Other certificates", icon: "other", services: [7, 38, 20, 36, 5, 6, 47] },
];

/** The "most searched" shortcuts under the hero search. */
export const POPULAR_SERVICES: readonly { no: number; bn: string; en: string }[] = [
  { no: 12, bn: "নাগরিকত্ব", en: "Citizenship" },
  { no: 3, bn: "ওয়ারিশ", en: "Heirship" },
  { no: 42, bn: "ট্রেড লাইসেন্স", en: "Trade licence" },
  { no: 35, bn: "চারিত্রিক", en: "Character" },
  { no: 23, bn: "আয়ের সনদ", en: "Income" },
];

/** National helplines shown on the home page (public numbers). */
export const HOTLINES: readonly { number: string; bn: string; en: string }[] = [
  { number: "999", bn: "জাতীয় জরুরি সেবা", en: "National emergency service" },
  { number: "333", bn: "জাতীয় তথ্য ও সেবা", en: "National information & services" },
  { number: "109", bn: "নারী ও শিশু নির্যাতন প্রতিরোধ", en: "Violence against women & children" },
  { number: "1098", bn: "শিশু সহায়তা", en: "Child helpline" },
  { number: "16263", bn: "স্বাস্থ্য বাতায়ন", en: "Health helpline" },
];
