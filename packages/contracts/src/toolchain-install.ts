import type { LatexToolchain } from "./settings.js";

export type ToolchainInstallPhase = "idle" | "downloading" | "extracting" | "installing" | "verifying" | "complete" | "error" | "cancelled";
export interface ToolchainInstallStatus {
  supported: boolean;
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
