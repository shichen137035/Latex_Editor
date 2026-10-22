import { preferenceDefaults, primitivePreferenceSchema, projectPreferenceKeys, validPreference, type PreferenceKey, type PreferenceValues, type SettingsSnapshot } from "@latex-editor/contracts";

export type CompanionScope = "global" | "project";
export interface CompanionAction { id: string; label: string; available: boolean }
export interface CompanionChoice { value: string | number; label: string }
export interface CompanionPorts {
  settings: {
    snapshot(): SettingsSnapshot;
    projectId(): string | undefined;
    subscribe(listener: () => void): () => void;
    set(key: PreferenceKey, value: PreferenceValues[PreferenceKey] | undefined, scope: CompanionScope): Promise<void>;
    choices?(key: PreferenceKey): Promise<CompanionChoice[]>;
  };
  actions: { list(): CompanionAction[]; run(id: string): Promise<boolean> };
  message(key: string): string;
}
export type CompanionRequest =
  | { method: "context" | "settings.list" | "settings.undo" | "actions.list" }
  | { method: "settings.read" | "settings.reset" | "settings.choices"; key: string; scope?: CompanionScope }
  | { method: "settings.set"; key: string; value: unknown; scope?: CompanionScope }
  | { method: "actions.run"; id: string };

const ownedByRuntime = new Set<PreferenceKey>(["layout", "lastProject"]);
const locales = ["en", "ja", "zh-CN", "zh-TW", "ko", "fr", "kk"];
const constraints: Partial<Record<PreferenceKey, { enum?: Array<string | number>; minimum?: number; maximum?: number }>> = {
  locale: { enum: locales }, blockNameLanguage: { enum: locales }, spellCheckMode: { enum: ["auto", "manual", "disabled"] }, sidePanelDisplay: { enum: ["overlay", "push"] },
  aiDefaultMode: { enum: ["chat", "codex"] }, companionProvider: { enum: ["chat", "codex"] }, aiPermissionMode: { enum: ["ask", "auto", "full"] }, referenceLinkModifier: { enum: ["ctrl", "alt", "shift", "meta"] }
};
const clone = <T,>(value: T): T => structuredClone(value);
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
type Change = { key: PreferenceKey; scope: CompanionScope; projectId: string | undefined; before: PreferenceValues[PreferenceKey] | undefined; after: PreferenceValues[PreferenceKey] | undefined };

