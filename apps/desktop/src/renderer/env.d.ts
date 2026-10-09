import type { DesktopApi } from "@latex-editor/contracts/desktop-ipc";

declare global {
  interface Window {
    latexEditor?: DesktopApi;
  }
}

export {};
