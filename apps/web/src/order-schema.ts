import type { getServiceSchema } from "@astra/shared-schemas/web";

/**
 * When an office order policy is configured, the certificate language is chosen in the order step,
 * so the form hides its own delivery_language field. Shared by the legacy intake and the Phase 1 flow.
 */
export function withoutOrderLanguage(schema: ReturnType<typeof getServiceSchema>) {
  return {
    ...schema,
    sections: schema.sections.map((section) => ({
      ...section,
      fields: section.fields.filter((field) => field.id !== "delivery_language"),
    })),
  };
}
