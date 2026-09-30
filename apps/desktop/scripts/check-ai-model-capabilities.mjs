// Reads model metadata only; no messages or project content are sent.
import { join } from "node:path";
import process from "node:process";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CodexAppServer } from "../dist/main/ai/codex-app-server.js";
import { CopilotChatService } from "../dist/main/ai/copilot-chat.js";

const userDataPath = join(process.env.APPDATA, "TeXWeave");
const codex = new CodexAppServer({ userDataPath, executable: () => "", version: "0.5.1" });
const copilot = new CopilotChatService(userDataPath);
try {
  for (const [provider, service] of [["Codex", codex], ["Copilot", copilot]]) {
    const models = await service.listModels();
    const configurable = models.filter((model) => model.supportedReasoningEfforts?.length);
    process.stdout.write(JSON.stringify({ provider, total: models.length, configurable: configurable.length, examples: configurable.slice(0, 3).map((model) => ({ id: model.id, defaultEffort: model.defaultReasoningEffort, efforts: model.supportedReasoningEfforts.map((option) => option.effort) })) }) + "\n");
    if (provider === "Copilot" && process.argv.includes("--probe-copilot")) {
      const model = configurable.find((item) => item.supportedReasoningEfforts.some((option) => option.effort === "high"));
      const root = await mkdtemp(join(tmpdir(), "texweave-model-probe-"));
      const sessionId = randomUUID();
      let copilotProbeStarted = false;
      let currentSessionId = sessionId;
      const probeSessionIds = new Set([sessionId]);
      try {
        for (const preference of ["", "high", ""]) {
          const session = await copilot.session(!copilotProbeStarted ? undefined : currentSessionId, model.id, sessionId, root, preference);
          copilotProbeStarted = true;
          currentSessionId = session.sessionId;
          probeSessionIds.add(currentSessionId);
          const state = await session.rpc.model.getCurrent();
          process.stdout.write(JSON.stringify({ preference: preference || "default", effort: state.reasoningEffort }) + "\n");
        }
      } finally {
        for (const id of probeSessionIds) await copilot.deleteSession(id);
        await rmdir(root).catch(() => undefined);
      }
    }
  }
} finally {
  await codex.stop();
  await copilot.dispose();
}
