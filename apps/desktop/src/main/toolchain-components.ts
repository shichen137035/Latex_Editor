import type { LatexComponentId, ToolchainInstallSelection } from "@latex-editor/contracts" with { "resolution-mode": "import" };

const components: Record<LatexComponentId, { packages: string[]; files: string[] }> = {
  math: { packages: ["amsmath", "amsfonts", "mathtools"], files: ["amsmath.sty", "mathtools.sty"] },
  tables: { packages: ["caption", "booktabs", "multirow"], files: ["caption.sty", "booktabs.sty", "multirow.sty", "subcaption.sty"] },
  chinese: { packages: ["ctex", "xecjk", "fontspec", "fandol"], files: ["ctex.sty", "xeCJK.sty", "fontspec.sty"] },
  bibliography: { packages: ["biblatex", "csquotes", "natbib"], files: ["biblatex.sty", "csquotes.sty", "natbib.sty"] },
  graphics: { packages: ["pgf", "pgfplots", "xcolor"], files: ["tikz.sty", "pgfplots.sty", "xcolor.sty"] }
};
export function validateSelection(value: ToolchainInstallSelection | undefined): ToolchainInstallSelection {
  // Calls from older clients retain their original TinyTeX behavior.
  if (value === undefined) return { distribution: "tinytex", components: [], customPackages: [], full: false, autoInstall: false, existing: false };
  if (!value || !["miktex", "tinytex"].includes(value.distribution)
    || !Array.isArray(value.components) || value.components.length > 5 || value.components.some(id => !Object.hasOwn(components, id))
    || !Array.isArray(value.customPackages) || value.customPackages.length > 100
    || value.customPackages.some(id => typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9.+-]{0,99}$/.test(id))
    || [value.full, value.autoInstall, value.existing].some(flag => typeof flag !== "boolean")) throw new Error("Invalid LaTeX installation selection.");
  return { ...value, components: [...new Set(value.components)], customPackages: [...new Set(value.customPackages)] };
}
export function selectedPackages(selection: ToolchainInstallSelection): string[] {
  const packages = selection.components.flatMap(id => components[id].packages);
  return [...new Set([...packages, ...selection.customPackages])];
}
export function selectedFiles(selection: ToolchainInstallSelection): string[] {
  return [...new Set(selection.components.flatMap(id => components[id].files))];
}
