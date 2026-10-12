import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AIMessageContent } from "../../apps/desktop/src/renderer/ai/AIMessageContent.js";
import { AIResponse } from "../../apps/desktop/src/renderer/ai/AIResponse.js";

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
    const checkboxes = html.match(/<input\b[^>]*>/g) ?? [];
    expect(checkboxes).toHaveLength(2);
    for (const checkbox of checkboxes) {
      expect(checkbox).toContain("type=\"checkbox\"");
      expect(checkbox).toContain("readOnly=\"\"");
    }
    expect(checkboxes[0]).toContain("checked=\"\"");
    expect(checkboxes[0]).toContain("aria-label=\"Completed\"");
    expect(checkboxes[1]).not.toContain("checked=");
    expect(checkboxes[1]).toContain("aria-label=\"Not completed\"");
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

  it("groups adjacent thought summaries into one item while keeping response order", () => {
    const html = renderToStaticMarkup(createElement(AIResponse, {
      projectRoot: "",
      message: {
        id: "assistant-1",
        role: "assistant",
        content: "The answer.",
        createdAt: 1,
        status: "complete",
        reasoning: [
          { id: "r1", text: "First thought.", complete: true },
          { id: "r2", text: "Second thought.", complete: true },
          { id: "r3", text: "Later thought.", complete: true },
          { id: "r4", text: "Final thought.", complete: true }
        ],
        responseParts: [
          { id: "r1", kind: "reasoning", text: "First thought." },
          { id: "r2", kind: "reasoning", text: "Second thought." },
          { id: "answer", kind: "text", text: "The answer." },
          { id: "r3", kind: "reasoning", text: "Later thought." },
          { id: "r4", kind: "reasoning", text: "Final thought." }
        ]
      }
    }));

    const groups = html.match(/<details class="ai-reasoning"[\s\S]*?<\/details>/g) ?? [];
    expect(groups).toHaveLength(2);
    expect(groups[0]).toContain("First thought.");
    expect(groups[0]).toContain("Second thought.");
    expect(groups[1]).toContain("Later thought.");
    expect(groups[1]).toContain("Final thought.");
    expect(html.indexOf("Second thought.")).toBeLessThan(html.indexOf("The answer."));
    expect(html.indexOf("The answer.")).toBeLessThan(html.indexOf("Later thought."));
  });
});
