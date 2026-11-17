import type { Locator, Page } from "playwright";

/**
 * Fill a rendered DynamicForm from a payload object, one real control at a
 * time. Browser tests use this with the shared fixture payloads
 * (`demoPayloads` from @astra/shared-schemas) now that the shipped UI no
 * longer offers a localhost sample-insertion shortcut: the same data is
 * typed into the actual inputs, selects, checkboxes and repeatable rows.
 */
export async function fillApplicationForm(
  page: Page,
  payload: Record<string, unknown>,
  root?: Locator,
): Promise<void> {
  const scope = root ?? page.getByTestId("service-application-form");
  for (const [key, value] of Object.entries(payload)) {
    await fillField(scope, key, value);
  }
}

const geographyKeys = [
  "divisionCode",
  "districtCode",
  "upazilaCode",
  "unionCode",
  "wardCode",
] as const;

async function fillField(
  scope: Locator,
  path: string,
  value: unknown,
): Promise<void> {
  // Some payload keys have no rendered control in a given form variant —
  // e.g. delivery_language is managed by the order component (not the form)
  // when an office fee policy is configured, and conditional fields render
  // only while their controller is set. Skip keys the form does not render.
  const probe = scope.locator(`[data-field-path="${path}"]`).first();
  try {
    await probe.waitFor({ state: "attached", timeout: 2000 });
  } catch {
    return;
  }
  if (Array.isArray(value)) {
    // Repeatable group: add rows until the rendered count matches the
    // payload, then fill each row's child controls.
    const group = scope.locator(`[data-field-path="${path}"]`);
    const addButton = group.locator("> button", { hasText: "+ Add" });
    while (
      (await group.locator(":scope > .repeat-row").count()) < value.length
    ) {
      await addButton.click();
    }
    for (let index = 0; index < value.length; index++) {
      const row = value[index] as Record<string, unknown>;
      for (const [childKey, childValue] of Object.entries(row)) {
        await fillField(scope, `${path}[${index}].${childKey}`, childValue);
      }
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    // Geography picker: choose each level's code in cascade order, waiting
    // for the child level's options to load before selecting it.
    const picker = scope.locator(`[data-field-path="${path}"]`);
    const codes = value as Record<string, string>;
    let selectIndex = 0;
    for (const key of geographyKeys) {
      const code = codes[key];
      if (!code) continue;
      const select = picker.locator("select").nth(selectIndex);
      await select.waitFor({ state: "attached" });
      await select
        .locator(`option[value="${code}"]`)
        .waitFor({ state: "attached" });
      await select.selectOption(code);
      selectIndex++;
    }
    return;
  }
  const control = scope.locator(`[data-field-path="${path}"]`);
  const kind = await control.evaluate((element) => {
    if (element instanceof HTMLSelectElement) return "select";
    if (element instanceof HTMLInputElement && element.type === "checkbox")
      return "checkbox";
    return "text";
  });
  if (kind === "select") await control.selectOption(String(value));
  else if (kind === "checkbox") {
    // setChecked() is a no-op when the box already shows the desired state,
    // which leaves the value undefined in form state — and a required
    // checkbox then fails validation ("This field is required"). The removed
    // one-shot fill set every value explicitly, so force a click cycle that
    // writes the value while ending in the desired state.
    const checked = await control.evaluate(
      (el) => (el as HTMLInputElement).checked,
    );
    if (checked !== Boolean(value)) await control.click();
    else {
      await control.click();
      await control.click();
    }
  } else await control.fill(String(value));
}
