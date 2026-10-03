import { randomUUID } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectService, ProjectBlockGraphService, ProjectRelationService } from "../../../packages/application/src/index.js";
import { LatexmkCompilerService } from "../../../packages/compiler-latexmk/src/index.js";
import { AppError, type RelationScopeOptions } from "../../../packages/contracts/src/index.js";
import { RelationError } from "@latex-editor/contracts";
import { systemClock } from "../../../packages/domain/src/index.js";
import { NodeProjectEnvironment, NodeProjectFileService } from "../../../packages/filesystem-node/src/index.js";
import { SQLiteProjectRegistry } from "../../../packages/registry-sqlite/src/index.js";
import { FileResourceCatalog, validateResourceDirectory } from "../../../packages/resource-catalog/src/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const jsonOutput = process.argv.includes("--json");

interface ApplicationContext {
  registry: SQLiteProjectRegistry;
  projects: ProjectService;
  files: NodeProjectFileService;
  compiler: LatexmkCompilerService;
  resources: FileResourceCatalog;
  relations: ProjectRelationService;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function output(value: unknown): void {
  if (jsonOutput || typeof value !== "string") printJson(value);
  else process.stdout.write(`${value}\n`);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (value === undefined) throw new AppError("INVALID_RELATIVE_PATH", `Missing required option: ${name}`);
  return value;
}

async function stdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

async function createContext(): Promise<ApplicationContext> {
  const dataDirectory = process.env.LATEX_EDITOR_DATA_DIR ?? resolve(
    process.env.LOCALAPPDATA ?? process.env.XDG_DATA_HOME ?? process.cwd(), "latex-editor"
  );
  await mkdir(dataDirectory, { recursive: true });
  const registry = new SQLiteProjectRegistry(resolve(dataDirectory, "registry.sqlite"));
  registry.initialize();
  const resources = new FileResourceCatalog(resolve(root, "resources"));
  await resources.reload();
  const projects = new ProjectService({
    registry,
    environment: new NodeProjectEnvironment(),
    templates: resources,
    clock: systemClock,
    ids: { next: randomUUID }
  });
  const files = new NodeProjectFileService(projects);
  const compiler = new LatexmkCompilerService({ projects, files, profiles: resources, clock: systemClock });
  const relations = new ProjectRelationService(new ProjectBlockGraphService(files, { next: randomUUID }), { next: randomUUID });
  return { registry, projects, files, compiler, resources, relations };
}

async function validateResourcesCommand(): Promise<number> {
  const resourcesPath = resolve(root, "resources");
  const valid = await validateResourceDirectory(resourcesPath);
  const entries = await readdir(resourcesPath, { withFileTypes: true });
  output({ valid, resourceGroups: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() });
  return valid ? 0 : 2;
}

async function run(context: ApplicationContext): Promise<number> {
  const args = process.argv.slice(2).filter((argument) => argument !== "--json");
  const [command, subcommand, third, fourth] = args;
  if (command === "relation" && third) {
    const service = context.relations;
    const depthValue = option("--depth") ?? "all";
    const scope = (): RelationScopeOptions => ({ focusIds: requiredOption("--focus").split(",").filter(Boolean), direction: (option("--direction") ?? "both") as RelationScopeOptions["direction"], depth: depthValue === "all" ? "all" : Number(depthValue) });
    const endpoint = () => { if (!fourth) throw new RelationError("BLOCK_NOT_FOUND", "A block or relation ID is required."); return fourth; };
    if (subcommand === "create") output(await service.createRelation(third, requiredOption("--source"), requiredOption("--target")));
    else if (subcommand === "can-create") output(await service.canCreateRelation(third, requiredOption("--source"), requiredOption("--target")));
    else if (subcommand === "delete") await service.deleteRelation(third, endpoint());
    else if (subcommand === "reverse") output(await service.reverseRelation(third, endpoint()));
    else if (subcommand === "get") output(await service.getRelation(third, endpoint()));
    else if (subcommand === "around") output(await service.getRelations(third, endpoint()));
    else if (subcommand === "prerequisites") output(await service.getPrerequisites(third, endpoint()));
    else if (subcommand === "dependents") output(await service.getDependents(third, endpoint()));
    else if (subcommand === "ancestors") output(await service.getAncestors(third, endpoint(), depthValue === "all" ? {} : { maxDepth: Number(depthValue) }));
    else if (subcommand === "descendants") output(await service.getDescendants(third, endpoint(), depthValue === "all" ? {} : { maxDepth: Number(depthValue) }));
    else if (subcommand === "path") output(await service.findRelationPath(third, requiredOption("--source"), requiredOption("--target")));
    else if (subcommand === "depends-on") output(await service.dependsOn(third, endpoint(), requiredOption("--prerequisite")));
    else if (subcommand === "scope") output(await service.getRelationScope(third, scope()));
    else if (subcommand === "subgraph") output(await service.getRelationSubgraph(third, scope()));
    else if (subcommand === "display-scope") output(await service.getDisplayScope(third, await service.getRelationScope(third, scope()), { includeContent: !args.includes("--no-content"), includeStructuralParents: args.includes("--parents") }));
    else if (subcommand === "impact") output(await service.getRelationImpact(third, endpoint()));
    else if (subcommand === "context") output(await service.getLogicContext(third, endpoint()));
    else if (subcommand === "validate") output(await service.validateRelationGraph(third));
    else throw new RelationError("INVALID_GRAPH_STATE", `Unknown relation command: ${subcommand}`);
    return 0;
  }
  if (command === "doctor") {
    const toolchain = await context.compiler.detectToolchain();
    output({ node: process.version, platform: process.platform, sqlite: true, resources: true, latexmk: toolchain });
    return toolchain.available ? 0 : 4;
  }
  if (command === "resources" && subcommand === "validate") {
    return validateResourcesCommand();
  }
  if (command === "resources" && subcommand === "search") {
    const query = third ?? "";
    output({ commands: context.resources.searchCommands(query), environments: context.resources.searchEnvironments(query) });
    return 0;
  }
  if (command === "project" && subcommand === "create") {
    const templateId = option("--template");
    output(await context.projects.createProject({
      name: requiredOption("--name"),
      parentPath: requiredOption("--parent"),
      ...(templateId === undefined ? {} : { templateId })
    }));
    return 0;
  }
  if (command === "project" && subcommand === "register" && third !== undefined) {
    output(await context.projects.registerExistingFolder(third));
    return 0;
  }
  if (command === "project" && subcommand === "list") {
    output(await context.projects.listProjects());
    return 0;
  }
  if (command === "project" && subcommand === "show" && third !== undefined) {
    output(context.projects.getProject(third));
    return 0;
  }
  if (command === "project" && subcommand === "remove" && third !== undefined) {
    const confirmPath = option("--confirm-path");
    output(await context.projects.remove(process.argv.includes("--delete-local")
      ? { projectId: third, mode: "deleteLocalFolder", confirmedCanonicalPath: confirmPath ?? "" }
      : { projectId: third, mode: "registryOnly" }));
    return 0;
  }
  if (command === "file" && subcommand === "tree" && third !== undefined) {
    output(await context.files.listTree(third));
    return 0;
  }
  if (command === "file" && subcommand === "read" && third !== undefined && fourth !== undefined) {
    const file = await context.files.readText(third, fourth);
    output(jsonOutput ? file : file.content);
    return 0;
  }
  if (command === "file" && subcommand === "write" && third !== undefined && fourth !== undefined && process.argv.includes("--stdin")) {
    output(await context.files.writeText(third, fourth, await stdinText()));
    return 0;
  }
  if (command === "main" && subcommand === "set" && third !== undefined && fourth !== undefined) {
    output(await context.projects.setMainFile(third, fourth));
    return 0;
  }
  if (command === "compile" && subcommand !== undefined) {
    const mainFile = option("--main");
    const result = await context.compiler.compile({ projectId: subcommand, ...(mainFile === undefined ? {} : { mainFile }) });
    output(result);
    return result.status === "succeeded" ? 0 : 3;
  }
  if (command === "--help" || command === "-h" || command === undefined) {
    process.stdout.write([
      "latex-editor doctor", "latex-editor project create --name <name> --parent <path>",
      "latex-editor project register <folder>", "latex-editor project list [--json]",
      "latex-editor file read <project-id> <path>", "latex-editor file write <project-id> <path> --stdin",
      "latex-editor main set <project-id> <path>", "latex-editor compile <project-id> [--main main.tex] [--json]",
      "latex-editor resources validate", "latex-editor resources search <query>",
      "latex-editor relation create <project-id> --source <block-id> --target <block-id> [--json]",
      "latex-editor relation scope <project-id> --focus <id[,id]> --direction both --depth all [--json]",
      "latex-editor relation <delete|reverse|get|around|prerequisites|dependents|ancestors|descendants|impact|context> <project-id> <id> [--json]",
      "latex-editor relation <path|can-create> <project-id> --source <id> --target <id> [--json]",
      "latex-editor relation <subgraph|display-scope> <project-id> --focus <id[,id]> [--parents] [--json]",
      "latex-editor relation validate <project-id> [--json]"
    ].join("\n") + "\n");
    return command === undefined ? 2 : 0;
  }
  process.stderr.write(`Unknown or incomplete command: ${args.join(" ")}\n`);
  return 2;
}

function handleError(error: unknown): void {
  if (error instanceof RelationError) {
    if (jsonOutput) printJson({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
    else process.stderr.write(`${error.code}: ${error.message}\n`);
    process.exitCode = 2; return;
  }
  if (error instanceof AppError) {
    if (jsonOutput) printJson({ error: error.toPayload() });
    else process.stderr.write(`${error.code}: ${error.message}\n`);
    process.exitCode = error.code === "TOOLCHAIN_NOT_FOUND" ? 4
      : error.code === "EXTERNAL_MODIFICATION_CONFLICT" ? 5 : 2;
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const commandArgs = process.argv.slice(2).filter((argument) => argument !== "--json");
if (commandArgs[0] === "resources" && commandArgs[1] === "validate") {
  validateResourcesCommand().then((exitCode) => { process.exitCode = exitCode; }).catch(handleError);
} else {
  createContext().then(async (context) => {
    try { process.exitCode = await run(context); }
    finally { context.relations.dispose(); context.registry.close(); }
  }).catch(handleError);
}
