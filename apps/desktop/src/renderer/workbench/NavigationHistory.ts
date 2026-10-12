import { sourceLabelOffset } from "../editor/ProjectReferenceIndex.js";

export interface NavigationLocation {
  path: string;
  offset: number;
  layout: {
    mode: "single" | "split";
    singlePane: "source" | "preview" | "pdf";
    leftPane: "source" | "preview";
    rightPane: "preview" | "pdf";
  };
  /** A jump that started on a link can only return while that link survives. */
  link?: { start: number; text: string; targetLabel: string; targetPath?: string };
}

interface NavigationStep { from: NavigationLocation; to: NavigationLocation }
type TextEdit = { start: number; end: number; newLength: number };

export function navigationLocationValid(location: NavigationLocation, content: string | undefined, readTarget?: (path: string) => string | undefined): boolean {
  if (content === undefined || location.offset > content.length) return false;
  const link = location.link;
  const target = link?.targetPath && link.targetPath !== location.path ? readTarget?.(link.targetPath) : content;
  return !link || (content.slice(link.start, link.start + link.text.length) === link.text
    && target !== undefined && sourceLabelOffset(target, link.targetLabel) !== undefined);
}

function mapOffset(offset: number, edits: TextEdit[]): number {
  let delta = 0;
  for (const edit of edits) {
    if (offset < edit.start) break;
    if (offset < edit.end) return edit.start + delta + Math.min(edit.newLength, offset - edit.start);
    delta += edit.newLength - (edit.end - edit.start);
  }
  return Math.max(0, offset + delta);
}

/** One jump is one undo/redo step. New jumps discard only the redo branch. */
export class NavigationHistory {
  private backSteps: NavigationStep[] = [];
  private forwardSteps: NavigationStep[] = [];

  get canBack(): boolean { return this.backSteps.length > 0; }
  get canForward(): boolean { return this.forwardSteps.length > 0; }

  clear(): void {
    this.backSteps = [];
    this.forwardSteps = [];
  }

  record(from: NavigationLocation, to: NavigationLocation): void {
    if (from.path === to.path && from.offset === to.offset && from.layout.mode === to.layout.mode
      && from.layout.singlePane === to.layout.singlePane && from.layout.leftPane === to.layout.leftPane) return;
    this.backSteps.push({ from, to });
    if (this.backSteps.length > 100) this.backSteps.shift();
    this.forwardSteps = [];
  }

  back(valid: (location: NavigationLocation) => boolean): NavigationLocation | undefined {
    while (this.backSteps.length) {
      const step = this.backSteps.pop()!;
      if (!valid(step.from) || !valid(step.to)) continue;
      this.forwardSteps.push(step);
      return step.from;
    }
    return undefined;
  }

  forward(valid: (location: NavigationLocation) => boolean): NavigationLocation | undefined {
    while (this.forwardSteps.length) {
      const step = this.forwardSteps.pop()!;
      if (!valid(step.from) || !valid(step.to)) continue;
      this.backSteps.push(step);
      return step.to;
    }
    return undefined;
  }

  mapEdit(path: string, edits: TextEdit[]): void {
    if (!edits.length) return;
    const ordered = [...edits].sort((a, b) => a.start - b.start);
    const remap = (location: NavigationLocation): NavigationLocation => {
      if (location.path !== path) return location;
      const link = location.link;
      const mappedLink = link ? { ...link, start: mapOffset(link.start, ordered) } : undefined;
      return { ...location, offset: link ? mappedLink!.start : mapOffset(location.offset, ordered), ...(mappedLink ? { link: mappedLink } : {}) };
    };
    this.backSteps = this.backSteps.map(({ from, to }) => ({ from: remap(from), to: remap(to) }));
    this.forwardSteps = this.forwardSteps.map(({ from, to }) => ({ from: remap(from), to: remap(to) }));
  }
}
