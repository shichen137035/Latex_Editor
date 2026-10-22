import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { CompanionSkillRepository } from "../../apps/desktop/src/main/companion-skills.js";
import { ThemeRepository } from "../../apps/desktop/src/main/themes.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "texweave-companion-skills-")); roots.push(root);
  return { root, repository: new CompanionSkillRepository(resolve("resources/ai/companion"), root) };
}
const content = (name: string) => `---\nname: ${name}\ndescription: User writing preference.\n---\n\nKeep paragraphs concise.\n`;

describe("separate, selectively loaded companion skills", () => {
  it("lists metadata and prepares only the selected skill plus the foundation", async () => {
    const { repository } = await fixture();
    const list = await repository.list();
    expect(list).toHaveLength(6);
    expect(list.find(item => item.name === "companion-commands")).toMatchObject({ enabled: true, readOnly: false });
    expect(list.every(item => !("content" in item))).toBe(true);
    expect(list.find(item => item.name === "companion-core")).toMatchObject({ readOnly: true, enabled: true });
    expect((await repository.prepare([])).skills).toEqual([]);
    const context = await repository.prepare(["companion-settings", "companion-settings"]);
    expect(context.core.name).toBe("companion-core");
    expect(context.skills.map(item => item.name)).toEqual(["companion-settings"]);
    expect(context.skills[0]!.content).not.toContain("# 主题制作");
  });
  it("cannot modify, disable, or shadow the foundation through user storage", async () => {
    const { root, repository } = await fixture();
    const original = await repository.read("companion-core");
    await expect(repository.save({ name: "companion-core", content: content("companion-core") })).rejects.toThrow("read-only");
    await expect(repository.setEnabled({ name: "companion-core", enabled: false })).rejects.toThrow("cannot be disabled");
    await mkdir(join(root, "skills", "companion-core"), { recursive: true });
    await writeFile(join(root, "skills", "companion-core", "SKILL.md"), "malicious replacement");
    await writeFile(join(root, "disabled.json"), JSON.stringify(["companion-core"]));
    expect(await repository.read("companion-core")).toEqual(original);
  });
  it("persists user skills and overrides, while preserving original instructions after invalid saves", async () => {
    const { root, repository } = await fixture();
    await repository.save({ name: "my-style", content: content("my-style"), create: true });
    expect((await repository.read("my-style")).source).toBe("custom");
    await repository.save({ name: "companion-settings", content: content("companion-settings") });
    expect((await repository.read("companion-settings")).source).toBe("customized");
    await expect(repository.save({ name: "my-style", content: "invalid" })).rejects.toThrow();
    await expect(repository.save({ name: "my-style", content: `---\nname: my-style\ndescription: Valid\n# ${"x".repeat(4096)}\n---\nBody` })).rejects.toThrow();
    expect((await repository.read("my-style")).content).toBe(content("my-style"));
    await expect(repository.save({ name: "../core", content: content("../core"), create: true })).rejects.toThrow();
    await repository.setEnabled({ name: "my-style", enabled: false });
    const restarted = new CompanionSkillRepository(resolve("resources/ai/companion"), root);
    await expect(restarted.prepare(["my-style"])).rejects.toThrow("unavailable");
    expect((await restarted.list()).find(item => item.name === "my-style")?.enabled).toBe(false);
  });
  it("creates a new theme file without selecting it or overwriting shipped themes", async () => {
    const { root } = await fixture();
    const themes = new ThemeRepository(join(root, "resources"), join(root, "themes"));
    await themes.initialize();
    const theme = await themes.create({ name: "My calm theme", css: ":root { --color-bg-panel: #eefaff; }" });
    expect(theme.id).toMatch(/^custom-/);
    expect(await readFile(theme.filePath!, "utf8")).toContain("#eefaff");
    expect((await themes.list()).find(item => item.id === "light")?.source).toBe("built-in");
    await expect(themes.create({ name: "Remote", css: '@import "https://example.com/theme.css";' })).rejects.toThrow("Invalid generated theme");
  });
});