/** Trusted renderer facade. Not exposed to page scripts, IPC, or AI until an adapter is connected. */
export function createCompanionApi(ports: CompanionPorts) {
  const history: Change[] = [];
  const listeners = new Set<() => void>();
  let pending = Promise.resolve();
  const fail = (key: string): never => { throw new Error(ports.message(key)); };
  const settingKey = (key: string): PreferenceKey => Object.hasOwn(preferenceDefaults, key) ? key as PreferenceKey : fail("companion.invalidSetting");
  const scopeOf = (scope: CompanionScope = "global"): CompanionScope => scope === "global" || scope === "project" ? scope : fail("companion.invalidScope");
  const assertScope = (key: PreferenceKey, scope: CompanionScope) => {
    if (scope !== "project") return;
    if (!ports.settings.projectId()) fail("companion.projectRequired");
    if (!projectPreferenceKeys.includes(key)) fail("companion.globalOnly");
  };
  const own = (key: PreferenceKey, scope: CompanionScope) => ports.settings.snapshot()[scope][key];
  const describe = (key: PreferenceKey) => ({ key, writable: !ownedByRuntime.has(key), projectSupported: projectPreferenceKeys.includes(key), constraints: primitivePreferenceSchema(key) ?? { type: Array.isArray(preferenceDefaults[key]) ? "array" : typeof preferenceDefaults[key], ...constraints[key] } });
  const publish = () => listeners.forEach(listener => listener());
  const enqueue = <T,>(action: () => Promise<T>): Promise<T> => {
    const result = pending.then(action);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };
  const read = (name: string, requestedScope: CompanionScope = "global") => {
    const key = settingKey(name), scope = scopeOf(requestedScope);
    assertScope(key, scope);
    const snapshot = ports.settings.snapshot();
    const value = (scope === "project" ? snapshot.project[key] : undefined) ?? snapshot.global[key] ?? preferenceDefaults[key];
    return clone({ ...describe(key), key, scope, value, defaultValue: preferenceDefaults[key], ownValue: own(key, scope), inherited: scope === "project" && own(key, scope) === undefined });
  };
  const write = (name: string, value: unknown, requestedScope: CompanionScope = "global") => {
    const key = settingKey(name), scope = scopeOf(requestedScope);
    assertScope(key, scope);
    if (ownedByRuntime.has(key)) fail("companion.readOnly");
    if (value !== undefined && !validPreference(key, value)) fail("companion.invalidValue");
    const next = clone(value) as PreferenceValues[PreferenceKey] | undefined;
    const projectId = ports.settings.projectId();
    return enqueue(async () => {
      if (scope === "project" && ports.settings.projectId() !== projectId) fail("companion.projectChanged");
      const before = clone(own(key, scope));
      await ports.settings.set(key, next, scope);
      // A project switch may finish while persistence is in progress. Do not attribute
      // the new project's settings to this request or let undo affect that project.
      if (scope === "project" && ports.settings.projectId() !== projectId) fail("companion.projectChanged");
      const after = clone(own(key, scope));
      if (!equal(before, after)) {
        history.push({ key, scope, projectId, before, after });
        if (history.length > 20) history.shift();
        publish();
      }
      return read(key, scope);
    });
  };
  const api = {
    apiVersion: 1 as const,
    context: () => ({ projectId: ports.settings.projectId(), canUndoSetting: history.length > 0 }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      const unsubscribe = ports.settings.subscribe(listener);
      return () => { listeners.delete(listener); unsubscribe(); };
    },
    settings: {
      list: () => clone((Object.keys(preferenceDefaults) as PreferenceKey[]).map(describe)),
      read,
      async choices(name: string) {
        const key = settingKey(name);
        const dynamic = await ports.settings.choices?.(key);
        const values = (primitivePreferenceSchema(key)?.enum as Array<string | number> | undefined) ?? constraints[key]?.enum ?? [];
        return clone(dynamic?.length ? dynamic : values.map(value => ({ value, label: String(value) })));
      },
      set: (key: string, value: unknown, scope?: CompanionScope) => write(key, value, scope),
      reset: (key: string, scope?: CompanionScope) => write(key, undefined, scope),
      undo: () => enqueue(async () => {
        const change = history.at(-1) ?? fail("companion.noUndo");
        if (change.scope === "project" && ports.settings.projectId() !== change.projectId) fail("companion.projectChanged");
        if (!equal(own(change.key, change.scope), change.after)) fail("companion.undoConflict");
        await ports.settings.set(change.key, clone(change.before), change.scope);
        history.pop(); publish();
        return { key: change.key, scope: change.scope, projectId: change.projectId };
      })
    },
    actions: {
      list: () => clone(ports.actions.list()),
      async run(id: string) {
        const action = ports.actions.list().find(item => item.id === id);
        if (!action?.available || !await ports.actions.run(id)) fail("companion.unavailable");
        return { id, dispatched: true };
      }
    },
    async invoke(request: CompanionRequest): Promise<unknown> {
      switch (request.method) {
        case "context": return api.context();
        case "settings.list": return api.settings.list();
        case "settings.read": return api.settings.read(request.key, request.scope);
        case "settings.choices": return api.settings.choices(request.key);
        case "settings.set": return api.settings.set(request.key, request.value, request.scope);
        case "settings.reset": return api.settings.reset(request.key, request.scope);
        case "settings.undo": return api.settings.undo();
        case "actions.list": return api.actions.list();
        case "actions.run": return api.actions.run(request.id);
        default: return fail("companion.unavailable");
      }
    }
  };
  return api;
}
export type CompanionApi = ReturnType<typeof createCompanionApi>;
