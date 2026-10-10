import { describe, expect, it } from "vitest";
import { cloneEnvironmentDefinitions, DEFAULT_ENVIRONMENTS, environmentOptionBrackets } from "../../apps/desktop/src/renderer/preview/environments.js";
import { environmentTitleTypography } from "../../apps/desktop/src/renderer/preview/environment-typography.js";
import { environmentBlockStyle } from "../../apps/desktop/src/renderer/preview/environment-block-style.js";
import { serializeEnvironments } from "../../apps/desktop/src/renderer/preview/environmentConfig.js";

describe("environment title typography", () => {
  it("takes optional-argument brackets from catalog configuration and honors explicit overrides", () => {
    const figure = cloneEnvironmentDefinitions().find(item => item.id === "figure")!;
    const assumption = cloneEnvironmentDefinitions().find(item => item.id === "assumption")!;
    expect(environmentOptionBrackets(figure)).toBe(true);
    expect(environmentOptionBrackets(assumption)).toBe(false);
    figure.behavior.showOptionBrackets = false;
    assumption.behavior.showOptionBrackets = true;
    expect(cloneEnvironmentDefinitions([figure, assumption]).map(environmentOptionBrackets)).toEqual([false, true]);
    expect(serializeEnvironments([figure, assumption])).toContain('showOptionBrackets="true"');
    expect(serializeEnvironments([figure])).toContain('showOptionBrackets="false"');
    delete figure.behavior.showOptionBrackets;
    expect(environmentOptionBrackets(figure)).toBe(true);
    const custom = { ...figure, id: "my-own-environment", builtIn: false };
    expect(environmentOptionBrackets(custom)).toBe(false);
    custom.behavior.showOptionBrackets = true;
    expect(environmentOptionBrackets(custom)).toBe(true);
  });
  it("keeps a descending chapter hierarchy while ordinary environment titles stay restrained", () => {
    const sizes = ["chapter", "section", "subsection", "subsubsection", "paragraph"].map(id => environmentTitleTypography(id, "section").titleFontSize);
    expect(sizes).toEqual([28, 24, 21, 18, 16]);
    expect(environmentTitleTypography("section-star", "section")).toEqual(environmentTitleTypography("section", "section"));
    expect(environmentTitleTypography("assumption", "definition")).toMatchObject({ titleFontSize: 16, titleFontWeight: 500 });
    expect(environmentTitleTypography("section", "section").titleFontWeight).toBe(600);
  });
  it("fills typography defaults while retaining explicitly fixed color overrides", () => {
    const definition = cloneEnvironmentDefinitions().find(item => item.id === "section")!;
    delete definition.style.titleFontSize; delete definition.style.titleFontWeight;
    definition.style.accentToken = "#abcdef";
    definition.style.colorMode = "fixed";
    expect(environmentBlockStyle("section", "section", definition)).toMatchObject({ "--preview-title-size": "24px", "--preview-title-weight": 600, "--block-accent": "#abcdef" });
    expect(definition.style.accentToken).toBe("#abcdef");
  });
  it("uses the source command hierarchy for renamed/custom heading definitions", () => {
    const definition = cloneEnvironmentDefinitions().find(item => item.id === "subsection")!;
    definition.id = "custom-heading"; delete definition.style.titleFontSize;
    expect(environmentTitleTypography(definition.id, definition.family, definition).titleFontSize).toBe(21);
  });
  it("maps custom sizes/weights to block styles and exports escaped XML", () => {
    const definition = cloneEnvironmentDefinitions().find(item => item.id === "section")!;
    Object.assign(definition.style, { titleFontSize: 32, titleFontWeight: 700, titleLineHeight: 1.5, titleLetterSpacing: 0.04, titleFontFamily: '"Segoe UI", sans-serif' });
    expect(environmentBlockStyle(definition.id, definition.family, definition)).toMatchObject({ "--preview-title-size": "32px", "--preview-title-weight": 700, "--preview-title-leading": 1.5, "--preview-title-spacing": "0.04em", "--preview-title-font": '"Segoe UI", sans-serif' });
    const xml = serializeEnvironments([definition]);
    expect(xml).toContain('titleFontFamily="&quot;Segoe UI&quot;, sans-serif"');
    expect(xml).toContain('titleFontSize="32"'); expect(xml).toContain('titleFontWeight="700"');
  });
  it("uses catalog defaults for malformed numeric values rather than invalid CSS", () => {
    const definition = cloneEnvironmentDefinitions().find(item => item.id === "section")!;
    Object.assign(definition.style, { titleFontSize: -1, titleFontWeight: Infinity, titleLineHeight: NaN, titleLetterSpacing: 99 });
    expect(environmentTitleTypography(definition.id, definition.family, definition)).toEqual(environmentTitleTypography("section", "section"));
    expect(DEFAULT_ENVIRONMENTS.find(item => item.id === "section")!.style.titleFontSize).toBe(24);
  });
});
