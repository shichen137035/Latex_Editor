import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { App } from "./App.js";
import { settings } from "./settings/service.js";
import "./styles.css";
import "./themes/light.css";
import "./workbench/workbench.css";
import "./themes/dark.css";
import "./themes/tokens.css";

// Keep the editor fully local. The default Monaco React loader uses a CDN,
// which would violate TeXWeave's offline-first desktop requirement.
loader.config({ monaco });
self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    return label === "json" ? new JsonWorker() : new EditorWorker();
  }
};
monaco.languages.register({ id: "latex" });
monaco.languages.setMonarchTokensProvider("latex", {
  tokenizer: {
    root: [
      [/%.*$/, "comment"],
      [/\\[A-Za-z@]+/, "keyword"],
      [/\\./, "keyword"],
      [/[{}[\]]/, "delimiter"],
      [/\$\$?/, "delimiter"],
      [/\d+(?:\.\d+)?/, "number"]
    ]
  }
});

void settings.load().then(() => createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
));
