import type { HelpTarget } from "./controlTopics.js";

const same = (left: HelpTarget | undefined, right: HelpTarget | undefined) => left?.element === right?.element;

/** DOM containment supplies the hierarchy for both regional and control help. */
export function helpNavigation(targets: HelpTarget[], current?: HelpTarget) {
  const all = current && current.element.isConnected && !targets.some(item => same(item, current)) ? [...targets, current] : targets;
  const parentOf = (target: HelpTarget) => all.reduce<HelpTarget | undefined>((parent, item) => {
    if (same(item, target) || !item.element.contains(target.element)) return parent;
    return !parent || parent.element.contains(item.element) ? item : parent;
  }, undefined);
  const childrenOf = (parent?: HelpTarget) => all.filter(item => same(parentOf(item), parent));
  const parent = current ? parentOf(current) : undefined;
  const ancestors: HelpTarget[] = [];
  for (let ancestor = parent; ancestor; ancestor = parentOf(ancestor)) ancestors.unshift(ancestor);
  return { parent, ancestors, peers: childrenOf(parent), children: current ? childrenOf(current) : [] };
}

export function adjacentHelpTarget(peers: HelpTarget[], current: HelpTarget | undefined, direction: number) {
  const index = peers.findIndex(item => same(item, current));
  if (!peers.length) return undefined;
  if (index < 0) return direction < 0 ? peers.at(-1) : peers[0];
  return peers[(index + direction + peers.length) % peers.length];
}
