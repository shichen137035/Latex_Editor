/** Strip presentational LaTeX while preserving boundary whitespace between inline nodes. */
export function plainLatex(value: string): string {
  return value
    .replace(/^\s*%.*$/gm, "")
    .replace(/%[^\n]*/g, "")
    .replace(/\\label\{[^}]+\}/g, "")
    .replace(/\\(?:begin|end)\{[^}]+\}/g, "")
    .replace(/\\(?:caption|section|subsection|subsubsection)\*?\{([^}]*)\}/g, "$1")
    .replace(/\\(?:textbf|textit|emph|textrm|texttt)\{([^}]*)\}/g, "$1")
    .replace(/\\(?:[A-Za-z]*cite[A-Za-z]*)\{([^}]*)\}/g, "[$1]")
    .replace(/\\(?:[A-Za-z]*ref[A-Za-z]*)\{([^}]*)\}/g, "[$1]")
    .replace(/\\(?:quad|qquad)/g, "  ")
    .replace(/\\,/g, " ")
    .replace(/\\([%&_#$])/g, "$1");
}
