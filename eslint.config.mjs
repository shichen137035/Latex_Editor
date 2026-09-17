import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.latex-editor/**", "vitest.config.ts", "eslint.config.mjs", "apps/desktop/vite.config.ts", "apps/desktop/src/preload/index.cjs", "apps/desktop/scripts/launch.cjs"]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/desktop/scripts/check-file-menu.cjs", "apps/desktop/scripts/check-preview.cjs", "apps/desktop/scripts/check-compile-path.cjs"],
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
