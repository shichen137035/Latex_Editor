import { describe, expect, it } from "vitest";
import { convertBlockEnvironmentSource, definitionConversionGroup, environmentConversionGroup } from "../../apps/desktop/src/renderer/preview/EnvironmentPicker.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";
import type { EnvironmentDefinition } from "../../apps/desktop/src/renderer/preview/types.js";

function definition(id: string): EnvironmentDefinition {
  const result = DEFAULT_ENVIRONMENTS.find((item) => item.id === id);
  if (!result) throw new Error(`Missing test environment: ${id}`);
  return result;
}

describe("Preview block environment conversion", () => {
  it("changes heading commands without losing the title, star or body", () => {
    const source = "\\section*{Stable title}\nBody text.";
    expect(environmentConversionGroup(source)).toBe("command");
    expect(definitionConversionGroup(definition("subsection"))).toBe("command");
    expect(convertBlockEnvironmentSource(source, definition("subsection"))).toBe("\\subsection*{Stable title}\nBody text.");
  });

  it("changes LaTeX environment markers while preserving options and labels", () => {
    const source = "\\begin{theorem}[Named]\nStatement.\\label{thm:named}\n\\end{theorem}";
    expect(convertBlockEnvironmentSource(source, definition("definition"))).toBe("\\begin{definition}[Named]\nStatement.\\label{thm:named}\n\\end{definition}");
  });

  it("converts between display-math and named environment wrappers", () => {
    const display = "\\[\nx+y\n\\]";
    const equation = "\\begin{equation}\nx+y\n\\end{equation}";
    expect(convertBlockEnvironmentSource(display, definition("equation"))).toBe(equation);
    expect(convertBlockEnvironmentSource(equation, definition("display-math"))).toBe(display);
  });

  it("updates only the type metadata of virtual blocks", () => {
    const target: EnvironmentDefinition = { ...definition("remark"), id: "virtual-note", match: { kind: "virtual-block", type: "note" } };
    const source = "% tw:block-begin type=idea title=\"Keep me\"\nBody\n% tw:block-end";
    expect(convertBlockEnvironmentSource(source, target)).toBe("% tw:block-begin type=note title=\"Keep me\"\nBody\n% tw:block-end");
  });
});
