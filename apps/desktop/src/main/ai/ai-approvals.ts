import { isAbsolute, resolve, sep } from "node:path";

/** Only ordinary file-inspection commands inside the copied AI workspace are approved automatically. */
export function isWorkspacePath(path: string, workspace: string): boolean {
  const root = resolve(workspace);
  const target = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const normalizedTarget = process.platform === "win32" ? target.toLowerCase() : target;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`);
}

/** Keep AI shell tools from launching independent TeX build utilities. */
export function isLatexCompilerCommand(...commands: string[]): boolean {
  return commands.some((command) => /\b(?:latexmk|pdflatex|xelatex|lualatex|tectonic|arara|bibtex|biber|makeindex|xindy)(?:\.exe)?\b/i.test(command));
}

export function isReadOnlyWorkspaceCommand(command: string): boolean {
  // On Windows Codex normally invokes powershell.exe -Command '<script>'.
  const shellScript = /(?:^|\s)-Command\s+(['"])([\s\S]*)\1\s*$/i.exec(command)?.[2];
  const source = shellScript ?? command;
  if (!source || /[;&><`$(){}\r\n]/.test(source)) return false;
  if (/(?:^|\s)\.\.(?:[\\/]|\s|$)|[a-z]:[\\/]|\\\\/i.test(source)) return false;
  return source.split("|").every((part) => /^\s*(?:Get-ChildItem|Get-Content|Get-Item|Get-Location|Test-Path|Select-String|Select-Object|Sort-Object|Measure-Object|rg|ls|dir|pwd|type)(?:\.exe)?(?=\s|$)/i.test(part));
}
