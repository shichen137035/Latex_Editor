export interface ThemeColorParameters {
  mode: "auto" | "light" | "dark";
  chromaScale: number;
  accentContrast: number;
  textContrast: number;
  fillMix: number;
  labelMix: number;
  borderMix: number;
}
export const themeColorDefaults: ThemeColorParameters = { mode: "auto", chromaScale: 1, accentContrast: 3, textContrast: 4.5, fillMix: .04, labelMix: .1, borderMix: .24 };
export const themeColorRanges = {
  chromaScale: { min: 0, max: 1.5, step: .05 }, accentContrast: { min: 1.5, max: 7, step: .1 }, textContrast: { min: 3, max: 12, step: .1 },
  fillMix: { min: 0, max: .3, step: .01 }, labelMix: { min: .02, max: .4, step: .01 }, borderMix: { min: .1, max: .8, step: .01 }
} as const;
export type ThemeColorProfiles = Record<string, Partial<ThemeColorParameters>>;
export function validThemeColorProfiles(value: unknown): value is ThemeColorProfiles {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 128) return false;
  return Object.entries(value).every(([id, profile]) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) && !!profile && typeof profile === "object" && !Array.isArray(profile)
    && Object.entries(profile).every(([key, entry]) => key === "mode" ? ["auto", "light", "dark"].includes(String(entry))
      : key in themeColorRanges && typeof entry === "number" && Number.isFinite(entry) && entry >= themeColorRanges[key as keyof typeof themeColorRanges].min && entry <= themeColorRanges[key as keyof typeof themeColorRanges].max));
}
