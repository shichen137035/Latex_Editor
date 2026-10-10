import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { unitDomains, testLayers, unitFilesByDomain } from "./unit-domains.mjs";
import { desktopChecks, excludedDesktopChecks } from "../apps/desktop/scripts/electron-check-catalog.mjs";

const root = process.cwd();
const errors = [];
const listSpecs = directory => readdirSync(resolve(root, directory)).filter(name => name.endsWith(".test.ts")).sort();

const unitAssignments = new Map();
const filesByDomain = unitFilesByDomain(root);
for (const domain of unitDomains) {
  for (const file of filesByDomain[domain.id] ?? []) unitAssignments.set(file, [...(unitAssignments.get(file) ?? []), domain.id]);
}
for (const file of listSpecs("tests/unit")) {
  const assigned = unitAssignments.get(file) ?? [];
  if (assigned.length !== 1) errors.push(`Unit test ${file} belongs to ${assigned.length} domains (${assigned.join(", ") || "none"}).`);
}
for (const [file, assigned] of unitAssignments) if (!existsSync(resolve(root, "tests/unit", file))) errors.push(`Unit catalog refers to missing test ${file} (${assigned.join(", ")}).`);

for (const layer of testLayers.filter(item => item.files)) {
  const expected = new Set(layer.files);
  const actual = new Set(listSpecs(layer.directory));
  for (const file of expected) if (!actual.has(file)) errors.push(`${layer.id} catalog refers to missing test ${file}.`);
  for (const file of actual) if (!expected.has(file)) errors.push(`${layer.id} test ${file} is not in the test catalog.`);
}

const electronDirectory = resolve(root, "apps/desktop/scripts/electron");
const electronSpecs = readdirSync(electronDirectory).filter(name => name.startsWith("check-") && name.endsWith(".cjs"));
const registeredElectronSpecs = new Set(desktopChecks.filter(check => check.engine !== "node" && check.script.startsWith("electron/")).map(check => check.script.replaceAll("\\", "/").split("/").at(-1)));
for (const file of electronSpecs) if (!registeredElectronSpecs.has(file)) errors.push(`Electron check ${file} is missing from the desktop check catalog.`);
for (const file of registeredElectronSpecs) if (!electronSpecs.includes(file)) errors.push(`Desktop check catalog refers to missing Electron check ${file}.`);
for (const check of desktopChecks) if (!existsSync(resolve(root, "apps/desktop/scripts", check.script))) errors.push(`Desktop check ${check.id} refers to missing runner ${check.script}.`);

const rootChecks = readdirSync(resolve(root, "apps/desktop/scripts")).filter(name => name.startsWith("check-") && name.endsWith(".cjs"));
const registeredRootChecks = new Set(desktopChecks.filter(check => !check.script.includes("/") && check.engine !== "node").map(check => check.script));
const excludedRootChecks = new Set(excludedDesktopChecks.map(check => check.script));
for (const file of rootChecks) {
  const assignments = Number(registeredRootChecks.has(file)) + Number(excludedRootChecks.has(file));
  if (assignments !== 1) errors.push(`Root desktop check ${file} is ${assignments === 0 ? "not cataloged" : "cataloged more than once"}.`);
}
for (const file of [...registeredRootChecks, ...excludedRootChecks]) if (!rootChecks.includes(file)) errors.push(`Desktop check catalog refers to missing root check ${file}.`);
for (const check of excludedDesktopChecks) if (!check.reason.trim()) errors.push(`Excluded check ${check.script} needs an explicit reason.`);

if (errors.length) {
  console.error(`Test catalog validation failed (${errors.length} issue${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  const counts = Object.entries(filesByDomain).map(([id, files]) => `${id} ${files.length}`).join(" · ");
  console.log(`Test catalog valid: ${listSpecs("tests/unit").length} unit specs (${counts}); ${testLayers.filter(item => item.files).reduce((sum, layer) => sum + layer.files.length, 0)} integration/compiler/CLI specs; ${desktopChecks.length} desktop checks.`);
}
