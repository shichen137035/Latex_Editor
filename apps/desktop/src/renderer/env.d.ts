import type { DesktopApi } from "@latex-editor/contracts/desktop-ipc";

declare global {
  const __APP_VERSION__: string;
  interface Window {
    latexEditor?: DesktopApi;
  }
}

export {};
