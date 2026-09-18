export interface ToolbarInsertion {
  text: string;
  cursorOffset: number;
  triggerSuggestions?: boolean;
}

function commandInsertion(command: string, selectedText: string, triggerSuggestions = false): ToolbarInsertion {
  const prefix = `\\${command}{`;
  if (selectedText) return { text: `${prefix}${selectedText}}`, cursorOffset: prefix.length + selectedText.length };
  return { text: `${prefix}}`, cursorOffset: prefix.length, ...(triggerSuggestions ? { triggerSuggestions: true } : {}) };
}

function displayMathInsertion(selectedText: string): ToolbarInsertion {
  if (selectedText) {
    const text = `\\[\n${selectedText}\n\\]`;
    return { text, cursorOffset: text.length - 2 };
  }
  return { text: "\\[\n  \n\\]", cursorOffset: 5 };
}

function blockInsertion(kind: "figure" | "table", selectedText: string): ToolbarInsertion {
  if (kind === "figure") {
    const body = selectedText ? `  ${selectedText}\n` : "";
    const text = `\\begin{figure}\n  \\centering\n${body}  \\caption{}\n\\end{figure}`;
    const caption = text.indexOf("\\caption{") + "\\caption{".length;
    return { text, cursorOffset: caption };
  }
  const body = selectedText ? `  ${selectedText}\n` : "  ";
  const text = `\\begin{table}\n  \\centering\n${body}\n\\end{table}`;
  const cursorOffset = selectedText ? text.length - "\n\\end{table}".length : text.indexOf("\\centering") + "\\centering".length + 3;
  return { text, cursorOffset };
}

/** Builds a toolbar insertion while keeping the cursor inside empty braces. */
export function toolbarInsertion(id: string, selectedText: string): ToolbarInsertion | undefined {
  switch (id) {
    case "section": return commandInsertion("section", selectedText);
    case "bold": return commandInsertion("textbf", selectedText);
    case "math": return displayMathInsertion(selectedText);
    case "figure": return blockInsertion("figure", selectedText);
    case "table": return blockInsertion("table", selectedText);
    case "reference": return commandInsertion("ref", selectedText, true);
    case "citation": return commandInsertion("cite", selectedText, true);
    default: return undefined;
  }
}
