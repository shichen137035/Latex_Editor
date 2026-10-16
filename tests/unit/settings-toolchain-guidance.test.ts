import { expect, it } from "vitest";
import type { LatexToolchain } from "@latex-editor/contracts";
import { toolchainReadiness, toolchainRecoveryHint } from "../../apps/desktop/src/renderer/settings/toolchainReadiness.js";
import { setLocale, supportedLocales, t } from "../../apps/desktop/src/renderer/i18n/index.js";

it("names the missing and broken programs in every supported language", () => {
  for (const locale of supportedLocales) {
    setLocale(locale);
    for (const key of ["toolchainGuide.required", "toolchainGuide.broken"]) {
      expect(t(key, { tools: "latexmk, xelatex" })).toContain("latexmk, xelatex");
      expect(t(key, { tools: "latexmk" })).not.toContain("{tools}");
    }
  }
  setLocale("en");
});

it("checks the selected engine instead of relying on a different working engine", () => {
  const toolchain = { available: true, overallStatus: "ready", latexmk: "latexmk", pdflatex: "pdflatex" } as LatexToolchain;
  expect(toolchainReadiness(toolchain, "pdflatex").ready).toBe(true);
  expect(toolchainReadiness(toolchain, "xelatex")).toMatchObject({ ready: false, missing: ["xelatex"] });
  toolchain.environment = { latexmk: { status: "broken", error: "Perl missing" }, pdflatex: { status: "ready" } } as NonNullable<LatexToolchain["environment"]>;
  expect(toolchainReadiness(toolchain, "pdflatex")).toMatchObject({ ready: false, broken: ["latexmk"], missing: ["latexmk"] });
  expect(toolchainReadiness(undefined, "xelatex")).toMatchObject({ known: false, ready: false });
});

it.each([
  ["fetch failed HTTP 503", "network"], ["EPERM: access denied", "permission"],
  ["Choose an empty folder", "folder"], ["checksum failed", "verification"],
  ["latexmk Perl not found", "runtime"], ["Unexpected setup error", "generic"]
])("offers recovery guidance for %s", (error, expected) => { expect(toolchainRecoveryHint(error)).toBe(expected); });
