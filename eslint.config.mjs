// B-005: ESLint flat config — first pass is warnings-only (ratchet later).
// Every recommended rule is downgraded error -> warn, so pre-existing
// issues never fail the build; `npm run lint` must exit 0 on the current
// tree. eslint-config-prettier (last) disables the formatting rules that
// would fight Prettier; Prettier itself is configured in .prettierrc and
// run on demand via `npm run format` — it is NOT part of `npm run lint`
// because the current tree is not prettier-formatted (563 files would
// reformat at the baseline; reformatting the tree is a separate step).
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";

/** Downgrade every rule in a recommended set from error to warn. */
function toWarn(config) {
  if (!config.rules) return config;
  const rules = {};
  for (const [name, value] of Object.entries(config.rules)) {
    rules[name] = Array.isArray(value) ? ["warn", ...value.slice(1)] : "warn";
  }
  return { ...config, rules };
}

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist-cpanel/**",
      "**/dist/**",
      ".runtime/**",
      "execution/**",
      "audit/**",
      "handoff/**",
      "coverage/**",
    ],
  },
  toWarn(eslint.configs.recommended),
  ...tseslint.configs.recommended.map(toWarn),
  // The source already carries `eslint-disable-next-line
  // react-hooks/exhaustive-deps` comments (13 of them); without the
  // plugin ESLint errors "definition for rule was not found" on each.
  // Registered warnings-only like everything else here. (The plugin's
  // own configs.* entries are eslintrc-shaped — plugins as a string
  // array — which flat config rejects, so the plugin object is wired
  // directly with its recommended-latest rules downgraded to warn.)
  {
    plugins: { "react-hooks": reactHooks },
    rules: Object.fromEntries(
      Object.entries(reactHooks.configs["recommended-latest"].rules).map(([name, value]) => [
        name,
        Array.isArray(value) ? ["warn", ...value.slice(1)] : "warn",
      ]),
    ),
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // tsc already enforces these; ESLint's versions misfire on TS.
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  eslintConfigPrettier,
);
