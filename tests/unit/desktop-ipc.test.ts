import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import * as contract from "@latex-editor/contracts/desktop-ipc";
import type { DesktopApi } from "@latex-editor/contracts/desktop-ipc";
import { ProjectBlockGraphService, ProjectDocumentStructureService } from "@latex-editor/application";
import { AppError } from "@latex-editor/contracts";
import ts from "typescript";
import { handleIpc } from "../../apps/desktop/src/main/ipc.js";
import { registerStructureIpc } from "../../apps/desktop/src/main/structure-ipc.js";

const electron = vi.hoisted(() => ({ handle: vi.fn(), on: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: electron }));

function loadPreload() {
  let api: DesktopApi | undefined;
  const response = { ok: true, data: "transport-result" };
  const invoke = vi.fn(async () => response);
  const send = vi.fn();
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const removeListener = vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
    if (listeners.get(channel) === handler) listeners.delete(channel);
  });
  runInNewContext(readFileSync("apps/desktop/src/preload/index.cjs", "utf8"), {
    require: (name: string) => {
      if (name === "@latex-editor/contracts/desktop-ipc") return contract;
      if (name !== "electron") throw new Error(`Unexpected preload dependency: ${name}`);
      return {
        contextBridge: { exposeInMainWorld: (name: string, bridge: DesktopApi) => { expect(name).toBe("latexEditor"); api = bridge; } },
        ipcRenderer: { invoke, send, on: (channel: string, handler: (...args: unknown[]) => void) => listeners.set(channel, handler), removeListener },
        webUtils: { getPathForFile: () => "dropped-file.tex" }
      };
    }
  });
  return { api: api!, invoke, send, response, listeners, removeListener };
}

describe("desktop IPC contract and adapters", () => {
  it("registers every declared invoke exactly once in the main adapters", () => {
    const registered: string[] = [];
    for (const path of ["index.ts", "ai/ipc.ts", "structure-ipc.ts", "working-document-ipc.ts", "block-graph-ipc.ts", "history-ipc.ts", "relation-ipc.ts"]) {
      const source = readFileSync(`apps/desktop/src/main/${path}`, "utf8");
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const aliases = new Map<string, string>();
      const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && node.initializer) {
          const match = node.initializer.getText(file).match(/^desktopInvoke\.(\w+)$/);
          if (match) aliases.set(node.name.getText(file), match[1]!);
        }
        if (ts.isCallExpression(node) && node.expression.getText(file) === "handleIpc") {
          const name = node.arguments[0]!.getText(file);
          const match = name.match(/^(?:desktopInvoke\.)?(\w+)\.(\w+)$/);
          expect(match, `Unrecognized descriptor: ${name}`).not.toBeNull();
          registered.push(`${aliases.get(match![1]!) ?? match![1]}.${match![2]}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
      expect(source).not.toMatch(/ipcMain\.(?:handle|on)\(/);
    }
    const expected = Object.entries(contract.desktopInvoke).flatMap(([group, methods]) => Object.keys(methods).map(method => `${group}.${method}`));
    expect(registered.sort()).toEqual(expected.sort());
  });
  it("exposes every declared request through the actual preload with arguments and results intact", async () => {
    const { api, invoke, response } = loadPreload();
    const channels: string[] = [];
    for (const [group, methods] of Object.entries(contract.desktopInvoke)) {
      const exposed = api[group as keyof DesktopApi] as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
      for (const [method, endpoint] of Object.entries(methods)) {
        const args = ["project", { input: method }, undefined];
        expect(await exposed[method]!(...args)).toBe(response);
        expect(invoke).toHaveBeenLastCalledWith(endpoint.channel, ...args);
        channels.push(endpoint.channel);
      }
    }
    expect(new Set(channels).size).toBe(channels.length);
    expect("invoke" in api).toBe(false);
    expect(api.files.pathForFile({} as File)).toBe("dropped-file.tex");
  });

  it("preserves close readiness and response semantics and hides Electron events from subscribers", () => {
    const { api, listeners, send, removeListener } = loadPreload();
    const listener = vi.fn();
    const unsubscribe = api.lifecycle.onCloseRequested(listener);
    expect(send).toHaveBeenCalledWith(contract.desktopEvents.toMain.closeReady.channel);
    listeners.get(contract.desktopEvents.toRenderer.closeRequested.channel)!({ sender: "private" }, "request-1");
    expect(listener).toHaveBeenCalledExactlyOnceWith("request-1");
    api.lifecycle.completeClose("request-1", false);
    expect(send).toHaveBeenLastCalledWith(contract.desktopEvents.toMain.closeResponse.channel, "request-1", false);
    unsubscribe();
    expect(listeners.size).toBe(0);
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it("keeps AI notifications and invokes separate even when their wire names match", async () => {
    const { api, listeners, invoke } = loadPreload();
    const statusListener = vi.fn(), updateListener = vi.fn();
    const stopStatus = api.ai.onStatus(statusListener), stopUpdate = api.ai.onUpdate(updateListener);
    const status = { auth: "signed_out", process: "stopped" };
    const update = { kind: "conversation", payload: { id: "conversation" } };
    listeners.get(contract.desktopEvents.toRenderer.aiStatus.channel)!({}, status);
    listeners.get(contract.desktopEvents.toRenderer.aiUpdate.channel)!({}, update);
    expect(statusListener).toHaveBeenCalledExactlyOnceWith(status);
    expect(updateListener).toHaveBeenCalledExactlyOnceWith(update);
    await api.ai.status();
    expect(invoke).toHaveBeenLastCalledWith(contract.desktopInvoke.ai.status.channel);
    stopStatus(); stopUpdate();
    expect(listeners.size).toBe(0);
  });

  it("registers source operations against the shared service and returns its envelope", async () => {
    electron.handle.mockClear();
    const files = new Map<string, string>([["main.tex", "\\section{Main}\nBody text."]]);
    const port = {
      async readText(_projectId: string, path: string) {
        const content = files.get(path);
        if (content === undefined) throw new AppError("FILE_NOT_FOUND", path);
        return { content };
      },
      async writeText(_projectId: string, path: string, content: string) { files.set(path, content); },
      async listTree() { return [{ name: "main.tex", relativePath: "main.tex", kind: "file" as const }]; }
    };
    let next = 0;
    const ids = { next: () => `block-${++next}` };
    const graph = new ProjectBlockGraphService(port, ids);
    const service = new ProjectDocumentStructureService(port, graph, ids);
    registerStructureIpc(() => service);
    const handlers = new Map(electron.handle.mock.calls.map(([channel, handler]) => [channel, handler]));
    expect([...handlers.keys()].sort()).toEqual(Object.values(contract.desktopInvoke.structure).map(e => e.channel).sort());
    const query = { type: "paragraph" };
    const result = await handlers.get(contract.desktopInvoke.structure.find_blocks.channel)({}, "project", query);
    expect(result.ok).toBe(true);
    expect(result).toEqual(await service.api("project").find_blocks(query));
    expect((await graph.snapshot("project")).blocks.length).toBeGreaterThan(0);
  });

  it("propagates service failures through the Electron adapter", async () => {
    electron.handle.mockClear();
    const failure = new Error("service failed");
    handleIpc(contract.desktopInvoke.projects.open, async () => { throw failure; });
    const handler = electron.handle.mock.calls[0]![1];
    await expect(handler({}, "project")).rejects.toBe(failure);
  });
});
