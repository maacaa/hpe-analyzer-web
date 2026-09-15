// ESLint flat config for hpe-analyzer-web.
//
// Two hard rules for the browser-only build:
//   1. Clean Architecture dependency rule: src/domain must never import
//      adapters, UI, worker code or the test suite.
//   2. RNF-2: no Node-only globals/modules anywhere in src/ (Buffer, pako,
//      node:* imports) - the bundle must run in a plain browser.

import importPlugin from "eslint-plugin-import";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.{js,ts,tsx}"],
    // Tests run under Node (vitest) and never ship in the browser bundle.
    ignores: ["src/test/**"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { import: importPlugin },
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Buffer", message: "Use Uint8Array/DataView (RNF-2: no Node APIs in the web bundle)." },
        { name: "process", message: "Not available in the browser bundle." },
        { name: "require", message: "ESM only." },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "pako"],
              message: "RNF-2: no Node built-ins or pako in the web bundle.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/domain/**/*.js"],
    plugins: { import: importPlugin },
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/domain",
              from: ["./src/adapters", "./src/components", "./src/worker", "./src/api", "./src/cache", "./src/test"],
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "*.config.ts", "*.config.js"],
  },
];
