import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  demoPayloads,
  flattenFields,
  getCatalogPreviewSchema,
  getServiceSchema,
  namedDataFields,
  serviceCatalog,
  validateForm,
  type FormSchema,
  type ValidationIssue,
} from "@astra/shared-schemas";
import { DynamicForm } from "../src/DynamicForm.js";

const render = (
  schema: FormSchema,
  value: Record<string, unknown> = {},
  issues: readonly ValidationIssue[] = [],
  disabled = false,
) =>
  renderToStaticMarkup(
    createElement(DynamicForm, {
      schema,
      value,
      issues,
      disabled,
      onChange: () => {},
    }),
  );
const decode = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
const controls = (html: string) =>
  [...html.matchAll(/<(input|textarea|select)\b([^>]*)>/g)].map((match) => ({
    type: match[1],
    attributes: match[2],
    id: decode(match[2].match(/\bid="([^"]*)"/)?.[1] ?? ""),
  }));
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("FOR-01: actual React renderer renders all 47 captured service entries and all 48 initial form sections", () => {
  let sectionCount = 0;
  const renderedNames = new Set<string>();
  for (const service of serviceCatalog) {
    const schema = getCatalogPreviewSchema(service.service_no);
    const html = render(schema, {}, [], true);
    const actualControls = controls(html);
    const expectedFields = flattenFields(schema);
    assert.equal(
      (html.match(/<fieldset\b/g) ?? []).length,
      service.form_count,
      `Service ${service.service_no} form sections`,
    );
    assert.equal(
      actualControls.length,
      expectedFields.length,
      `Service ${service.service_no} named data controls`,
    );
    sectionCount += service.form_count;
    assert.deepEqual(
      expectedFields.map((field) => field.evidence!.fieldNames![0]),
      namedDataFields(service).map((field) => field.name),
    );
    expectedFields.forEach((field, index) => {
      const control = actualControls[index];
      assert.ok(
        control.id.endsWith(`-${field.id}`),
        `Service ${service.service_no}: rendered exact field identity ${field.id}`,
      );
      assert.ok(
        /\bdisabled=""/.test(control.attributes),
        `Service ${service.service_no}: reference preview remains read-only`,
      );
      assert.ok(
        html.includes(
          `for="${control.id.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`,
        ),
        `Service ${service.service_no}: accessible label for ${field.id}`,
      );
      renderedNames.add(field.evidence!.fieldNames![0]);
    });
  }
  assert.equal(sectionCount, 48);
  assert.equal(renderedNames.size, 217);
});

test("operational bilingual labels and private upload accept rules render from the shared profile", () => {
  const schema = getServiceSchema(42);
  const payload = {
    ...demoPayloads[42],
    attachments: [{ description: "Demo evidence" }],
  };
  const html = render(schema, payload);
  assert.equal(
    (html.match(/<fieldset\b/g) ?? []).length,
    schema.sections.length + 1,
  );
  for (const field of flattenFields(schema).filter(
    (field) => !field.visibleWhen,
  )) {
    assert.ok(html.includes(field.label.bn));
    assert.ok(html.includes(field.label.en));
  }
  assert.ok(html.includes('type="file"'));
  assert.ok(html.includes('accept="application/pdf,image/png,image/jpeg"'));
  assert.ok(controls(html).every((control) => control.id));
});

test("nested family member rows expose local conditional guardian only for a minor", () => {
  const adult = {
    name_bn: "নমুনা সদস্য",
    name_en: "Sample Adult",
    relationship: "self",
    dob: "1990-01-01",
    is_minor: false,
  };
  const minor = {
    name_bn: "নমুনা শিশু",
    name_en: "Sample Child",
    relationship: "child",
    dob: "2020-01-01",
    is_minor: true,
    guardian_name_bn: "নমুনা অভিভাবক",
  };
  const payload = { ...demoPayloads[2], members: [adult, minor] };
  const html = render(getServiceSchema(2), payload);
  const ids = controls(html).map((control) => control.id);
  assert.ok(ids.some((id) => id.endsWith("-members[0].name_bn")));
  assert.ok(ids.some((id) => id.endsWith("-members[1].guardian_name_bn")));
  assert.ok(!ids.some((id) => id.endsWith("-members[0].guardian_name_bn")));
  assert.ok(html.includes("Remove 1"));
  assert.ok(html.includes("Remove 2"));
  assert.ok(html.includes("Guardian name (Bangla)"));
  assert.equal(validateForm(getServiceSchema(2), payload).valid, true);
});

