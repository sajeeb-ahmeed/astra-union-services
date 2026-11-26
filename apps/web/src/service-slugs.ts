import serviceCatalog from "./service-catalog.js";

/**
 * FULL-UIUX-01 (checklist A5): every public service gets a stable, readable
 * slug so the service detail is a real page at /services/<slug>. Slugs derive
 * from the catalog's English names; the numeric /services/<no> and the legacy
 * /services?service=N forms keep working as aliases.
 */
const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const byNo = new Map<number, string>();
const bySlug = new Map<string, number>();
for (const service of serviceCatalog) {
  let slug = slugify(service.name_en);
  if (bySlug.has(slug)) slug = `${slug}-${service.service_no}`;
  byNo.set(service.service_no, slug);
  bySlug.set(slug, service.service_no);
}

export const serviceSlug = (serviceNo: number): string =>
  byNo.get(serviceNo) ?? String(serviceNo);

export const serviceNoFromSlug = (slug: string): number | null => {
  if (/^\d+$/.test(slug)) {
    const no = Number(slug);
    return byNo.has(no) ? no : null;
  }
  return bySlug.get(slug) ?? null;
};

export const servicePath = (serviceNo: number) =>
  `/services/${serviceSlug(serviceNo)}`;
