const path = require("node:path");
const root = path.resolve(__dirname, "../../..");
const { buildCapabilityRegistry } = require(path.join(root, "apps/desktop/dist/main/capabilities/registry.js"));
const { capabilityManifest } = require(path.join(root, "apps/desktop/dist/main/capabilities/manifest.js"));
const { version } = require(path.join(root, "package.json"));
buildCapabilityRegistry(path.join(root, "resources/capabilities/registry-v1.sqlite"), version).then(async result => {
  const fs = require("node:fs");
  const catalog = await capabilityManifest();
  const documentation = ["# Generated capability catalog / 自动生成的能力清单", "", "Generated from compiled definitions by `build-capabilities.cjs`. Do not edit by hand. / 由编译后的定义生成，请勿手工编辑。", "", "Availability and approval are checked at execution time. / 可用性与权限在执行时重新检查。", "", "| Capability ID | Handler | Effect / 副作用 | Scope / 范围 |", "| --- | --- | --- | --- |", ...catalog.map(cap => `| ${cap.id} | ${cap.handlerKey} | ${cap.sideEffect} | ${cap.scopes.join(", ")} |`), ""].join("\n");
  const target = path.join(root, "docs/architecture/CAPABILITY_CATALOG.md");
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== documentation) fs.writeFileSync(target, documentation, "utf8");
  process.stdout.write(`Capability registry: ${result.count} trusted definitions, ${result.manifestHash.slice(0, 12)}\n`);
}).catch(error => { process.stderr.write(`Capability registry build failed: ${error.message}\n`); process.exitCode = 1; });
