import type { EnvironmentDefinition } from "./types.js";

function patchFields(base: object, next: object, latest: object): object {
  const before = base as Record<string, unknown>, after = next as Record<string, unknown>;
  const result = { ...latest } as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (Object.is(before[key], after[key]) && Object.hasOwn(before, key) === Object.hasOwn(after, key)) continue;
    if (Object.hasOwn(after, key)) result[key] = after[key]; else delete result[key];
  }
  return result;
}

/** Rebase one form edit while a previous settings write is still being acknowledged. */
export function mergeEnvironmentEdit(base: EnvironmentDefinition, next: EnvironmentDefinition, latest: EnvironmentDefinition): EnvironmentDefinition {
  return {
    ...patchFields(base, next, latest),
    style: patchFields(base.style, next.style, latest.style),
    behavior: patchFields(base.behavior, next.behavior, latest.behavior),
    match: patchFields(base.match, next.match, latest.match)
  } as EnvironmentDefinition;
}
