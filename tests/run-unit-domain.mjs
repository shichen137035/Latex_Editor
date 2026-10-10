import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { unitDomains, unitFilesByDomain } from "./unit-domains.mjs";

const root = process.cwd();
const requested = process.argv[2];
const filesByDomain = unitFilesByDomain(root);
if (requested === "--list" || !requested) {
  for (const domain of unitDomains) console.log(`${domain.id.padEnd(12)} ${(filesByDomain[domain.id] ?? []).length} specs — ${domain.title}`);
  if (!requested) console.log("\nRun: npm run test:unit:domain -- <domain> [--debug]");
  process.exit(requested ? 0 : 2);
}

const domain = unitDomains.find(item => item.id === requested);
if (!domain) {
  console.error(`Unknown unit domain: ${requested}. Choose one of: ${unitDomains.map(item => item.id).join(", ")}`);
  process.exit(2);
}
const files = filesByDomain[domain.id] ?? [];
if (!files.length) {
  console.error(`No unit tests are registered for ${domain.id}.`);
  process.exit(2);
}

const vitest = resolve(root, "node_modules/vitest/vitest.mjs");
const debug = process.argv.includes("--debug");
console.log(`Running ${files.length} ${domain.id} unit specs: ${domain.title}`);
const args = [vitest, "run", "--project", "unit", ...files.map(file => resolve(root, "tests/unit", file))];
if (debug) args.push("--reporter=verbose", "--no-file-parallelism");
const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", env: process.env });
child.once("error", error => {
  console.error(`Could not start Vitest for ${domain.id}:`, error.stack ?? error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) console.error(`Unit domain ${domain.id} stopped by signal ${signal}.`);
  process.exitCode = code ?? 1;
});
