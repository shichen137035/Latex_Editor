import type { ReplacementPlan } from "../search/SearchEngine.js";
import type { EditorTab } from "./fileActions.js";

interface ReplacementOptions {
  plans: ReplacementPlan[];
  tabs(): EditorTab[];
  read(path: string): Promise<string>;
  isCurrent(): boolean;
  beforeApply?(): Promise<void>;
  open(tabs: EditorTab[]): void;
  change(plan: ReplacementPlan): void;
}

/** Preflight every file before making any synchronous, undoable buffer changes. */
export async function applySearchReplacements(options: ReplacementOptions): Promise<void> {
  const plans = options.plans.filter(plan => plan.before !== plan.after);
  const baselines = await Promise.all(plans.map(async plan => {
    const tab = options.tabs().find(item => item.path === plan.fileId);
    const content = tab?.content ?? await options.read(plan.fileId);
    if (content !== plan.before) throw new Error(`Search results are outdated: ${plan.fileId}. Search again before replacing.`);
    return { path: plan.fileId, content, dirty: false };
  }));
  await options.beforeApply?.();
  if (!options.isCurrent()) throw new Error("Search changed before replacement. Search again.");
  const currentTabs = options.tabs();
  for (const plan of plans) {
    const tab = currentTabs.find(item => item.path === plan.fileId);
    if (tab && tab.content !== plan.before) throw new Error(`Search results are outdated: ${plan.fileId}. Search again before replacing.`);
  }
  const missing = baselines.filter(item => !currentTabs.some(tab => tab.path === item.path));
  if (missing.length) options.open(missing);
  for (const plan of plans) options.change(plan);
}
