import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import { CodexAppServer } from "../../apps/desktop/src/main/ai/codex-app-server.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

it("reclaims tool closures on repeated turn startup failures and transport loss", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-codex-resources-"));
  const executable = join(root, "codex.exe");
  await writeFile(executable, "fake process");
  const stdout = new PassThrough();
  let failTurn = true, nextThread = 0;
  const child = Object.assign(new EventEmitter(), {
    stdout, stderr: new PassThrough(), exitCode: null,
    kill: vi.fn(() => true),
    stdin: new Writable({ write(chunk, _encoding, done) {
      const request = JSON.parse(String(chunk)) as { id?: number; method: string };
      const result = request.method === "account/read" ? { account: { type: "chatgpt" } }
        : request.method === "model/list" ? { data: [{ model: "model", isDefault: true }] }
        : request.method === "thread/start" ? { thread: { id: `thread-${nextThread++}` } }
        : request.method === "turn/start" ? { turn: { id: "turn" } } : {};
      if (request.id !== undefined) stdout.write(JSON.stringify(request.method === "turn/start" && failTurn
        ? { id: request.id, error: { message: "turn failed" } } : { id: request.id, result }) + "\n");
      done();
    } })
  }) as unknown as ChildProcessWithoutNullStreams;
  vi.mocked(spawn).mockReturnValue(child);
  const server = new CodexAppServer({ userDataPath: root, executable: () => executable, version: "test" });
  const turn = { cwd: root, prompt: "Edit", mode: "codex" as const, toolHandlers: { edit: async () => "working-copy snapshot" } };
  try {
    for (let index = 0; index < 20; index++) {
      await expect(server.startTurn(turn)).rejects.toThrow("turn failed");
      expect(server.runtimeStats).toEqual({ threads: 0, tools: 0 });
    }
    failTurn = false;
    await server.startTurn(turn);
    expect(server.runtimeStats).toEqual({ threads: 1, tools: 1 });
    child.emit("error", new Error("transport failed"));
    expect(server.runtimeStats).toEqual({ threads: 0, tools: 0 });
    expect(child.kill).toHaveBeenCalled();
  } finally { await server.stop(); stdout.destroy(); child.stderr.destroy(); child.stdin.destroy(); await rm(root, { recursive: true, force: true }); }
});
