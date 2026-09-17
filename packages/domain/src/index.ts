export interface Clock { now(): Date }
export interface IdGenerator { next(): string }

export const systemClock: Clock = { now: () => new Date() };

export function isoNow(clock: Clock): string {
  return clock.now().toISOString();
}

export function normalizePathKey(canonicalPath: string, caseInsensitive: boolean): string {
  return caseInsensitive ? canonicalPath.toLocaleLowerCase("en-US") : canonicalPath;
}
