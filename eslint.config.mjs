import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.latex-editor/**", "vitest.config.ts", "eslint.config.mjs", "apps/desktop/vite.config.ts", "apps/desktop/src/preload/index.cjs", "apps/desktop/scripts/launch.cjs", "apps/desktop/scripts/dev.cjs", "apps/desktop/scripts/build-distribution.cjs", "apps/desktop/scripts/verify-package.cjs"]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/desktop/scripts/**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: { "@typescript-eslint/no-require-imports": "off" }
  },
  {
    files: ["apps/desktop/scripts/**/*.mjs"],
    languageOptions: { sourceType: "module", globals: globals.node }
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
