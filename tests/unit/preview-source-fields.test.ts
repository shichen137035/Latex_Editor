import { expect, it } from "vitest";
import { captionSourceField, environmentOptionField, replaceSourceField } from "../../apps/desktop/src/renderer/preview/sourceFields.js";

it("edits only the optional environment argument and preserves all float content", () => {
  const source = "\\begin{figure*}[htbp]\n\\includegraphics{a}\n\\caption{Text}\\label{fig:a}\n\\end{figure*}";
  const field = environmentOptionField(source)!;
  expect(field.value).toBe("htbp");
  expect(replaceSourceField(source, field, "H")).toBe(source.replace("[htbp]", "[H]"));
  expect(environmentOptionField("\\begin{table}\ntext [abc]")).toBeUndefined();
});

it("keeps nested LaTeX, optional short captions, starred commands and comments intact", () => {
  const source = "\\begin{table}[h]\n% \\caption{wrong}\n\\caption*[Short {name}]{A \\textbf{nested} caption with $x$ and \\{braces\\}}\\label{tab:a}\n\\end{table}";
  const field = captionSourceField(source)!;
  expect(field.body.value).toBe("A \\textbf{nested} caption with $x$ and \\{braces\\}");
  expect(replaceSourceField(source, field, "\\caption{New}")).toBe(source.replace(field.value, "\\caption{New}"));
  expect(replaceSourceField(source.replace("nested", "changed"), field, "\\caption{New}")).toBeUndefined();
});

it("selects the outer caption rather than the caption belonging to a subfigure", () => {
  const source = "\\begin{figure}\n\\begin{subfigure}{.5\\textwidth}\\caption{Small}\\end{subfigure}\n\\caption{Outer}\\end{figure}";
  expect(captionSourceField(source)?.body.value).toBe("Outer");
  expect(captionSourceField("\\caption{unclosed")).toBeUndefined();
});
