import { themeColorDefaults, themeColorRanges, type ThemeColorParameters } from "@latex-editor/contracts";
import catalog from "../../../../../resources/environments/preview-environments.json" with { type: "json" };
import { deriveColorRoles, foregroundForSurface, parseHex, type RGB, type SemanticColorRoles } from "./colorMath.js";

export const colorPalette = catalog.colorPalette as Record<string, string>;
const seeds = new Map<string, string>();
const foregrounds = new Map<string, string>();
const roleNames = ["accent", "fill", "border", "selectedBorder", "labelBackground", "labelText"] as const;
const suffixes = ["accent", "fill", "border", "selected-border", "label-bg", "label-text"];
const fixedStyleId = "texweave-color-seeds", adaptiveStyleId = "texweave-adaptive-colors";
let panel: RGB = [1, 1, 1], foreground: RGB = [.09, .17, .27], parameters = { ...themeColorDefaults }, queued = false;
const cssValue = (value: string) => value.startsWith("--") ? `var(${value})` : value;
function identifier(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `--semantic-${(hash >>> 0).toString(16)}`;
}
function styleNode(id: string): HTMLStyleElement {
  let node = document.getElementById(id) as HTMLStyleElement | null;
  if (!node) {
    node = document.createElement("style"); node.id = id;
    // Imported themes may override generated role aliases or parameters explicitly.
    document.head.insertBefore(node, document.getElementById("texweave-custom-theme"));
  }
  return node;
}
export function ensureSemanticColorSeeds(): void {
  if (typeof document === "undefined") return;
  styleNode(fixedStyleId).textContent = `:root{${Object.entries(colorPalette).map(([name, value]) => `--env-${name}-base:${value};`).join("")}}`;
  for (const name of Object.keys(colorPalette)) seeds.set(`--env-${name}-base`, identifier(`--env-${name}-base`));
}
function resolveColor(value: string, fallback: RGB): RGB {
  const direct = parseHex(value); if (direct) return direct;
  const probe = document.createElement("span");
  probe.style.color = cssValue(value); probe.style.display = "none";
  if (!probe.style.color) return fallback;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color; probe.remove();
  const rgb = computed.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\)/);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    return rgb.slice(1, 4).map((part, index) => Number(part) / 255 * alpha + fallback[index]! * (1 - alpha)) as RGB;
  }
  // Browser color-mix/OKLCH values are converted to sRGB by canvas.
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return fallback;
  context.fillStyle = computed; context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!].map((n, index) => n / 255 * a! / 255 + fallback[index]! * (1 - a! / 255)) as RGB;
}
function rebuild(): void {
  if (typeof document === "undefined") return;
  const rules: string[] = [];
  for (const [seed, prefix] of seeds) {
    const derived = deriveColorRoles(resolveColor(seed, parseHex("#3979c6")!), panel, parameters);
    roleNames.forEach(role => rules.push(`${prefix}-${role}:${derived[role]};`));
    const name = /^--env-([A-Za-z0-9_-]+)-base$/.exec(seed)?.[1];
    if (name) roleNames.forEach((role, index) => rules.push(`--env-${name}-${suffixes[index]}:var(${prefix}-${role});`));
  }
  const style = styleNode(adaptiveStyleId);
  // Publish new roles first: fixed fills may explicitly reference these aliases.
  style.textContent = `:root{${rules.join("")}}`;
  if (foregrounds.size) {
    for (const [surface, property] of foregrounds) rules.push(`${property}:${foregroundForSurface(foreground, resolveColor(surface, panel), parameters.textContrast)};`);
    style.textContent = `:root{${rules.join("")}}`;
  }
}
export function configureSemanticColors(overrides: Partial<ThemeColorParameters> = {}): void {
  ensureSemanticColorSeeds();
  const styles = getComputedStyle(document.documentElement);
  panel = resolveColor(styles.getPropertyValue("--color-bg-panel").trim() || "#ffffff", [1, 1, 1]);
  foreground = resolveColor(styles.getPropertyValue("--color-text-primary").trim() || "#172c45", [.09, .17, .27]);
  parameters = { ...themeColorDefaults };
  const mode = styles.getPropertyValue("--semantic-color-mode").trim();
  if (["auto", "light", "dark"].includes(mode)) parameters.mode = mode as ThemeColorParameters["mode"];
  for (const field of Object.keys(themeColorRanges) as Array<keyof typeof themeColorRanges>) {
    const cssName = field.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), raw = styles.getPropertyValue(`--semantic-${cssName}`).trim();
    const value = Number(raw), bounds = themeColorRanges[field];
    if (raw && Number.isFinite(value) && value >= bounds.min && value <= bounds.max) parameters[field] = value;
  }
  parameters = { ...parameters, ...overrides };
  rebuild();
  window.dispatchEvent(new Event("texweave:semantic-colors-changed"));
}
export function effectiveThemeColorParameters(): ThemeColorParameters { return { ...parameters }; }
/** Fixed block fills still get readable body text without changing their explicit colors. */
export function semanticForeground(surface: string): string {
  const property = `${identifier(surface)}-content-text`;
  if (!foregrounds.has(surface) && foregrounds.size >= 256) return foregroundForSurface(foreground, parseHex(surface) ?? panel, parameters.textContrast);
  if (!foregrounds.has(surface) && foregrounds.size < 256) {
    foregrounds.set(surface, property);
    if (!queued && typeof document !== "undefined") { queued = true; queueMicrotask(() => { queued = false; rebuild(); }); }
  }
  return `var(${property}, var(--color-text-primary))`;
}
/** Register once per seed; components reference CSS roles so switching themes needs no per-block color work. */
export function semanticColorRoles(base: string): SemanticColorRoles {
  const seed = base.trim() || "--env-generic-base";
  let prefix = seeds.get(seed);
  if (!prefix) {
    if (seeds.size >= 1024) return deriveColorRoles(parseHex(seed) ?? parseHex("#3979c6")!, panel, parameters);
    prefix = identifier(seed);
    if (seeds.size < 1024) {
      seeds.set(seed, prefix);
      if (!queued && typeof document !== "undefined") { queued = true; queueMicrotask(() => { queued = false; rebuild(); }); }
    }
  }
  const name = /^--env-([A-Za-z0-9_-]+)-base$/.exec(seed)?.[1];
  return Object.fromEntries(roleNames.map((role, index) => [role, `var(${name ? `--env-${name}-${suffixes[index]}` : `${prefix}-${role}`}, ${cssValue(seed)})`])) as unknown as SemanticColorRoles;
}
