import { controlHelp, controlTargets, type HelpTarget } from "./controlTopics.js";
export type { HelpTopic, HelpTarget } from "./controlTopics.js";
/** Central descriptions shared by pointer inspection and the visible-region tour. */
export const helpTopics = [
  { id: "create", selector: ".directory-new-control", title: "project.new" },
  { id: "import", selector: ".directory-import", title: "directory.import" },
  { id: "projects", selector: ".directory-table-card", title: "directory.projects" },
  { id: "findProject", selector: ".directory-global-search, .directory-controls", title: "directory.search" },
  { id: "library", selector: ".library-app-shell, .directory-library", title: "activity.library" },
  { id: "menus", selector: ".workbench-topbar", title: "app.name" },
  { id: "activity", selector: ".activity-bar", title: "helpMode.heading.tools" },
  { id: "files", selector: ".tree-section", title: "sidebar.files" },
  { id: "outline", selector: ".outline-section", title: "sidebar.outline" },
  { id: "views", selector: ".editor-view-controls", title: "helpMode.heading.views" },
  { id: "insert", selector: ".latex-toolbar", title: "helpMode.heading.insert" },
  { id: "tabs", selector: ".editor-tabs", title: "helpMode.heading.tabs" },
  { id: "editor", selector: ".editor-surface, .structured-preview", title: "helpMode.heading.editor" },
  { id: "compile", selector: ".compile-button, .engine-picker", title: "build.compile" },
  { id: "pdf", selector: ".pdf-document", title: "helpMode.heading.pdf" },
  { id: "sidebar", selector: ".sidebar", title: "helpMode.heading.tools" },
  { id: "resize", selector: ".vertical-resizer, .horizontal-resizer, .split-resizer, .bottom-resizer", title: "helpMode.heading.resize" },
  { id: "status", selector: ".status-bar, .bottom-panel", title: "panel.problems" },
  { id: "settings", selector: ".preferences-body, .preferences-dialog", title: "activity.settings" },
  { id: "workspace", selector: ".workspace", title: "helpMode.heading.editor" }
] as const;
export function helpTargetVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth &&
    !element.closest('[inert], [aria-hidden="true"], [data-help-ui]') && getComputedStyle(element).visibility !== "hidden";
}

export function visibleHelpTargets(root: ParentNode = document): HelpTarget[] {
  const regions = helpTopics.flatMap(topic => Array.from(root.querySelectorAll(topic.selector)).map(element => ({ element, topic })));
  const controls = controlTargets(root);
  const specific = new Set(controls.map(target => target.element));
  const targets: HelpTarget[] = [...regions.filter(target => !specific.has(target.element)), ...controls];
  return targets.filter(({ element }) => helpTargetVisible(element)).sort((a, b) => {
    if (a.element === b.element) return Number(Boolean(a.topic.description)) - Number(Boolean(b.topic.description));
    return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

export function helpTarget(element: Element) {
  // Closest region wins, so specific controls take precedence over their panels.
  for (let current: Element | null = element; current; current = current.parentElement) {
    const control = controlHelp(current);
    if (control) return control;
    const topic = helpTopics.find(topic => current!.matches(topic.selector));
    if (topic) return { element: current, topic };
  }
  return undefined;
}
