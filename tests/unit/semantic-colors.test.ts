import { expect, it } from "vitest";
import { themeColorDefaults, validThemeColorProfiles } from "../../packages/contracts/src/theme-colors.js";
import { contrast, deriveColorRoles, foregroundForSurface, parseHex } from "../../apps/desktop/src/renderer/themes/colorMath.js";
import { environmentColorRoles, environmentBaseColor } from "../../apps/desktop/src/renderer/preview/environment-colors.js";
import { cloneEnvironmentDefinitions } from "../../apps/desktop/src/renderer/preview/environments.js";
import { serializeEnvironments } from "../../apps/desktop/src/renderer/preview/environmentConfig.js";

it("derives readable roles for light, dark and tinted surfaces from the same seeds", () => {
  for (const surface of ["#ffffff", "#182432", "#241d3b", "#fff0f6", "#777777"]) for (const seed of ["#3979c6", "#159eae", "#bc5484", "#eeeeee", "#111111", "#ffff00"]) {
    const roles = deriveColorRoles(parseHex(seed)!, parseHex(surface)!, themeColorDefaults);
    expect(contrast(parseHex(roles.accent)!, parseHex(surface)!)).toBeGreaterThanOrEqual(2.95);
    expect(contrast(parseHex(roles.labelText)!, parseHex(roles.labelBackground)!)).toBeGreaterThanOrEqual(4.45);
    expect(Object.values(roles).every(value => /^#[a-f0-9]{6}$/.test(value))).toBe(true);
  }
});

it("adapts colors through parameters instead of theme IDs", () => {
  const seed = parseHex("#159eae")!, panel = parseHex("#ffffff")!;
  const standard = deriveColorRoles(seed, panel, themeColorDefaults);
  const tinted = deriveColorRoles(seed, panel, { ...themeColorDefaults, labelMix: .3, textContrast: 7 });
  expect(tinted.labelBackground).not.toBe(standard.labelBackground);
  expect(contrast(parseHex(tinted.labelText)!, parseHex(tinted.labelBackground)!)).toBeGreaterThan(6.9);
  expect(deriveColorRoles(seed, parseHex("#182432")!, themeColorDefaults).accent).not.toBe(standard.accent);
});

it("keeps explicit fixed colors and exports color policy/base through XML", () => {
  const definition = cloneEnvironmentDefinitions().find(item => item.id === "algorithm")!;
  expect(environmentBaseColor(definition.id, definition)).toBe("--env-algorithm-base");
  definition.style.colorMode = "fixed";
  Object.assign(definition.style, { accentToken: "#123456", fillToken: "#abcdef", labelBackgroundToken: "#fedcba", labelTextToken: "#654321" });
  expect(environmentColorRoles(definition.id, definition)).toMatchObject({ accent: "#123456", fill: "#abcdef", labelBackground: "#fedcba", labelText: "#654321" });
  expect(serializeEnvironments([definition])).toContain('colorMode="fixed"');
  expect(serializeEnvironments([definition])).toContain('baseColor="--env-algorithm-base"');
});

it("validates per-theme profiles and rejects invalid numerical overrides", () => {
  expect(validThemeColorProfiles({ dark: { labelMix: .14, mode: "auto" } })).toBe(true);
  expect(validThemeColorProfiles({ dark: { labelMix: 2 } })).toBe(false);
  expect(validThemeColorProfiles({ dark: { extra: 1 } })).toBe(false);
});

it("keeps body text readable on fixed surfaces across themes", () => {
  for (const text of ["#172c45", "#e0eaf3"]) for (const surface of ["#ffffff", "#182432", "#ffccdd"]) {
    const foreground = foregroundForSurface(parseHex(text)!, parseHex(surface)!, 4.5);
    expect(contrast(parseHex(foreground)!, parseHex(surface)!)).toBeGreaterThanOrEqual(4.45);
  }
});
