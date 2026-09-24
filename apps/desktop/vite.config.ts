import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rootPackage = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { version: string };

export default defineConfig({
  root: "apps/desktop/src/renderer",
  // Electron loads the renderer with file:// via BrowserWindow.loadFile().
  // Relative asset URLs are required; an absolute /assets URL points at the
  // filesystem root and results in a blank window.
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(rootPackage.version) },
  plugins: [react()],
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    target: "es2022"
  }
});
