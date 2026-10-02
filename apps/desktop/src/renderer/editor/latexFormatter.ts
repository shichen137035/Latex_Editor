export interface LatexFormattingOptions {
  insertSpaces: boolean;
  tabSize: number;
}

const rawEnvironmentNames = new Set([
  "alltt", "bverbatim", "comment", "filecontents", "filecontents*",
  "lstlisting", "minted", "saveverbatim", "sverb", "verbatim", "verbatim*",
  "lverbatim"
]);

function withoutComment(line: string): string {
  let backslashes = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "%" && backslashes % 2 === 0) return line.slice(0, index);
    backslashes = character === "\\" ? backslashes + 1 : 0;
  }
  return line;
}

function maskInlineVerbatim(line: string): string {
  return line.replace(/\\(?:verb|lstinline)\*?(.)[\s\S]*?\1/g, (match) => " ".repeat(match.length));
}

function environmentCommands(line: string): Array<{ action: "begin" | "end"; name: string }> {
  const code = maskInlineVerbatim(withoutComment(line));
  const commands: Array<{ action: "begin" | "end"; name: string }> = [];
  const pattern = /\\(begin|end)\s*\{([^{}]+)\}/g;
  for (const match of code.matchAll(pattern)) {
    const action = match[1];
    const name = match[2]?.trim();
    if ((action === "begin" || action === "end") && name) commands.push({ action, name });
  }
  return commands;
}

function leadingClosingCount(line: string, stack: string[]): number {
  let remainder = withoutComment(line).trimStart();
  let depth = stack.length;
  let count = 0;
  const closing = /^\\end\s*\{([^{}]+)\}\s*/;
  while (depth > 0) {
    const match = closing.exec(remainder);
    const name = match?.[1]?.trim();
    if (!match || !name || stack[depth - 1] !== name) break;
    depth -= 1;
    count += 1;
    remainder = remainder.slice(match[0].length);
  }
  return count;
}

function removeClosedEnvironment(stack: string[], name: string): void {
  const index = stack.lastIndexOf(name);
  if (index >= 0) stack.splice(index);
}

/** Indents LaTeX environment bodies while leaving raw-code environments untouched. */
export function formatLatexSource(source: string, options: LatexFormattingOptions): string {
  const lineEnding = source.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  const indentUnit = options.insertSpaces ? " ".repeat(Math.max(1, options.tabSize)) : "\t";
  const lines = source.split(/\r\n|\n|\r/);
  const stack: string[] = [];
  const formatted: string[] = [];
  let rawEnvironment: string | undefined;

  for (const line of lines) {
    if (rawEnvironment) {
      formatted.push(line);
      const rawClose = new RegExp(`\\\\end\\s*\\{\\s*${rawEnvironment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}`);
      if (rawClose.test(line)) {
        removeClosedEnvironment(stack, rawEnvironment);
        rawEnvironment = undefined;
      }
      continue;
    }

    const content = line.trim();
    if (!content) {
      formatted.push("");
      continue;
    }

    const indentDepth = Math.max(0, stack.length - leadingClosingCount(line, stack));
    formatted.push(`${indentUnit.repeat(indentDepth)}${content.replace(/[\t ]+$/, "")}`);

    for (const command of environmentCommands(line)) {
      if (command.action === "begin") {
        stack.push(command.name);
      } else {
        removeClosedEnvironment(stack, command.name);
      }
    }

    const topEnvironment = stack.at(-1);
    if (topEnvironment && rawEnvironmentNames.has(topEnvironment.toLocaleLowerCase())) {
      rawEnvironment = topEnvironment;
    }
  }

  return formatted.join(lineEnding);
}
