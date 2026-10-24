// Served only by Vite during component tests; never imported by the product bundle.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AttachmentStatus } from "../../src/AttachmentStatus.js";
import { DynamicForm } from "../../src/DynamicForm.js";
import { api } from "../../src/api.js";
import { setLanguage, useLanguage } from "../../src/i18n.js";
import { demoPayloads, getServiceSchema } from "@astra/shared-schemas";

const params = new URLSearchParams(location.search);
const handle = {
  attachmentId: "11111111-1111-4111-8111-111111111111",
  mimeType: "application/pdf",
  byteLength: 16,
};
await api("/auth/me");
function Harness() {
  useLanguage();
  const [context, setContext] = useState("first-application");
  const [mounted, setMounted] = useState(true);
  const initial = () => ({
    ...demoPayloads[42],
    attachments: [
      {
        description: "Synthetic evidence",
        ...(params.get("existing") === "1" ? { file: handle } : {}),
      },
    ],
  });
  const [value, setValue] = useState<Record<string, any>>(initial);
  const [changes, setChanges] = useState(0);
  return (
    <>
      <button onClick={() => setLanguage("bn")}>বাংলা</button>
      <button onClick={() => setLanguage("en")}>English</button>
      <button
        onClick={() => {
          setContext("second-application");
          setValue(initial());
        }}
      >
        Switch application
      </button>
      <button onClick={() => setMounted(false)}>Unmount</button>
      {mounted &&
        (params.get("mode") === "form" ? (
          <DynamicForm
            key={context}
            contextKey={context}
            schema={getServiceSchema(42)}
            citizenId="22222222-2222-4222-8222-222222222222"
            disabled={params.get("readonly") === "1"}
            value={value}
            onChange={(next) => {
              setChanges((n) => n + 1);
              setValue(next);
            }}
          />
        ) : (
          <AttachmentStatus
            attachment={handle}
            editable={params.get("readonly") !== "1"}
          />
        ))}
      <output data-testid="value">{JSON.stringify(value)}</output>
      <output data-testid="changes">{changes}</output>
      <output data-testid="context">{context}</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
