import type { languages } from "monaco-editor";

// Shared by source and embedded editors through Monaco's LaTeX language registration.
export const latexLanguageConfiguration: languages.LanguageConfiguration = {
  comments: { lineComment: "%" },
  brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
  indentationRules: {
    increaseIndentPattern: /^(?:[^%\\]|\\.)*(?:\\begin\s*\{[^{}]+\}(?:\[[^\]]*\])?|[[{(]|\\\[)\s*(?:%.*)?$/,
    decreaseIndentPattern: /^\s*(?:\\end\s*\{[^{}]+\}|[\]})]|\\\])/,
  },
  onEnterRules: [
    {
      beforeText: /^\s*\\begin\s*\{([^{}]+)\}(?:\[[^\]]*\])?\s*$/,
      afterText: /^\s*\\end\s*\{[^{}]+\}/,
      action: { indentAction: 2 }, // IndentOutdent: content line plus an aligned closing line.
    },
    {
      beforeText: /^\s*\\\[\s*$/,
      afterText: /^\s*\\\]/,
      action: { indentAction: 2 },
    },
    {
      beforeText: /^(?:[^%\\]|\\.)*\\begin\s*\{[^{}]+\}(?:\[[^\]]*\])?\s*(?:%.*)?$/,
      action: { indentAction: 1 }, // Indent, using the editor's configured tab size.
    },
  ],
};
