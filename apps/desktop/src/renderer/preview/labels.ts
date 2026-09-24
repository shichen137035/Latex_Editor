import type { EnvironmentDefinition } from "./types.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Keep automatically-created labels predictable and valid for normal LaTeX references. */
export function environmentLabelStem(environmentName: string): string {
  return environmentName.replace(/\*+$/, "").replace(/[^A-Za-z0-9:_-]+/g, "-") || "block";
}

function environmentBeginPattern(environmentName: string): RegExp {
  return new RegExp(`\\\\begin\\{${escapeRegExp(environmentName)}\\}`, "g");
}

function commandPattern(command: string): RegExp {
  return new RegExp(`\\\\${escapeRegExp(command)}\\*?\\{`, "g");
}

export function environmentOccurrence(source: string, environmentName: string, endOffset = source.length): number {
  const prefix = source.slice(0, Math.max(0, endOffset));
  return [...prefix.matchAll(environmentBeginPattern(environmentName))].length;
}

function commandOccurrence(source: string, command: string, endOffset = source.length): number {
  const prefix = source.slice(0, Math.max(0, endOffset));
  return [...prefix.matchAll(commandPattern(command))].length;
}

export function nextAutomaticLabel(source: string, definition: EnvironmentDefinition): string | undefined {
  const name = definition.match.kind === "latex-environment" ? definition.match.name : definition.match.kind === "command" ? definition.match.command : undefined;
  if (!name) return undefined;
  const stem = environmentLabelStem(name);
  const labels = new Set([...source.matchAll(/\\label\s*\{([^}\n]+)\}/g)].map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value)));
  const occurrence = definition.match.kind === "latex-environment" ? environmentOccurrence(source, name) : commandOccurrence(source, name);
  let number = occurrence + 1;
  let candidate = `${stem}:${number}`;
  while (labels.has(candidate)) candidate = `${stem}:${++number}`;
  return candidate;
}

export function nextAutomaticEnvironmentLabel(source: string, definition: EnvironmentDefinition): string | undefined {
  return definition.match.kind === "latex-environment" ? nextAutomaticLabel(source, definition) : undefined;
}

export function isAutomaticLabel(source: string, startOffset: number, definition: EnvironmentDefinition, label: string): boolean {
  const name = definition.match.kind === "latex-environment" ? definition.match.name : definition.match.kind === "command" ? definition.match.command : undefined;
  if (!name) return false;
  const markerEnd = source.indexOf("}", startOffset);
  const occurrence = markerEnd >= 0
    ? definition.match.kind === "latex-environment" ? environmentOccurrence(source, name, markerEnd + 1) : commandOccurrence(source, name, markerEnd + 1)
    : 0;
  return occurrence > 0 && label === `${environmentLabelStem(name)}:${occurrence}`;
}

export function isAutomaticEnvironmentLabel(source: string, startOffset: number, environmentName: string, label: string): boolean {
  const definition = { match: { kind: "latex-environment", name: environmentName } } as EnvironmentDefinition;
  return isAutomaticLabel(source, startOffset, definition, label);
}

/** Insert the label just inside the environment so the body remains editable. */
export function addEnvironmentLabel(snippet: string, label: string | undefined): string {
  if (!label || !snippet.startsWith("\\begin{")) return snippet;
  const firstLineEnd = snippet.indexOf("\n");
  if (firstLineEnd < 0) return snippet;
  return `${snippet.slice(0, firstLineEnd + 1)}  \\label{${label}}\n${snippet.slice(firstLineEnd + 1)}`;
}

/** Insert a label after a section-like command while preserving the cursor position in its title. */
export function addCommandLabel(snippet: string, label: string | undefined): string {
  if (!label) return snippet;
  const command = /^\s*\\[A-Za-z@]+\*?\{[^{}]*\}/.exec(snippet);
  if (!command) return snippet;
  const commandEnd = command[0].length;
  return `${snippet.slice(0, commandEnd)}\\label{${label}}${snippet.slice(commandEnd)}`;
}

/** Replace an existing label or add one in the least surprising position for the block form. */
export function upsertBlockLabel(source: string, label: string): string {
  const existing = /(\\label\s*\{)[^}\n]*(\})/;
  if (existing.test(source)) return source.replace(existing, `$1${label}$2`);
  if (/^\s*\\begin\{/.test(source)) return addEnvironmentLabel(source, label);
  if (/^\s*\\[A-Za-z@]+\*?\{[^{}]*\}/.test(source)) return addCommandLabel(source, label);
  if (/^\s*\\\[/.test(source)) return source.replace(/(\\\[)/, `$1\n  \\label{${label}}`);
  return source;
}
