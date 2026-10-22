import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { CompanionSkillContext, CompanionSkillDocument, CompanionSkillSummary } from "@latex-editor/contracts" with { "resolution-mode": "import" };

const coreName = "companion-core";
const validName = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
function header(content: string, name: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  const front = match?.[1];
  if (Buffer.byteLength(content, "utf8") > 128 * 1024 || !front || Buffer.byteLength(match![0], "utf8") > 4096 || /^name:\s*(.+)$/m.exec(front)?.[1]?.trim() !== name) throw new Error("Invalid skill name or header");
  const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim();
  if (!description || description.length > 1000) throw new Error("A short skill description is required");
  return description;
}

/** Separate from project skills: core always comes from bundled resources, never a user override. */
export class CompanionSkillRepository {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly builtIn: string, private readonly userRoot: string) {}
  private async text(path: string): Promise<string> {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) throw new Error("Invalid skill file");
    return readFile(path, "utf8");
  }
  private async disabled(): Promise<Set<string>> {
    try { const data: unknown = JSON.parse(await readFile(join(this.userRoot, "disabled.json"), "utf8")); return new Set(Array.isArray(data) ? data.filter(validName) : []); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set(); throw error; }
  }
  private async summary(path: string, name: string): Promise<string> {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024) throw new Error("Invalid skill file");
    const file = await open(path, "r");
    try { const buffer = Buffer.alloc(4096); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0); return header(buffer.subarray(0, bytesRead).toString("utf8"), name); }
    finally { await file.close(); }
  }
  private async catalog(): Promise<Array<{ summary: CompanionSkillSummary; path: string }>> {
    const corePath = join(this.builtIn, "core", "SKILL.md");
    const result = new Map<string, { summary: CompanionSkillSummary; path: string }>([[coreName, { path: corePath, summary: { name: coreName, description: await this.summary(corePath, coreName), source: "built-in", enabled: true, readOnly: true } }]]);
    const disabled = await this.disabled();
    for (const [root, source] of [[join(this.builtIn, "skills"), "built-in"], [join(this.userRoot, "skills"), "custom"]] as const) {
      const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || !validName(entry.name) || entry.name === coreName) continue;
        const path = join(root, entry.name, "SKILL.md");
        result.set(entry.name, { path, summary: { name: entry.name, description: await this.summary(path, entry.name), enabled: !disabled.has(entry.name), readOnly: false, source: source === "custom" && result.has(entry.name) ? "customized" : source } });
      }
    }
    return [...result.values()];
  }
  async list(): Promise<CompanionSkillSummary[]> {
    await this.queue;
    return (await this.catalog()).map(item => item.summary);
  }
  async read(name: string): Promise<CompanionSkillDocument> {
    if (!validName(name)) throw new Error("Invalid skill name");
    await this.queue;
    const item = (await this.catalog()).find(skill => skill.summary.name === name);
    if (!item) throw new Error("Skill not found");
    return { ...item.summary, content: await this.text(item.path) };
  }
  async prepare(names: string[]): Promise<CompanionSkillContext> {
    if (!Array.isArray(names) || names.length > 12 || !names.every(validName)) throw new Error("Invalid selected skills");
    await this.queue;
    const catalog = await this.catalog();
    const selected = [coreName, ...new Set(names.filter(name => name !== coreName))].map(name => {
      const item = catalog.find(item => item.summary.name === name && item.summary.enabled);
      if (!item) throw new Error(`Skill unavailable: ${name}`);
      return item;
    });
    const loaded = await Promise.all(selected.map(async item => ({ ...item.summary, content: await this.text(item.path) })));
    return { core: loaded[0]!, skills: loaded.slice(1) };
  }
  private mutate(action: () => Promise<void>): Promise<CompanionSkillSummary[]> {
    const operation = this.queue.then(action);
    this.queue = operation.catch(() => undefined);
    return operation.then(() => this.list());
  }
  private async atomic(path: string, content: string) {
    await mkdir(this.userRoot, { recursive: true });
    let current = this.userRoot;
    for (const segment of ["", ...relative(this.userRoot, dirname(path)).split(sep).filter(Boolean)]) {
      current = segment ? join(current, segment) : current;
      await mkdir(current, { recursive: true });
      const directory = await lstat(current);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Skill storage cannot be a link");
    }
    const temp = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, content, { encoding: "utf8", flag: "wx" }); await rename(temp, path); }
    finally { await rm(temp, { force: true }); }
  }
  save(input: { name: string; content: string; create?: boolean }): Promise<CompanionSkillSummary[]> {
    return this.mutate(async () => {
      if (!input || !validName(input.name) || input.name === coreName || typeof input.content !== "string") throw new Error("The foundation skill is read-only; use an extension skill");
      header(input.content, input.name);
      const exists = (await this.catalog()).some(skill => skill.summary.name === input.name);
      if (Boolean(input.create) === exists) throw new Error(exists ? "Skill already exists" : "Skill not found");
      await this.atomic(join(this.userRoot, "skills", input.name, "SKILL.md"), input.content);
    });
  }
  setEnabled(input: { name: string; enabled: boolean }): Promise<CompanionSkillSummary[]> {
    return this.mutate(async () => {
      if (!input || !validName(input.name) || input.name === coreName || typeof input.enabled !== "boolean") throw new Error("The foundation skill cannot be disabled");
      if (!(await this.catalog()).some(skill => skill.summary.name === input.name)) throw new Error("Skill not found");
      const disabled = await this.disabled();
      if (input.enabled) disabled.delete(input.name); else disabled.add(input.name);
      await this.atomic(join(this.userRoot, "disabled.json"), JSON.stringify([...disabled].sort()));
    });
  }
}
