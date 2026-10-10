import { t } from "../i18n/index.js";
import "./color-token-input.css";

export function normalizePickerColor(value: string): string {
  let color = value.trim();
  const variable = color.match(/^var\((--[\w-]+)(?:\s*,\s*([^)]*))?\)$/);
  if (variable) color = variable[1] && typeof document !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue(variable[1]).trim() || variable[2] || "" : variable[2] || "";
  if (/^--[\w-]+$/.test(color) && typeof document !== "undefined") {
    color = getComputedStyle(document.documentElement).getPropertyValue(color).trim();
  }
  const hex = color.match(/^#([\da-f]{3,8})$/i)?.[1];
  if (hex) {
    const rgb = hex.length === 3 || hex.length === 4
      ? hex.slice(0, 3).split("").map((part) => part + part).join("")
      : hex.slice(0, 6);
    if (rgb.length === 6) return `#${rgb}`;
  }
  const rgb = color.match(/^rgba?\(\s*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})/i);
  if (rgb) return `#${rgb.slice(1).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("")}`;
  if (color && typeof document !== "undefined") {
    const probe = document.createElement("span");
    probe.style.color = color;
    if (probe.style.color) {
      document.body.append(probe);
      const computed = getComputedStyle(probe).color.match(/^rgba?\(\s*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})/i);
      probe.remove();
      if (computed) return `#${computed.slice(1).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return "#2f84c5";
}

function swatchColor(value: string): string {
  const trimmed = value.trim();
  return /^--[\w-]+$/.test(trimmed) ? `var(${trimmed}, #2f84c5)` : trimmed;
}

export function ColorTokenInput({ value, label, onChange }: { value: string; label: string; onChange(value: string): void }) {
  return <div className="color-token-control">
    <label className="color-token-picker" title={label}>
      <input type="color" aria-label={t("ui.ColorTokenInput.color_picker", { value1: label })} value={normalizePickerColor(value)} onChange={(event) => onChange(event.target.value)}/>
      <span aria-hidden="true" style={{ backgroundColor: swatchColor(value) }}/>
    </label>
    <input className="color-token-value" aria-label={t("ui.ColorTokenInput.token_or_css_color", { value1: label })} value={value} onChange={(event) => onChange(event.target.value)}/>
  </div>;
}
