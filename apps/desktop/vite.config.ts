import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "apps/desktop/src/renderer",
  // Electron loads the renderer with file:// via BrowserWindow.loadFile().
  // Relative asset URLs are required; an absolute /assets URL points at the
  // filesystem root and results in a blank window.
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    target: "es2022"
  }
});
