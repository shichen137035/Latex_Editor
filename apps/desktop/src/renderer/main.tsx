import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { App } from "./App.js";
import { formatLatexSource } from "./editor/latexFormatter.js";
import { settings } from "./settings/service.js";
import "./styles.css";
import "./themes/light.css";
import "./workbench/workbench.css";
import "./themes/dark.css";
import "./themes/tokens.css";
import "./project-directory.css";

// Keep the editor fully local. The default Monaco React loader uses a CDN,
// which would violate TeXWeave's offline-first desktop requirement.
loader.config({ monaco });
self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    return label === "json" ? new JsonWorker() : new EditorWorker();
  }
};
monaco.editor.defineTheme("texweave-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "delimiter.math", foreground: "087EBA", fontStyle: "bold" },
    { token: "keyword.math", foreground: "7A4FB0" },
    { token: "number.math", foreground: "A05A00" },
    { token: "string.math", foreground: "245A78" }
  ],
  colors: { "editor.background": "#ffffff" }
});
monaco.editor.defineTheme("texweave-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "delimiter.math", foreground: "65D6F2", fontStyle: "bold" },
    { token: "keyword.math", foreground: "D0A8FF" },
    { token: "number.math", foreground: "F3C477" },
    { token: "string.math", foreground: "B9DFF0" }
  ],
  colors: { "editor.background": "#182432" }
});
monaco.languages.register({ id: "latex" });
monaco.languages.setMonarchTokensProvider("latex", {
  tokenizer: {
    root: [
      [/%.*$/, "comment"],
      [/\\\(/, { token: "delimiter.math", next: "@mathParen" }],
      [/\\\[/, { token: "delimiter.math", next: "@mathBracket" }],
      [/\\[A-Za-z@]+/, "keyword"],
      [/\\./, "keyword"],
      [/[{}[\]]/, "delimiter"],
      [/\$\$?/, { token: "delimiter.math", next: "@mathDollar" }],
      [/\d+(?:\.\d+)?/, "number"]
    ],
    mathDollar: [
      [/\$\$?/, { token: "delimiter.math", next: "@pop" }],
      [/\\[A-Za-z@]+/, "keyword.math"],
      [/\\./, "keyword.math"],
      [/[{}[\]]/, "delimiter.math"],
      [/\d+(?:\.\d+)?/, "number.math"],
      [/[^\\$\n{}[\]]+/, "string.math"]
    ],
    mathParen: [
      [/\\\)/, { token: "delimiter.math", next: "@pop" }],
      [/\\[A-Za-z@]+/, "keyword.math"],
      [/\\./, "keyword.math"],
      [/[{}[\]]/, "delimiter.math"],
      [/\d+(?:\.\d+)?/, "number.math"],
      [/[^\\\n{}[\]]+/, "string.math"]
    ],
    mathBracket: [
      [/\\\]/, { token: "delimiter.math", next: "@pop" }],
      [/\\[A-Za-z@]+/, "keyword.math"],
      [/\\./, "keyword.math"],
      [/[{}[\]]/, "delimiter.math"],
      [/\d+(?:\.\d+)?/, "number.math"],
      [/[^\\\n{}[\]]+/, "string.math"]
    ]
  }
});
monaco.languages.registerDocumentFormattingEditProvider("latex", {
  provideDocumentFormattingEdits(model, options) {
    const source = model.getValue();
    const formatted = formatLatexSource(source, options);
    return formatted === source ? [] : [{ range: model.getFullModelRange(), text: formatted }];
  }
});

void settings.load().then(() => createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
));
