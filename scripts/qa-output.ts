/** Keep each release's hosted evidence separate without allowing arbitrary file writes. */
export function qaOutput(defaultName: string) {
  const name = process.env.ASTRA_QA_OUTPUT ?? defaultName;
  if (!/^[a-z][a-z0-9-]*\.json$/.test(name))
    throw new Error(
      "ASTRA_QA_OUTPUT must be a simple lowercase JSON filename.",
    );
  return `execution/${name}`;
}