test("checkboxes use strict boolean semantics: false remains unchecked, true checks the declaration", () => {
  const html = render(getServiceSchema(42), demoPayloads[42]);
  const previous = controls(html).find((control) =>
    control.id.endsWith("-has_previous_license"),
  )!;
  const confirmation = controls(html).find((control) =>
    control.id.endsWith("-confirmation"),
  )!;
  assert.ok(previous.attributes.includes('type="checkbox"'));
  assert.ok(!previous.attributes.includes('checked=""'));
  assert.ok(confirmation.attributes.includes('checked=""'));
  assert.ok(
    !controls(
      render(getServiceSchema(42), {
        ...demoPayloads[42],
        confirmation: "true",
      }),
    )
      .find((control) => control.id.endsWith("-confirmation"))!
      .attributes.includes('checked=""'),
  );
});

test("conditional trade previous-license control is hidden until selected and has an associated label", () => {
  const schema = getServiceSchema(42);
  assert.ok(
    !controls(render(schema, demoPayloads[42])).some((control) =>
      control.id.endsWith("-previous_license_number"),
    ),
  );
  const html = render(schema, {
    ...demoPayloads[42],
    has_previous_license: true,
    previous_license_number: "DEMO-OLD-001",
  });
  const previous = controls(html).find((control) =>
    control.id.endsWith("-previous_license_number"),
  )!;
  assert.ok(previous);
  assert.ok(html.includes(`for="${previous.id}"`));
  assert.ok(html.includes("পূর্বের লাইসেন্স নম্বর"));
  assert.ok(html.includes("DEMO-OLD-001"));
});

test("field errors link bilingual error content to the exact nested input", () => {
  const schema = getServiceSchema(2);
  const payload = {
    ...demoPayloads[2],
    members: [
      {
        ...(demoPayloads[2].members as Record<string, unknown>[])[0],
        name_bn: "",
      },
    ],
  };
  const result = validateForm(schema, payload);
  const html = render(schema, payload, result.issues);
  const control = controls(html).find((control) =>
    control.id.endsWith("-members[0].name_bn"),
  )!;
  assert.ok(control.attributes.includes('aria-invalid="true"'));
  assert.ok(
    control.attributes.includes(`aria-describedby="${control.id}-error"`),
  );
  assert.ok(html.includes(`id="${control.id}-error"`));
  assert.ok(html.includes("এই ঘরটি পূরণ করুন।"));
  assert.ok(html.includes("This field is required."));
});

test("repeatable group errors are focusable and programmatically linked to their fieldset", () => {
  const schema = getServiceSchema(2);
  const payload = { ...demoPayloads[2], members: [] };
  const issues = validateForm(schema, payload).issues;
  const html = render(schema, payload, issues);
  const group = [...html.matchAll(/<fieldset\b([^>]*)>/g)]
    .map((match) => match[1])
    .find((attributes) => /id="[^"]*-members"/.test(attributes));
  assert.ok(group, "Repeatable fieldset must have a stable ID");
  const groupId = group.match(/id="([^"]*)"/)![1];
  assert.ok(group.includes('aria-invalid="true"'));
  assert.ok(group.includes(`aria-describedby="${groupId}-error"`));
  assert.ok(/tab[Ii]ndex="-1"/.test(group));
  assert.match(html, new RegExp(`id="${escape(groupId)}-error"`));
});

test("disabled application controls include nested add/remove and upload actions", () => {
  const payload = {
    ...demoPayloads[2],
    members: [
      {
        ...(demoPayloads[2].members as Record<string, unknown>[])[0],
        attachments: [{ description: "Demo evidence" }],
      },
    ],
  };
  const html = render(getServiceSchema(2), payload, [], true);
  assert.ok(
    controls(html).every((control) =>
      control.attributes.includes('disabled=""'),
    ),
  );
  const buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map(
    (match) => match[1],
  );
  assert.ok(buttons.length >= 4);
  assert.ok(buttons.every((attributes) => attributes.includes('disabled=""')));
});
