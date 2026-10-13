# Ownership and third-party components

Original Astra source, documentation, product UI and independently designed templates were authored for the commissioning user under their full software ownership. No proprietary Prottoyon source, seal, logo, credential or private citizen record was copied. Sanitized public form metadata is retained as traceable reference evidence, with operational rules independently defined.

Dependencies and runtimes retain their original licenses. Ownership of original application code does not transfer ownership of third-party libraries or government/citizen data.

| Component | Use | License family |
|---|---|---|
| React / ReactDOM, Express, Vite, TypeScript, tsx, pg, qrcode, Zod, jsQR, pngjs and DefinitelyTyped types | Application/build/tests | MIT (verify each package LICENSE in the pinned lock/install) |
| Playwright | Chromium PDF rendering and browser tests | Apache-2.0 |
| PostgreSQL | Primary relational database | PostgreSQL License |
| Chromium | Local headless rendering/testing | BSD-style and bundled third-party licenses |
| Nirmala UI | Installed Windows font used by local UI/PDF | Windows font license; not redistributed in this source archive |
| Python pypdf / pypdfium2 and Poppler | Development PDF QA via host bundle | Respective upstream licenses; host tools are not redistributed |

The source deliverable excludes node_modules, downloaded PostgreSQL binaries, database clusters, private credentials and proprietary font files. Install dependencies from their official distributions and retain required notices for any redistribution. Linux font licensing and deployment packaging must be checked before distribution.
