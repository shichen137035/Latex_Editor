import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.latex-editor/**", "vitest.config.ts", "eslint.config.mjs", "apps/desktop/vite.config.ts", "apps/desktop/src/preload/index.cjs", "apps/desktop/scripts/launch.cjs", "apps/desktop/scripts/dev.cjs", "apps/desktop/scripts/build-distribution.cjs", "apps/desktop/scripts/verify-package.cjs"]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/desktop/scripts/check-structure-api.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { console: "readonly", setTimeout: "readonly", clearTimeout: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" }
  },
  {
    files: ["apps/desktop/scripts/check-file-menu.cjs", "apps/desktop/scripts/check-edit-history.cjs", "apps/desktop/scripts/check-preview.cjs", "apps/desktop/scripts/check-preview-large.cjs", "apps/desktop/scripts/check-preview-project.cjs", "apps/desktop/scripts/check-preview-labels.cjs", "apps/desktop/scripts/check-unsaved-exit.cjs", "apps/desktop/scripts/check-compile-path.cjs", "apps/desktop/scripts/check-foundations.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { console: "readonly", process: "readonly", setTimeout: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" }
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error"
    }
  }
);
