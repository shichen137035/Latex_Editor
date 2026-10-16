import { afterEach, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
const { cleanupUserData } = createRequire(import.meta.url)("../../apps/desktop/scripts/uninstall-cleanup.cjs") as {
  cleanupUserData(profile: string, mode: "keep" | "purge", options: { appData: string; localAppData: string; dryRun?: boolean }): Promise<{ removed: string[]; retained: string[] }>
};
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "texweave-uninstall-")); roots.push(root);
  const options = { appData: join(root, "Roaming"), localAppData: join(root, "Local") };
  const profile = join(options.appData, "TeXWeave");
  await mkdir(profile, { recursive: true }); await mkdir(options.localAppData);
  const put = async (name: string, value = "keep") => {
    const file = join(profile, name); await mkdir(join(file, ".."), { recursive: true }); await writeFile(file, value); return file;
  };
  const register = (project: string) => { const db = new DatabaseSync(join(profile, "registry.sqlite")); db.exec("CREATE TABLE projects (canonical_path TEXT)"); db.prepare("INSERT INTO projects VALUES (?)").run(project); db.close(); };
  return { root, options, profile, put, register };
}

it("preserves all user data for the default uninstall mode", async () => {
  const f = await fixture(); await f.put("settings.json"); await f.put("spellcheck/personal.json");
  expect((await cleanupUserData(f.profile, "keep", f.options)).removed).toEqual([]);
  expect(await readFile(join(f.profile, "settings.json"), "utf8")).toBe("keep");
  expect(await readFile(join(f.profile, "spellcheck/personal.json"), "utf8")).toBe("keep");
});

it("removes owned data and default tools while preserving projects, external tools and unknown files", async () => {
  const f = await fixture();
  const project = join(f.root, "project"); await mkdir(project); await writeFile(join(project, "main.tex"), "source"); f.register(project);
  await f.put("settings.json"); await f.put("spellcheck/personal.json"); await f.put("Cache/cache.bin"); await f.put("ai/conversations.json");
  await f.put("references.sqlite", "library");
  await f.put("tools/TinyTeX/.texweave-toolchain.json", JSON.stringify({ schemaVersion: 1, distribution: "tinytex" }));
  await f.put("tools/TinyTeX/texmf-dist/test.sty");
  await f.put("tools/MiKTeX/.texweave-toolchain.json", JSON.stringify({ schemaVersion: 1, distribution: "miktex" }));
  await f.put("tools/MiKTeX/texmfs/install/tex/latex/caption.sty");
  await f.put("tools/codex-cli/node_modules/@openai/codex/package.json", JSON.stringify({ name: "@openai/codex" }));
  await f.put("tools/custom-tool/keep.txt"); await f.put("my-notes.txt");
  const updater = join(f.options.localAppData, "latex-editor-updater"); await mkdir(updater); await writeFile(join(updater, "installer.exe"), "cache");
  const result = await cleanupUserData(f.profile, "purge", f.options);
  expect(result.removed).toContain(join(f.profile, "tools/TinyTeX"));
  expect(result.removed).toContain(join(f.profile, "tools/MiKTeX"));
  await expect(lstat(join(f.profile, "settings.json"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(join(f.profile, "spellcheck"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(updater)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(project, "main.tex"), "utf8")).toBe("source");
  expect(await readFile(join(f.profile, "my-notes.txt"), "utf8")).toBe("keep");
  expect(await readFile(join(f.profile, "tools/custom-tool/keep.txt"), "utf8")).toBe("keep");
  await cleanupUserData(f.profile, "purge", f.options);
});

it("protects registered projects even when they are placed inside a known data directory", async () => {
  const f = await fixture(); const source = await f.put("templates/my-project/main.tex", "source"); f.register(join(source, ".."));
  await f.put("settings.json");
  const result = await cleanupUserData(f.profile, "purge", f.options);
  expect(result.retained).toContain(join(f.profile, "templates"));
  expect(await readFile(source, "utf8")).toBe("source");
  await cleanupUserData(f.profile, "purge", f.options);
  expect(await readFile(source, "utf8")).toBe("source");
});

it("rejects unrelated profiles and corrupt registries before removing data", async () => {
  const f = await fixture(); await f.put("settings.json");
  await expect(cleanupUserData(f.root, "purge", f.options)).rejects.toThrow("restricted");
  await f.put("registry.sqlite", "corrupt");
  await expect(cleanupUserData(f.profile, "purge", f.options)).rejects.toThrow();
  expect(await readFile(join(f.profile, "settings.json"), "utf8")).toBe("keep");
});

it("does not follow directory junctions into unrelated files", async () => {
  const f = await fixture(); const external = join(f.root, "external"); await mkdir(external); await writeFile(join(external, "source.tex"), "source");
  await symlink(external, join(f.profile, "templates"), "junction");
  await f.put("Cache/test.txt"); await symlink(external, join(f.profile, "Cache/external"), "junction");
  await f.put("tools/codex-cli/node_modules/@openai/codex/package.json", JSON.stringify({ name: "@openai/codex" }));
  const result = await cleanupUserData(f.profile, "purge", f.options);
  expect(result.retained).toContain(join(f.profile, "templates"));
  expect(await readFile(join(external, "source.tex"), "utf8")).toBe("source");
});

it("supports a read-only preview and removes only empty root containers", async () => {
  const f = await fixture(); await f.put("settings.json");
  const result = await cleanupUserData(f.profile, "purge", { ...f.options, dryRun: true });
  expect(result.removed).toContain(join(f.profile, "settings.json"));
  expect(await readFile(join(f.profile, "settings.json"), "utf8")).toBe("keep");
  await cleanupUserData(f.profile, "purge", f.options);
  await expect(lstat(f.profile)).rejects.toMatchObject({ code: "ENOENT" });
  await cleanupUserData(f.profile, "purge", f.options);
});

it("refuses redirected profile roots and retains unmarked tool installations", async () => {
  const f = await fixture();
  await f.put("tools/TinyTeX/unowned.txt");
  await cleanupUserData(f.profile, "purge", f.options);
  expect(await readFile(join(f.profile, "tools/TinyTeX/unowned.txt"), "utf8")).toBe("keep");
  const target = join(f.root, "redirected"); await mkdir(target); await writeFile(join(target, "settings.json"), "external");
  await rm(f.profile, { recursive: true }); await symlink(target, f.profile, "junction");
  await expect(cleanupUserData(f.profile, "purge", f.options)).rejects.toThrow("normal directory");
  expect(await readFile(join(target, "settings.json"), "utf8")).toBe("external");
});

it("recognizes the managed native Codex marker without an npm installation", async () => {
  const f=await fixture();await f.put("tools/codex-cli/.texweave-codex.json",JSON.stringify({schemaVersion:1,package:"@openai/codex"}));
  await f.put("tools/codex-cli/native/vendor/codex.exe");
  const result=await cleanupUserData(f.profile,"purge",f.options);
  expect(result.removed).toContain(join(f.profile,"tools/codex-cli"));
});
