import { useEffect, useState } from "react";
import * as monaco from "monaco-editor";
import type { ThemeDefinition } from "@latex-editor/contracts";
import { useSettings } from "../settings/service.js";
import { configureSemanticColors, ensureSemanticColorSeeds } from "./semanticColors.js";

const customThemeStyleId = "texweave-custom-theme";

export function editorThemeName(themeId: string): string {
  return themeId === "dark" ? "texweave-dark" : themeId === "tech-light" ? "texweave-tech-light" : themeId === "light" ? "texweave-light" : "texweave-custom";
}

/** Loads user CSS after the built-in token sheets so custom variables win. */
export function ThemeRuntime() {
  const store = useSettings();
  const activeTheme = store.get("theme");
  const colorProfiles = store.global("themeColorProfiles");
  const [themes, setThemes] = useState<ThemeDefinition[]>([]);

  useEffect(() => {
    const reload = () => { void window.latexEditor?.themes.list().then(setThemes).catch(() => setThemes([])); };
    reload();
    window.addEventListener("texweave-themes-changed", reload);
    return () => window.removeEventListener("texweave-themes-changed", reload);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = activeTheme;
    ensureSemanticColorSeeds();
    document.getElementById(customThemeStyleId)?.remove();
    const selected = themes.find((theme) => theme.id === activeTheme);
    if (!selected?.css) { configureSemanticColors(colorProfiles[activeTheme]); return; }
    const style = document.createElement("style");
    style.id = customThemeStyleId;
    style.dataset.theme = selected.id;
    style.textContent = selected.css;
    document.head.appendChild(style);
    configureSemanticColors(colorProfiles[activeTheme]);
    const rootStyles = getComputedStyle(document.documentElement);
    const background = rootStyles.getPropertyValue("--color-bg-panel").trim() || "#ffffff";
    const foreground = rootStyles.getPropertyValue("--color-text-primary").trim() || "#172c45";
    const dark = rootStyles.getPropertyValue("color-scheme").trim() === "dark";
    monaco.editor.defineTheme("texweave-custom", { base: dark ? "vs-dark" : "vs", inherit: true, rules: [], colors: { "editor.background": background, "editor.foreground": foreground } });
    return () => style.remove();
  }, [activeTheme, themes, colorProfiles]);

  return null;
}
