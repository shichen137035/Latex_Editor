import { afterEach, describe, expect, it } from "vitest";
import { catalogs, setLocale } from "../../apps/desktop/src/renderer/i18n/index.js";
import { controlDefinitions } from "../../apps/desktop/src/renderer/help/controlDefinitions.js";
import { controlHelp, helpControlSelector } from "../../apps/desktop/src/renderer/help/controlTopics.js";
import { commandCatalog } from "../../apps/desktop/src/renderer/settings/commands.js";
import { adjacentHelpTarget, helpNavigation } from "../../apps/desktop/src/renderer/help/navigation.js";
import type { HelpTarget } from "../../apps/desktop/src/renderer/help/controlTopics.js";

afterEach(() => setLocale("en"));
function control(selector: string, label: string, disabled = false) {
  return {
    matches: (value: string) => value === selector || value === helpControlSelector || disabled && value === ":disabled, [aria-disabled='true']",
    getAttribute: (name: string) => name === "title" ? label : null,
    textContent: label
  } as unknown as Element;
}
describe("toolbar help descriptions", () => {
  it("keeps identifiers, labels, descriptions and command links valid", () => {
    expect(new Set(controlDefinitions.map(item => item.id)).size).toBe(controlDefinitions.length);
    for (const definition of controlDefinitions) {
      for (const key of definition.labels) expect(catalogs.en[key], key).toBeTruthy();
      for (const catalog of Object.values(catalogs)) expect(catalog[definition.description], definition.id).toBeTruthy();
      if ("command" in definition) expect(commandCatalog[definition.command]).toBeTruthy();
    }
  });
  it("routes an insertion control in both English and Chinese", () => {
    const spec = controlDefinitions.find(item => item.id === "insert.table")!;
    for (const locale of ["en", "zh-CN"] as const) {
      setLocale(locale);
      expect(controlHelp(control(spec.selector, catalogs[locale]["editor.quick.table"]!))?.topic.description).toBe("helpDetail.insert.table");
    }
  });
  it("does not confuse matching text in an unrelated toolbar", () => {
    expect(controlHelp(control(".unrelated-toolbar button", catalogs.en["editor.quick.table"]!))).toBeUndefined();
  });
  it("explains disabled controls without losing their keyboard shortcut", () => {
    const target = controlHelp(control(".compile-button", "Compile", true));
    expect(target?.topic).toMatchObject({ disabled: true, description: "helpDetail.compile" });
    expect(target?.topic.shortcut).toContain("Shift+B");
  });
});

describe("hierarchical help navigation", () => {
  function target(id: string, parent?: HelpTarget): HelpTarget {
    const ancestors = new Set<Element>(parent ? [parent.element] : []);
    const element = { isConnected: true, contains: (other: Element) => other === element || (other as unknown as { ancestors: Set<Element> }).ancestors.has(element as unknown as Element), ancestors };
    if (parent) for (const ancestor of (parent.element as unknown as typeof element).ancestors) ancestors.add(ancestor);
    return { element: element as unknown as Element, topic: { id, title: id } };
  }
  it("browses root regions and drills down one level at a time", () => {
    const sidebar = target("sidebar"), toolbar = target("toolbar"), views = target("views", toolbar);
    const bold = target("bold", toolbar), code = target("code", views), visual = target("visual", views);
    const targets = [sidebar, toolbar, bold, views, code, visual];
    expect(helpNavigation(targets).peers).toEqual([sidebar, toolbar]);
    expect(helpNavigation(targets, toolbar).children).toEqual([bold, views]);
    expect(helpNavigation(targets, code)).toMatchObject({ parent: views, peers: [code, visual], children: [], ancestors: [toolbar, views] });
    expect(helpNavigation(targets, views).parent).toBe(toolbar);
  });
  it("wraps among peers and preserves the selected position", () => {
    const first = target("first"), last = target("last");
    expect(adjacentHelpTarget([first, last], first, -1)).toBe(last);
    expect(adjacentHelpTarget([first, last], last, 1)).toBe(first);
    expect(adjacentHelpTarget([], first, 1)).toBeUndefined();
  });
  it("lets pointer-only controls navigate back into their containing region", () => {
    const region = target("region"), messageCopy = target("copy", region);
    expect(helpNavigation([region], messageCopy)).toMatchObject({ parent: region, peers: [messageCopy], children: [] });
  });
});
