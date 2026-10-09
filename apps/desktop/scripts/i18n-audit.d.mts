export interface UiTextFinding { file: string; line: number; column: number; start: number; end: number; kind: string; text: string }
export interface LocaleAudit { locale: string; total: number; translated: number; missing: Array<{ key: string; source: string }>; placeholders: Array<{ key: string; expected: string[]; actual: string[] }>; extra: string[]; unchanged: string[] }
export function auditCatalogs(catalogs: Record<string, Record<string, string>>, selected?: string[]): LocaleAudit[];
export function inspectSource(text: string, filename: string, base: Record<string, string>): { hardcoded: UiTextFinding[]; unknown: UiTextFinding[] };
export function auditProject(selected?: string[]): { languages: LocaleAudit[]; hardcoded: UiTextFinding[]; unknown: UiTextFinding[] };
