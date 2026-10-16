import { config } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    // Moved from apps/web (oxlint), where a leading `_` marks a name kept
    // on purpose: `resolveProfileMetrics(_profile)` is the Tier 2 seam.
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
];
