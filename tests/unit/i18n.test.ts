import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { auditCatalogs, auditProject, inspectSource } from "../../apps/desktop/scripts/i18n-audit.mjs";
import { catalogs, getLocale, setLocale, t } from "../../apps/desktop/src/renderer/i18n/index.js";
import { environmentName, directiveName, languageName, styleResourceName, themeName } from "../../apps/desktop/src/renderer/i18n/displayNames.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";
import { defaultPreviewDirectives, type StyleResource, type ThemeDefinition } from "@latex-editor/contracts";
import { translateNative } from "../../apps/desktop/src/main/i18n.js";
import { runSearchJob, type SearchWorker } from "../../apps/desktop/src/renderer/search/searchJob.js";

afterEach(() => { setLocale("en"); vi.unstubAllGlobals(); });

describe("language catalogs and diagnostics", () => {
  it("reports the exact locale, missing key and mismatched interpolation variables", () => {
    const [report] = auditCatalogs({ en: { hello: "Hello {{name}}", count: "{{count}} entries" }, "zh-CN": { count: "{{total}} 条文献" }, ja: { hello: "こんにちは {{name}}", count: "{{count}} 件" } }, ["zh-CN"]);
    expect(report).toMatchObject({ locale: "zh-CN", translated: 1, missing: [{ key: "hello", source: "Hello {{name}}" }], placeholders: [{ key: "count", expected: ["count"], actual: ["total"] }] });
  });
  it("finds UI text and undefined keys without treating conditions or LaTeX source as labels", () => {
    const source = `const options = [["grid", "Grid"]]; const title = \`Row \${row}\`; function View() { return <section data-mode="source"><button title="Open">Save</button><input placeholder={"Type here"}/>{mode === "source" && <span>{t("known")}</span>}<code>\\section</code><span>TeXWeave</span><span>{t("missing.key")}</span></section>; }`;
    const result = inspectSource(source, "view.tsx", { known: "Known" });
    expect(result.hardcoded.map(item => item.text)).toEqual(["Grid", "Row {{…}}", "Open", "Save", "Type here"]);
    expect(result.unknown.map(item => item.text)).toEqual(["missing.key"]);
  });
  it("keeps the complete Simplified Chinese catalog and audited UI synchronized", () => {
    const report = auditProject(["zh-CN"]);
    expect(report.languages[0]?.missing).toEqual([]);
    expect(report.languages[0]?.placeholders).toEqual([]);
    expect(report.languages[0]?.extra).toEqual([]);
    expect(report.unknown).toEqual([]);
    expect(report.hardcoded).toEqual([]);
  });
  it("interpolates Chinese text, keeps unknown user keys readable and falls back for incomplete languages", () => {
    setLocale("zh-CN");
    expect(getLocale()).toBe("zh-CN");
    expect(t("status.line", { line: 4, column: 7 })).toBe("第 4 行，第 7 列");
    expect(t("custom.user.key")).toBe("custom.user.key");
    setLocale("ja");
    expect(t("native.zipArchive")).toBe(catalogs.en["native.zipArchive"]);
  });
  it("uses the package version consistently in every language", () => {
    const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
    vi.stubGlobal("__APP_VERSION__", version);
    for (const language of ["en", "zh-CN", "ja"] as const) { setLocale(language); expect(t("app.version")).toBe("v" + version); }
  });
  it("translates built-in environment labels after a live locale change, retaining authored overrides", () => {
    const section = DEFAULT_ENVIRONMENTS.find(item => item.id === "section")!;
    expect(environmentName(section)).toBe("Section");
    setLocale("zh-CN");
    expect(environmentName(section)).toBe("节");
    expect(environmentName({ ...section, label: "My authored heading" })).toBe("My authored heading");
    const command = defaultPreviewDirectives.find(item => item.id === "appendix")!;
    expect(directiveName(command)).toBe("附录开始");
    expect(directiveName({ ...command, label: "My appendix marker" })).toBe("My appendix marker");
  });
  it("translates presets and language names without renaming custom resources or themes", () => {
    setLocale("zh-CN");
    const resource = { id: "default", name: "Default", source: "built-in", files: [] } as StyleResource;
    expect(styleResourceName(resource)).toBe("默认");
    expect(styleResourceName({ ...resource, source: "user", name: "My style" })).toBe("My style");
    const theme = { id: "dark", name: "Dark", source: "built-in" } as ThemeDefinition;
    expect(themeName(theme)).toBe("深色");
    expect(themeName({ ...theme, source: "user", name: "My theme" })).toBe("My theme");
    expect(languageName("en-US")).toContain("英语");
  });
  it("shares native dialog translations with the renderer catalogs", () => {
    expect(translateNative("zh-CN", "native.exportPdf")).toBe("编译并导出 PDF");
    expect(translateNative("ja", "native.exportPdf")).toBe(catalogs.en["native.exportPdf"]);
  });
  it("localizes worker error keys in the host without loading language catalogs in the worker", async () => {
    setLocale("zh-CN");
    const port: SearchWorker = { onmessage: null, onerror: null, terminate: vi.fn(), postMessage: () => { queueMicrotask(() => port.onmessage?.({ data: { error: "ui.SearchEngine.invalid_search_expression" } } as MessageEvent)); } };
    const result = await runSearchJob({ kind: "search", query: { text: "test", caseSensitive: false, wholeWord: false, useRegex: false, scope: "project" }, documents: [] }, undefined, () => port);
    expect(result).toEqual({ error: "搜索表达式无效。" });
    expect(readFileSync("apps/desktop/src/renderer/search/SearchEngine.ts", "utf8")).not.toContain("i18n/index");
  });
});
