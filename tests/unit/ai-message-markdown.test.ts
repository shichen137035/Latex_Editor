import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AIMessageContent } from "../../apps/desktop/src/renderer/ai/AIMessageContent.js";

describe("AI message Markdown rendering", () => {
  it("renders tables, task lists, and common inline formatting", () => {
    const html = renderToStaticMarkup(createElement(AIMessageContent, {
      content: "## Result\n\n| Item | Status |\n| :--- | ---: |\n| **Build** | ~~failed~~ |\n\n- [x] Checked\n- [ ] Pending",
      projectRoot: ""
    }));

    expect(html).toContain("<h3>Result</h3>");
    expect(html).toContain("<table class=\"ai-markdown-table\">");
    expect(html).toContain("<strong>Build</strong>");
    expect(html).toContain("<del>failed</del>");
    expect(html).toContain("type=\"checkbox\" checked=\"\" readOnly=\"\"");
    expect(html).toContain("aria-label=\"Not completed\"");
  });

  it("keeps raw HTML inert", () => {
    const html = renderToStaticMarkup(createElement(AIMessageContent, { content: '<img src=x onerror="alert(1)">', projectRoot: "" }));
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img");
  });

  it("renders inline and display LaTeX with the shared project macro context", () => {
    const html = renderToStaticMarkup(createElement(AIMessageContent, {
      content: "Inline $\\RR_1$ and display:\n\n\\[x^2 + y^2\\]\n\n`$literal$`\n\n```tex\n$code$\n```",
      projectRoot: "",
      mathContext: { macros: { "\\RR": "\\mathbb{R}" }, operators: {}, sourceVersion: 1 }
    }));

    expect(html).toContain("preview-inline-math");
    expect(html).toContain("preview-display-math");
    expect(html).toContain("mathbb");
    expect(html).toContain("<code class=\"ai-inline-code\">$literal$</code>");
    expect(html).toContain("<code>$code$</code>");
  });
});
