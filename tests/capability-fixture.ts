import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { afterEach } from "vitest";
import { CapabilityRegistry, buildCapabilityRegistry } from "../apps/desktop/src/main/capabilities/registry.js";
import { CapabilityService } from "../apps/desktop/src/main/capabilities/gateway.js";
import { SettingsRepository } from "../apps/desktop/src/main/settings.js";
import { ThemeRepository } from "../apps/desktop/src/main/themes.js";
import type { CodexAppServer } from "../apps/desktop/src/main/ai/codex-app-server.js";

const services: CapabilityService[] = [];
export function closeTestCapabilities() { for (const service of services.splice(0)) { service.close(); service.registry.close(); } }
afterEach(closeTestCapabilities);
export async function testCapabilities(root: string) {
  const path = join(root, "capabilities.sqlite");
  await buildCapabilityRegistry(path, "0.7.0");
  const registry = new CapabilityRegistry(); await registry.initialize(path);
  const settings = new SettingsRepository(join(root, "preferences"), async id => join(root, id, "settings.json"));
  await settings.initialize();
  const themes = new ThemeRepository(join(root, "resources"), join(root, "themes"));
  await themes.initialize();
  const { environmentsFromCatalog } = await import("@latex-editor/editor-core/preview/catalog");
  const blockDefinitions = environmentsFromCatalog(JSON.parse(await readFile(resolve("resources/environments/preview-environments.json"), "utf8")));
  const service = new CapabilityService(registry, { settings, themes, blockDefinitions, journalPath: join(root, "operations.sqlite"), projectState: () => ({ writable: true }) });
  service.initialize(); services.push(service);
  return { service, settings, themes, blockDefinitions, registry, path };
}

/** Existing block/compile tests now travel through the real discovery/plan gateway. */
export function throughCapabilityGateway(input: Parameters<CodexAppServer["startTurn"]>[0]) {
  const tools = input.toolHandlers!;
  return new Proxy(tools, { get(target, name: string) {
    if (name.startsWith("tw_")) return target[name];
    return async (args: Record<string, unknown>) => {
      const definition = JSON.parse(await target.tw_get_capability!({ id: `project.${name}` }));
      if (!definition.ok) return JSON.stringify(definition);
      if (definition.data.sideEffect === "none") {
        const response = JSON.parse(await target.tw_get_state!({ id: `project.${name}`, arguments: args }));
        return JSON.stringify(response.ok ? response.data : response);
      }
      const plan = JSON.parse(await target.tw_plan_operation!({ id: `project.${name}`, arguments: args, requestId: crypto.randomUUID() }));
      if (!plan.ok) return JSON.stringify(plan);
      const response = JSON.parse(await target.tw_execute_operation!({ operationId: plan.data.operationId, action: "apply" }));
      if (response.ok && response.data.result?.message) return String(response.data.result.message);
      return JSON.stringify(response.ok ? response.data.result : response);
    };
  } });
}
