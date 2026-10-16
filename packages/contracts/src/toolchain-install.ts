import type { LatexToolchain } from "./settings.js";

export const latexComponentIds = ["math", "tables", "chinese", "bibliography", "graphics"] as const;
export type LatexComponentId = typeof latexComponentIds[number];
export interface ToolchainInstallSelection {
  distribution: "miktex" | "tinytex";
  components: LatexComponentId[];
  customPackages: string[];
  full: boolean;
  autoInstall: boolean;
  existing: boolean;
}

export type ToolchainInstallPhase = "idle" | "downloading" | "extracting" | "installing" | "verifying" | "complete" | "error" | "cancelled";
export interface ToolchainInstallStatus {
  supported: boolean;
  selection?: ToolchainInstallSelection;
  defaultDirectories?: { miktex: string; tinytex: string };
  defaultDirectory: string;
  directory: string;
  phase: ToolchainInstallPhase;
  running: boolean;
  downloadedBytes: number;
  totalBytes: number;
  log: string;
  error?: string;
  toolchain?: LatexToolchain;
}
