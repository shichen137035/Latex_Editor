import { t } from "../i18n/index.js";
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
    if (content !== plan.before) throw new Error(t("ui.searchReplacement.search_results_are_outdated_search_again_before", { value1: plan.fileId }));
    return { path: plan.fileId, content, dirty: false };
  }));
  await options.beforeApply?.();
  if (!options.isCurrent()) throw new Error(t("ui.searchReplacement.search_changed_before_replacement_search_again"));
  const currentTabs = options.tabs();
  for (const plan of plans) {
    const tab = currentTabs.find(item => item.path === plan.fileId);
    if (tab && tab.content !== plan.before) throw new Error(t("ui.searchReplacement.search_results_are_outdated_search_again_before", { value1: plan.fileId }));
  }
  const missing = baselines.filter(item => !currentTabs.some(tab => tab.path === item.path));
  if (missing.length) options.open(missing);
  for (const plan of plans) options.change(plan);
}
