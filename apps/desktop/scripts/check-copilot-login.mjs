// Checks the real profile without printing tokens or sending any project files.
// Add --login to exercise the visible Windows OAuth login entry point.
import { join } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { CopilotChatService } from "../dist/main/ai/copilot-chat.js";

async function main() {
  if (!process.env.APPDATA) throw new Error("APPDATA is required for the Windows profile check.");
  const service = new CopilotChatService(join(process.env.APPDATA, "TeXWeave"));
  let previous;
  const report = (state) => {
    const summary = JSON.stringify({ auth: state.auth, process: state.process, error: state.error });
    if (summary !== previous) { process.stdout.write(summary + "\n"); previous = summary; }
    return state;
  };
  try {
    const initial = report(await service.status());
    if (!process.argv.includes("--login") || initial.auth === "signed_in") return;
    report(await service.login());
    for (let index = 0; index < 30; index++) {
      await delay(2000);
      const state = report(await service.status());
      if (state.auth !== "authenticating") return;
    }
    process.stdout.write("OAuth is still waiting in the login window; complete GitHub authorization there.\n");
  } finally {
    await service.dispose();
  }
}

main().catch((error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
