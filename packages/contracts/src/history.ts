export type ProjectHistoryType = "version" | "snapshot" | "temporary";
export type SnapshotReason = "interval" | "project-close" | "pre-restore" | "pre-delete" | "pre-ai-change" | "recovery" | "manual";

export interface ProjectHistoryEntry {
  id: string;
  type: ProjectHistoryType;
  createdAt: string;
  manifestId: string;
  title?: string;
  summary?: string;
  versionNumber?: string;
  reason?: SnapshotReason;
  parentHistoryId?: string;
  fileCount: number;
}

export interface HistoryFileChange {
  path: string;
  status: "added" | "removed" | "modified";
  /** Files in the selected historical entry can be restored; removed files can be selected for deletion. */
  inHistory: boolean;
}

export interface ProjectHistoryDetails {
  entry: ProjectHistoryEntry;
  files: string[];
  changes: HistoryFileChange[];
}

export interface ProjectHistoryStorage {
  bytes: number;
  versions: number;
  snapshots: number;
  temporary: number;
}

/** The current project is always authoritative; this only governs recovery copies. */
export interface HistoryPreferences {
  autoSnapshot: boolean;
  intervalMinutes: number;
  maxSnapshots: number;
  retentionDays: number;
  beforeRestore: boolean;
  beforeLargeDelete: boolean;
  beforeAiChange: boolean;
}

export const defaultHistoryPreferences: HistoryPreferences = {
  autoSnapshot: true,
  intervalMinutes: 10,
  maxSnapshots: 20,
  retentionDays: 7,
  beforeRestore: true,
  beforeLargeDelete: true,
  beforeAiChange: true
};

export function suggestHistoryVersion(entries: ProjectHistoryEntry[]): string {
  const latest = entries.find((entry) => entry.type === "version" && entry.versionNumber);
  if (!latest?.versionNumber) return "1.0";
  const parts = latest.versionNumber.split(".");
  if (parts.length < 2 || parts.some((part) => !/^\d+$/.test(part))) return "1.0";
  parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
  return parts.join(".");
}
