import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  root: "apps/desktop/src/renderer",
  // Relative asset URLs work both with Vite's dev server and Electron's
  // production file:// load, where absolute /assets URLs resolve incorrectly.
  base: "./",
  // Linked workspace CommonJS exports need conversion in the dev server too.
  optimizeDeps: {
    include: ["@latex-editor/contracts/line-diff", "@latex-editor/contracts/desktop-ipc"]
  },
  plugins: [react(), {
    name: "texweave-content-security-policy",
    transformIndexHtml(html) {
      const developmentSources = command === "serve" ? "http://127.0.0.1:* ws://127.0.0.1:*" : "";
      return html.replace("__CSP_CONNECT_SOURCES__", developmentSources);
    }
  }],
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    target: "es2022",
    // The editor, PDF.js, KaTeX, and language services are intentionally bundled
    // locally for offline desktop use; 5 MB is an acceptable warning threshold.
    chunkSizeWarningLimit: 6000
  }
}));
