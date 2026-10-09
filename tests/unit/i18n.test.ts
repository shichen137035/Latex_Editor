import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { auditCatalogs, auditProject, inspectSource } from "../../apps/desktop/scripts/i18n-audit.mjs";
import { catalogs, getLocale, setLocale, t } from "../../apps/desktop/src/renderer/i18n/index.js";
import { environmentName, environmentNames, directiveName, directiveNames, languageName, styleResourceName, themeName } from "../../apps/desktop/src/renderer/i18n/displayNames.js";
import { cloneEnvironmentDefinitions, DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";
import { createCustomEnvironment, duplicateEnvironment, resetBuiltIn, serializeEnvironments } from "../../apps/desktop/src/renderer/preview/environmentConfig.js";
import { mergeEnvironmentEdit, mergeDirectiveEdit } from "../../apps/desktop/src/renderer/preview/environmentEdits.js";
import { settings } from "../../apps/desktop/src/renderer/settings/service.js";
import { defaultPreviewDirectives, preferenceDefaults, validPreference, type PreferenceKey, type StyleResource, type ThemeDefinition } from "@latex-editor/contracts";
import { translateNative } from "../../apps/desktop/src/main/i18n.js";
import { runSearchJob, type SearchWorker } from "../../apps/desktop/src/renderer/search/searchJob.js";

afterEach(() => { setLocale("en"); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function namePolicy(fixed: boolean, locale: typeof preferenceDefaults.locale = "en") {
  const values = { ...preferenceDefaults, fixedBlockNameLanguage: fixed, blockNameLanguage: locale };
  vi.spyOn(settings, "global").mockImplementation(((key: PreferenceKey) => values[key]) as typeof settings.global);
}

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
  it("translates built-in environment labels after a live locale change, retaining authored overrides", () => {
    namePolicy(false);
    const section = DEFAULT_ENVIRONMENTS.find(item => item.id === "section")!;
    expect(environmentName(section)).toBe("Section");
    setLocale("zh-CN");
    expect(environmentName(section)).toBe(catalogs["zh-CN"][section.labelKey]);
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

describe("localized block and command names", () => {
  const section = DEFAULT_ENVIRONMENTS.find(item => item.id === "section")!;
  const appendix = defaultPreviewDirectives.find(item => item.id === "appendix")!;
  it("defaults to fixed English for both types, independently of the interface", () => {
    setLocale("zh-CN");
    expect(environmentName(section)).toBe("Section");
    expect(directiveName(appendix)).toBe("Appendix begins");
    expect(preferenceDefaults.fixedBlockNameLanguage).toBe(true);
    expect(preferenceDefaults.blockNameLanguage).toBe("en");
  });
  it("uses per-language overrides without replacing names in other languages", () => {
    const environment = { ...section, labels: { en: "Part", "zh-CN": "分部" } };
    const command = { ...appendix, labels: { en: "Supplement", "zh-CN": "补充材料" } };
    expect(environmentName(environment, "en")).toBe("Part");
    expect(environmentName(environment, "zh-CN")).toBe("分部");
    expect(directiveName(command, "en")).toBe("Supplement");
    expect(directiveName(command, "zh-CN")).toBe("补充材料");
    expect(environmentNames(section)["zh-CN"]).toBe(catalogs["zh-CN"][section.labelKey]);
    expect(directiveNames(appendix)["zh-CN"]).toBe("附录开始");
  });
  it("applies the preferred language to both types and follows the UI when disabled", () => {
    namePolicy(true, "zh-CN"); setLocale("fr");
    expect(environmentName(section)).toBe(catalogs["zh-CN"][section.labelKey]); expect(directiveName(appendix)).toBe("附录开始");
    namePolicy(false); setLocale("en");
    expect(environmentName(section)).toBe("Section"); expect(directiveName(appendix)).toBe("Appendix begins");
  });
  it("skips empty entries, trying English then selector order, regardless of insertion order", () => {
    const labels = { "zh-CN": "自定义", fr: "Personnalisé", ja: "カスタム", en: " ", ko: "" };
    const environment = { ...section, id: "own", builtIn: false, labelKey: "", label: "", labels };
    const command = { ...appendix, id: "own", builtIn: false, label: "", labels };
    expect(environmentName(environment, "ko")).toBe("カスタム");
    expect(directiveName(command, "ko")).toBe("カスタム");
    labels.en = "Custom";
    expect(environmentName(environment, "ko")).toBe("Custom"); expect(directiveName(command, "ko")).toBe("Custom");
    expect(environmentName(environment, "zh-CN")).toBe("自定义");
  });
  it("handles empty or fabricated custom translation keys without catalog lookup", () => {
    for (const labelKey of ["", "environment.user-defined", "environment.section"]) {
      const environment = { ...section, id: "my-block", builtIn: false, label: "", labelKey, labels: { en: "", "zh-CN": "" } };
      expect(environmentNames(environment)).toEqual({});
      expect(environmentName(environment)).toBe("my-block");
    }
    expect(directiveName({ ...appendix, id: "my-command", builtIn: false, label: "", labels: { en: "" } })).toBe("my-command");
  });
  it("creates names in the current language, clones maps and duplicates localized names", () => {
    setLocale("zh-CN");
    const custom = createCustomEnvironment([]);
    expect(custom.labelKey).toBe(""); expect(custom.labels).toEqual({ "zh-CN": "自定义 1" });
    expect(environmentName(custom)).toBe("自定义 1");
    const [clone] = cloneEnvironmentDefinitions([custom]);
    clone!.labels!["zh-CN"] = "Clone";
    expect(custom.labels!["zh-CN"]).toBe("自定义 1");
    const copy = duplicateEnvironment({ ...section, labels: { en: "Part", "zh-CN": "分部" } }, [section]);
    expect(copy.builtIn).toBe(false); expect(copy.labelKey).toBe("");
    expect(environmentName(copy, "en")).toBe("Part copy"); expect(environmentName(copy, "zh-CN")).toBe("分部 副本");
    expect(resetBuiltIn({ ...section, labels: { en: "Part" } }).labels).toBeUndefined();
  });
  it("rebases rapid name edits in different languages and other properties without losing values", () => {
    const base = { ...section, labels: { en: "Part" } };
    const chinese = { ...base, labels: { ...base.labels, "zh-CN": "分部" } };
    const japanese = { ...base, labels: { ...base.labels, ja: "パート" } };
    const merged = mergeEnvironmentEdit(base, japanese, chinese);
    expect(merged.labels).toEqual({ en: "Part", "zh-CN": "分部", ja: "パート" });
    expect(mergeEnvironmentEdit(base, { ...base, enabled: false }, merged)).toMatchObject({ enabled: false, labels: merged.labels });
    const directive = { ...appendix, labels: { en: "Supplement" } };
    const result = mergeDirectiveEdit(directive, { ...directive, labels: { en: "Supplement", ja: "付録" } }, { ...directive, labels: { en: "Supplement", "zh-CN": "补充" } });
    expect(result.labels).toEqual({ en: "Supplement", "zh-CN": "补充", ja: "付録" });
  });
  it("validates persisted maps and retains blank entries and escaped text in XML", () => {
    const environment = { ...section, labels: { en: 'A & "B" <C>', "zh-CN": "", ja: "セクション" } };
    expect(validPreference("environments", [environment])).toBe(true);
    expect(validPreference("previewDirectives", [{ ...appendix, labels: environment.labels }])).toBe(true);
    for (const labels of [[], { en: 12 }, { "": "bad" }, null]) {
      expect(validPreference("environments", [{ ...section, labels }])).toBe(false);
      expect(validPreference("previewDirectives", [{ ...appendix, labels }])).toBe(false);
    }
    expect(validPreference("blockNameLanguage", "zh-CN")).toBe(true);
    expect(validPreference("blockNameLanguage", "bad")).toBe(false);
    const xml = serializeEnvironments([environment]);
    expect(xml).toContain('<name locale="en" value="A &amp; &quot;B&quot; &lt;C&gt;" />');
    expect(xml).toContain('<name locale="zh-CN" value="" />');
  });
});
