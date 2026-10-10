import type { ThemeColorParameters } from "@latex-editor/contracts";
export type RGB = [number, number, number];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const linear = (n: number) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
const srgb = (n: number) => n <= .0031308 ? 12.92 * n : 1.055 * n ** (1 / 2.4) - .055;
export function parseHex(color: string): RGB | undefined {
  let value = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (!value) return;
  if (value.length === 3) value = value.split("").map(char => char + char).join("");
  return [0, 2, 4].map(at => parseInt(value!.slice(at, at + 2), 16) / 255) as RGB;
}
export const hexColor = (rgb: RGB) => `#${rgb.map(n => Math.round(clamp(n) * 255).toString(16).padStart(2, "0")).join("")}`;
export function luminance(rgb: RGB): number { const [r, g, b] = rgb.map(linear); return r! * .2126 + g! * .7152 + b! * .0722; }
export function contrast(a: RGB, b: RGB): number { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
function toLab(rgb: RGB): RGB {
  const [r, g, b] = rgb.map(linear) as RGB;
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s, 1.9779984951 * l - 2.428592205 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .808675766 * s];
}
function fromLab([L, a, b]: RGB): RGB {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [srgb(4.0767416621 * l - 3.3077115913 * m + .2309699292 * s), srgb(-1.2684380046 * l + 2.6097574011 * m - .3413193965 * s), srgb(-.0041960863 * l - .7034186147 * m + 1.707614701 * s)];
}
function inGamut(L: number, a: number, b: number): RGB {
  let scale = 1, rgb = fromLab([L, a, b]);
  for (let attempt = 0; attempt < 40 && rgb.some(n => n < 0 || n > 1); attempt++) { scale *= .85; rgb = fromLab([L, a * scale, b * scale]); }
  return rgb.map(clamp) as RGB;
}
function readable(seed: RGB, surface: RGB, ratio: number, dark: boolean): RGB {
  if (contrast(seed, surface) >= ratio) return seed;
  const [L, a, b] = toLab(seed);
  const candidates = [dark ? 1 : 0, dark ? 0 : 1].map(end => {
    let failed = L, passed = end;
    const terminal = inGamut(end, a, b);
    if (contrast(terminal, surface) < ratio) return terminal;
    for (let attempt = 0; attempt < 25; attempt++) {
      const mid = (failed + passed) / 2, rgb = inGamut(mid, a, b);
      if (contrast(rgb, surface) >= ratio) passed = mid; else failed = mid;
    }
    return inGamut(passed, a, b);
  });
  return candidates.find(rgb => contrast(rgb, surface) >= ratio) ?? candidates.sort((x, y) => contrast(y, surface) - contrast(x, surface))[0]!;
}
const mix = (accent: RGB, surface: RGB, amount: number) => accent.map((value, index) => value * amount + surface[index]! * (1 - amount)) as RGB;
export interface SemanticColorRoles { accent: string; fill: string; border: string; selectedBorder: string; labelBackground: string; labelText: string }
export function foregroundForSurface(text: RGB, surface: RGB, ratio: number): string {
  return hexColor(readable(text, surface, ratio, luminance(surface) < .35));
}
/** A seed's hue is retained; OKLab lightness/chroma and measured contrast adapt its roles. */
export function deriveColorRoles(seed: RGB, panel: RGB, p: ThemeColorParameters): SemanticColorRoles {
  const dark = p.mode === "auto" ? luminance(panel) < .35 : p.mode === "dark";
  const [L, a, b] = toLab(seed);
  const toned = inGamut(dark ? Math.max(.72, L) : L, a * p.chromaScale, b * p.chromaScale);
  const accent = readable(toned, panel, p.accentContrast, dark);
  const label = mix(accent, panel, p.labelMix);
  const text = readable(toned, label, p.textContrast, dark);
  return { accent: hexColor(accent), fill: hexColor(mix(accent, panel, p.fillMix)), border: hexColor(mix(accent, panel, p.borderMix)), selectedBorder: hexColor(accent), labelBackground: hexColor(label), labelText: hexColor(text) };
}
