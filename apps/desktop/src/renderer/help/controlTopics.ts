import { t } from "../i18n/index.js";
import { commandBindings, displayBinding, type CommandId } from "../settings/commands.js";
import { controlDefinitions } from "./controlDefinitions.js";

export interface HelpTopic {
  id: string;
  title: string;
  description?: string;
  titleText?: string;
  shortcut?: string | undefined;
  disabled?: boolean;
  hint?: string | undefined;
}
export interface HelpTarget { element: Element; topic: HelpTopic }
export const helpControlSelector = "button, input, select, textarea, summary, [role='tab'], [role='switch']";
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

export function controlLabel(element: Element): string {
  return normalize(element.getAttribute("aria-label") || element.getAttribute("title") ||
    (element.matches("input, textarea, select") ? element.closest("label")?.textContent || element.getAttribute("placeholder") || "" : element.textContent || ""));
}

/** Labels are matched in the current locale and within a specific toolbar. */
export function controlHelp(element: Element): HelpTarget | undefined {
  if (!element.matches(helpControlSelector)) return undefined;
  const labels = [element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent].filter(Boolean).map(value => normalize(value!));
  const definition = controlDefinitions.find(item => element.matches(item.selector) && (!item.labels.length || item.labels.some(key => labels.includes(normalize(t(key))))));
  if (!definition) return undefined;
  const label = controlLabel(element);
  const title = definition.labels.find(key => labels.includes(normalize(t(key)))) ?? "helpMode.title";
  const hint = element.getAttribute("title");
  const command = "command" in definition ? definition.command as CommandId : undefined;
  return { element, topic: {
    id: definition.id, title, titleText: definition.labels.length ? t(title) : label || t(title), description: definition.description,
    disabled: element.matches(":disabled, [aria-disabled='true']"),
    hint: hint && normalize(hint) !== label ? hint : undefined,
    shortcut: command ? commandBindings(command).map(displayBinding).join(" / ") : undefined
  } };
}

export function controlTargets(root: ParentNode): HelpTarget[] {
  // Only catalogued selectors are queried: file rows and transcript messages
  // are not scanned just because they contain thousands of buttons.
  const elements = new Set<Element>();
  for (const definition of controlDefinitions) {
    if ("inspectOnly" in definition && definition.inspectOnly) continue;
    for (const element of Array.from(root.querySelectorAll(definition.selector))) elements.add(element);
  }
  return [...elements].flatMap(element => { const target = controlHelp(element); return target ? [target] : []; });
}
