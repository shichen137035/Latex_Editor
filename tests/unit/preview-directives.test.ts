import { describe, expect, it } from "vitest";
import { defaultPreviewDirectives, includeNewBuiltInDirectives, validPreference, type PreviewDirectiveDefinition } from "../../packages/contracts/src/settings.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";
import { parsePreview } from "../../apps/desktop/src/renderer/preview/parser.js";
import { reusePreviewDocument } from "../../apps/desktop/src/renderer/preview/renderModel.js";
import type { ContentRegion, PreviewNode, StructuralBlock } from "../../apps/desktop/src/renderer/preview/types.js";

function content(nodes: PreviewNode[]): ContentRegion[] {
  return nodes.flatMap((node) => node.kind === "content" ? [node] : content(node.children));
}

function blocks(nodes: PreviewNode[]): StructuralBlock[] {
  return nodes.flatMap((node) => node.kind === "block" ? [node, ...blocks(node.children)] : []);
}

describe("Preview command markers", () => {
  const source = "\\section{Intro}\nText before.\n\n\\appendix\n\\newpage\n\\bibliography{refs}\n\nText after.";

  it("renders standalone commands while leaving source blank lines unmarked", () => {
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS, defaultPreviewDirectives);
    const regions = content(document.nodes);
    expect(regions.filter((node) => node.contentType === "directive").map((node) => node.directiveId))
      .toEqual(["appendix", "newpage", "bibliography"]);
    expect(regions.some((node) => node.contentType === "spacer")).toBe(false);
    expect(regions.filter((node) => node.contentType === "paragraph").map((node) => node.raw))
      .toEqual(["Text before.", "Text after."]);
    for (const node of regions) expect(source.slice(node.source.startOffset, node.source.endOffset)).toBe(node.raw);
  });

  it("does not restore blank-line markers from older saved settings", () => {
    const oldBlankLineRule: PreviewDirectiveDefinition = {
      id: "blank-line", builtIn: true, enabled: true, match: { kind: "blank-line" },
      label: "Blank line", display: "spacer", color: "#a0afbc"
    };
    const saved = [...defaultPreviewDirectives, oldBlankLineRule];
    expect(includeNewBuiltInDirectives(saved).some((item) => item.id === "blank-line")).toBe(false);
    const regions = content(parsePreview("First.\n\nSecond.", "main.tex", DEFAULT_ENVIRONMENTS, saved).nodes);
    expect(regions.map((node) => node.raw)).toEqual(["First.", "Second."]);
  });

  it("marks explicit vertical spacing commands", () => {
    const input = "First.\n\n\\vspace{1cm}\n\\medskip\n\\newline\n\\linebreak[4]\n\nSecond.";
    const regions = content(parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, defaultPreviewDirectives).nodes);
    expect(regions.filter((node) => node.contentType === "directive").map((node) => node.directiveId)).toEqual(["vspace", "medskip", "newline", "linebreak"]);
    expect(regions.filter((node) => node.contentType === "spacer")).toHaveLength(0);
  });

  it("detaches a trailing run from all open heading scopes, including CRLF and comments", () => {
    const input = "\\begin{document}\r\n\\section{Main}\r\n\\subsection{Details}\r\nText.\r\n\\medskip % spacing\r\n% final comment\r\n\\vspace{1cm}\r\n\\end{document}";
    const parsed = parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, defaultPreviewDirectives);
    const tailStart = input.indexOf("\\medskip");
    expect(blocks(parsed.nodes).every((node) => node.source.endOffset === tailStart)).toBe(true);
    expect(parsed.nodes.slice(1).map((node) => node.kind === "content" ? node.directiveId : node.environmentId)).toEqual(["medskip", "vspace"]);
    expect(parsed.nodes.slice(1).every((node) => node.parentId === undefined)).toBe(true);
    for (const node of content(parsed.nodes)) expect(input.slice(node.source.startOffset, node.source.endOffset)).toBe(node.raw);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("keeps spacing inside a section when content follows it", () => {
    const input = "\\section{Main}\nFirst.\n\\medskip\nSecond.";
    const parsed = parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, defaultPreviewDirectives);
    expect(parsed.nodes).toHaveLength(1);
    expect(content(parsed.nodes).find((node) => node.directiveId === "medskip")?.parentId).toBe(parsed.nodes[0]?.id);
    expect(parsed.nodes[0]?.source.endOffset).toBe(input.length);
  });

  it("places a subsection tail in its containing section when that section continues", () => {
    const input = "\\section{Main}\n\\subsection{A}\nText.\n\\newpage\n\\subsection{B}\nMore.";
    const parsed = parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, defaultPreviewDirectives);
    const subsection = blocks(parsed.nodes).find((node) => node.title === "A")!;
    expect(subsection.source.endOffset).toBe(input.indexOf("\\newpage"));
    expect(content(parsed.nodes).find((node) => node.directiveId === "newpage")?.parentId).toBe(parsed.nodes[0]?.id);
  });

  it("ends every preceding heading at appendix even when more text and lower headings follow", () => {
    const input = "\\section{Main}\n\\subsection{Last}\nText.\n\\appendix\nAppendix text.\n\\subsection{Appendix details}\nMore.";
    const parsed = parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, defaultPreviewDirectives);
    expect(parsed.nodes.map((node) => node.kind === "block" ? node.title : node.directiveId ?? node.raw)).toEqual(["Main", "appendix", "Appendix text.", "Appendix details"]);
    expect(blocks(parsed.nodes).filter((node) => node.title !== "Appendix details").every((node) => node.source.endOffset === input.indexOf("\\appendix"))).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("recognizes independent part switches on the same line as text and a heading", () => {
    const input = "\\section{Main}\nText. \\appendix \\subsection{Appendix}\nMore.";
    const parsed = parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, defaultPreviewDirectives);
    expect(parsed.nodes.map((node) => node.kind === "block" ? node.title : node.directiveId)).toEqual(["Main", "appendix", "Appendix"]);
    expect(parsed.nodes[0]?.source.endOffset).toBe(input.indexOf("\\appendix"));
    expect(content(parsed.nodes).find((node) => node.directiveId === "appendix")?.raw).toBe("\\appendix");
    expect(parsed.diagnostics).toEqual([]);
  });

  it("does not turn command arguments, macro bodies, escapes or comments into part boundaries", () => {
    const input = "\\section{Main}\n\\texttt{\\appendix}\n\\newcommand{\\example}{\n\\appendix\n}\n\\\\appendix\n% \\appendix\nText.";
    const parsed = parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, defaultPreviewDirectives);
    expect(parsed.nodes).toHaveLength(1);
    expect(content(parsed.nodes).some((node) => node.directiveId === "appendix")).toBe(false);
    expect(parsed.nodes[0]?.source.endOffset).toBe(input.length);
  });

  it("preserves explicit environment wrappers and ignores boundary commands in code/disabled content", () => {
    const input = "\\section{Main}\n\\begin{proof}\nText.\n\\medskip\n\\end{proof}\n\\begin{verbatim}\n\\appendix\n\\end{verbatim}\n%<texweave:disable>\n\\appendix\n%</texweave:disable>\nEnd.";
    const parsed = parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, defaultPreviewDirectives);
    const proof = blocks(parsed.nodes).find((node) => node.environmentId === "proof")!;
    expect(content(proof.children).find((node) => node.directiveId === "medskip")?.parentId).toBe(proof.id);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]?.source.endOffset).toBe(input.length);
    expect(parsed.diagnostics).toEqual([]);
  });

  it("lets custom commands choose a scope boundary without making file inclusions independent", () => {
    const custom: PreviewDirectiveDefinition = { id: "my-part", builtIn: false, enabled: true, match: { kind: "command", name: "mypart" }, label: "Part", display: "divider", color: "#123456", placement: "independent" };
    const input = "\\section{Main}\nText.\n\\mypart\n\\input{body}";
    const parsed = parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, [...defaultPreviewDirectives, custom]);
    expect(parsed.nodes.map((node) => node.kind === "block" ? node.environmentId : node.directiveId)).toEqual(["section", "my-part", "input"]);
    const included = parsePreview("\\section{Main}\n\\input{body}", "main.tex", DEFAULT_ENVIRONMENTS, defaultPreviewDirectives);
    expect(included.nodes).toHaveLength(1);
    expect(content(included.nodes)[0]?.parentId).toBe(included.nodes[0]?.id);
  });

  it("upgrades old command rules with scope defaults while retaining existing customization", () => {
    const legacy = defaultPreviewDirectives.map((item) => {
      const previous = { ...item, label: `Custom ${item.label}` };
      delete previous.placement;
      return previous;
    });
    const migrated = includeNewBuiltInDirectives(legacy);
    expect(migrated.find((node) => node.id === "appendix")).toMatchObject({ label: "Custom Appendix begins", placement: "independent" });
    expect(migrated.find((node) => node.id === "vspace")?.placement).toBe("trailing");
    expect(validPreference("previewDirectives", legacy)).toBe(true);
    expect(validPreference("previewDirectives", [{ ...migrated[0], placement: "invalid" }])).toBe(false);
  });

  it("keeps inline commands and commented commands out of the marker list", () => {
    const input = "Text \\newpage inside prose.\n% \\appendix\n\\newpage";
    const regions = content(parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, defaultPreviewDirectives).nodes);
    expect(regions.filter((node) => node.contentType === "directive").map((node) => node.raw)).toEqual(["\\newpage"]);
    expect(regions.some((node) => node.contentType === "paragraph" && node.raw.includes("inside prose"))).toBe(true);
  });

  it("honors disabled and custom command rules without changing the core parser default", () => {
    const custom: PreviewDirectiveDefinition = {
      id: "custom-command", builtIn: false, enabled: true, match: { kind: "command", name: "mybreak" },
      label: "Custom break", display: "divider", color: "#123456"
    };
    const rules = [...defaultPreviewDirectives.map((item) => item.id === "newpage" ? { ...item, enabled: false } : item), custom];
    const input = "\\newpage\n\\mybreak";
    const regions = content(parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, rules).nodes);
    expect(regions.filter((node) => node.contentType === "directive").map((node) => node.directiveId)).toEqual(["custom-command"]);
    expect(regions.some((node) => node.contentType === "paragraph" && node.raw.includes("\\newpage"))).toBe(true);
    expect(content(parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS).nodes).every((node) => node.contentType === "paragraph")).toBe(true);
  });

  it("validates command definitions before saving", () => {
    expect(validPreference("previewDirectives", defaultPreviewDirectives)).toBe(true);
    expect(validPreference("previewDirectives", [{ ...defaultPreviewDirectives[0], match: { kind: "command", name: "bad name" } }])).toBe(false);
  });

  it("updates the marker identity when a command rule changes", () => {
    const input = "\\newpage";
    const first = parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, defaultPreviewDirectives);
    const custom: PreviewDirectiveDefinition = {
      id: "my-page-break", builtIn: false, enabled: true, match: { kind: "command", name: "newpage" },
      label: "My page break", display: "placeholder", color: "#123456"
    };
    const nextRules = [...defaultPreviewDirectives.filter((item) => item.id !== "newpage"), custom];
    const parsed = parsePreview(input, "main.tex", DEFAULT_ENVIRONMENTS, nextRules);
    const reused = reusePreviewDocument(first, input, parsed, input, () => "fresh-id");
    expect(content(reused.nodes)[0]?.directiveId).toBe("my-page-break");
  });
});
