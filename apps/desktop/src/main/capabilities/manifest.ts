import { createHash } from "node:crypto";
import { blockToolDefinitions } from "../ai/block-tools.js";
import { relationToolDefinitions } from "../ai/relation-tools.js";
import { resourceToolDefinitions } from "../ai/project-resources.js";
import { objectSchema, type Capability, type ToolDefinition } from "./types.js";
import { customizationSchemas } from "./customization.js";

export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const projectOperationDefinitions: ToolDefinition[] = [
  { name: "relation_graph_state", description: "Check whether this project has any explicit relations or legacy dependencies. If false, skip all relation lookups unless the user explicitly requests creating relations.", inputSchema: objectSchema({}) },
  { name: "texweave_compile", description: "Compile the AI working copy using the configured engine. Accepts an optional project-relative mainFile for any TeX document; returns PDF and diagnostics. Never run a compiler in the shell.", inputSchema: objectSchema({ mainFile: { type: "string" } }) },
  { name: "texweave_set_main_file", description: "Change the project's main TeX file to an existing relative path. The existing service requires explicit approval.", inputSchema: objectSchema({ path: { type: "string" } }, ["path"]) }
];
export const registeredHandlerKeys = new Set(["settings.read", "settings.write", "customization.read", "customization.write", "themes.list", "themes.read", "themes.create", "skills.read", "skills.list", "environment.read", "registry.read", ...[...blockToolDefinitions, ...relationToolDefinitions, ...resourceToolDefinitions, ...projectOperationDefinitions].map(tool => `project.${tool.name}`)]);
const settingEntries = [
  ["theme", "Application color theme", "主题 配色 外观 颜色", "テーマ 配色 外観", "Settings > Appearance > Theme"],
  ["fontSize", "Editor and visual preview text size", "字号 字体大小 预览文字", "文字サイズ フォント プレビュー", "Settings > Editor"],
  ["wordWrap", "Source editor word wrapping", "自动换行 源码", "折り返し ソース", "Settings > Editor"],
  ["sourceMinimap", "Source editor minimap", "缩略图 小地图", "ミニマップ", "Settings > Editor"],
  ["mathPreviewOnHover", "Math preview on hover", "公式 预览 悬浮", "数式 プレビュー ホバー", "Settings > Editor"],
  ["pdfFollowActiveTex", "PDF preview follows active TeX document", "切换 PDF 跟随 文件", "PDF 追従 ファイル", "Settings > Project & editing"],
  ["engine", "LaTeX compilation engine", "编译器 编译引擎 XeLaTeX LuaLaTeX pdfLaTeX", "コンパイラ エンジン XeLaTeX", "Settings > Project & editing"],
  ["autoPairSymbols", "Automatic paired brackets and math delimiters", "括号 配对 自动 补全", "括弧 自動 補完", "Settings > Editor"],
  ["confirmPreviewEdits", "Confirm visual preview source edits", "预览 编辑 确认", "プレビュー 編集 確認", "Settings > Editor"],
  ["aiShowTokenUsage", "Show provider token usage per AI reply", "token 用量 消耗 显示", "トークン 使用量 表示", "Settings > AI"],
  ["showPreviewMetrics", "Show preview performance metrics", "预览 性能 指标", "プレビュー 性能", "Settings > Editor"]
] as const;

export async function capabilityManifest(): Promise<Capability[]> {
  const { primitivePreferenceSchema, projectPreferenceKeys } = await import("@latex-editor/contracts");
  const result: Capability[] = [];
  const add = (input: Omit<Capability, "schemaHash" | "sinceVersion" | "status">) => result.push({ outputSchema: { type: "object" }, ...input, schemaHash: digest(input.inputSchema), sinceVersion: "0.7.0", status: "active" });
  for (const [key, title, zh, ja, help] of settingEntries) for (const action of ["get", "set"] as const) {
    const value = primitivePreferenceSchema(key) ?? (key === "theme" ? { type: "string", minLength: 1, maxLength: 64 } : undefined);
    if (!value) throw new Error(`Setting schema is missing: ${key}`);
    const scopes: Capability["scopes"] = projectPreferenceKeys.includes(key) ? ["global", "project"] : ["global"];
    const scope = { type: "string", enum: scopes };
    add({ id: `settings.${key}.${action}`, apiName: `tw_settings_${key}_${action}`, namespace: key === "engine" ? "tw_build" : "tw_preferences", title: `${action === "get" ? "Read" : "Change"} ${title}`, description: `${title}. ${action === "get" ? "Returns effective value, default and inheritance. Does not change anything." : "Plan before changing; use the existing settings service with conflict detection and undo."} GUI: ${help}.`,
      kind: action === "get" ? "query" : "setting", inputSchema: objectSchema(action === "get" ? { scope } : { scope, value }, action === "get" ? ["scope"] : ["scope", "value"]), handlerKey: action === "get" ? "settings.read" : "settings.write", sideEffect: action === "get" ? "none" : "reversible", approvalPolicy: "auto", scopes, permissions: [action === "get" ? "settings.read" : "settings.write"], aliases: { en: [key, title], "zh-CN": zh.split(" "), ja: ja.split(" ") }, settingKey: key, help });
  }
  for (const [action, description, schema] of [
    ["list", "Search available built-in and user themes by name. Returns paginated metadata only, never CSS or file paths.", objectSchema({ query: { type: "string", maxLength: 200 }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 25 } })],
    ["read", "Read one user theme's CSS by its exact catalog id. Built-in themes return metadata and css=null; use the companion-themes skill's token recipe to derive a new palette.", objectSchema({ id: { type: "string", maxLength: 64 } }, ["id"])],
    ["create", "Create a new named local CSS theme. Does not activate it or overwrite existing themes. Use semantic CSS tokens without imports or external resources. To activate, separately plan settings.theme.set using the returned id; activation supports Undo.", objectSchema({ name: { type: "string", minLength: 1, maxLength: 120 }, css: { type: "string", minLength: 1, maxLength: 262144 } }, ["name", "css"])]
  ] as const) add({ id: `themes.${action}`, apiName: `tw_themes_${action}`, namespace: "tw_themes", title: `${action} application theme`, description, kind: action === "create" ? "command" : "query", handlerKey: `themes.${action}`, inputSchema: schema, sideEffect: action === "create" ? "reversible" : "none", approvalPolicy: "auto", scopes: ["global"], permissions: [action === "create" ? "settings.write" : "app.read"], aliases: { en: ["theme", "palette", "appearance", "CSS"], "zh-CN": ["主题", "配色", "外观", "颜色"], ja: ["テーマ", "配色", "外観"] } });
  const mutations = new Set(["replace_block_content", "replace_block_range", "insert_block", "delete_block", "set_block_semantic", "texweave_materialize_files", "texweave_compile", "texweave_set_main_file"]);
  const { blockPatch, commandPatch } = await customizationSchemas();
  for (const [group, key, patch] of [["blocks", "environments", blockPatch], ["commands", "previewDirectives", commandPatch]] as const) for (const action of ["list", "read", "upsert"] as const) {
    const scope = { type: "string", enum: ["global", "project"] };
    const id = { type: "string", minLength: 1, maxLength: 64 };
    const properties = action === "list" ? { scope, query: { type: "string", maxLength: 200 }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 25 } } : action === "read" ? { scope, id } : { scope, id, mode: { type: "string", enum: ["create", "update"] }, ...(group === "blocks" ? { baseId: id } : {}), expectedRevision: { type: "string", maxLength: 64 }, patch };
    add({ id: `customization.${group}.${action}`, apiName: `tw_customization_${group}_${action}`, namespace: "tw_customization", title: `${action} ${group === "blocks" ? "block environment" : "preview command"} definition`, description: action === "list" ? `Search ${group} configuration definitions, not document content. Returns paginated metadata; scope is explicit.` : action === "read" ? `Read one ${group} configuration definition and its revision. Does not read project source or define LaTeX macros.` : `Create or update one ${group} configuration using a closed partial patch. Updates require the revision returned by read; new blocks require an existing baseId and a new match rule. Other definitions are preserved. Changes use settings validation, approval and Undo; no JavaScript or LaTeX macro execution.`, kind: action === "upsert" ? "setting" : "query", handlerKey: action === "upsert" ? "customization.write" : "customization.read", inputSchema: objectSchema(properties, action === "list" ? ["scope"] : action === "read" ? ["scope", "id"] : ["scope", "id", "mode", "patch"]), settingKey: key, sideEffect: action === "upsert" ? "reversible" : "none", approvalPolicy: "auto", scopes: ["global", "project"], permissions: [action === "upsert" ? "settings.write" : "settings.read"], aliases: { en: ["custom", "definition", group === "blocks" ? "environment" : "directive", group], "zh-CN": ["自定义", "配置", group === "blocks" ? "块环境" : "命令"], ja: ["カスタム", group === "blocks" ? "環境" : "コマンド"] } });
  }
  for (const tool of [...blockToolDefinitions, ...relationToolDefinitions, ...resourceToolDefinitions, ...projectOperationDefinitions]) {
    const relation = tool.name.startsWith("relation_"), write = mutations.has(tool.name) || tool.name.startsWith("relation_propose_");
    add({ id: `project.${tool.name}`, apiName: tool.name, namespace: relation ? "tw_relations" : tool.name.includes("block") ? "tw_blocks" : "tw_project", title: tool.name.replaceAll("_", " "), description: tool.description, kind: write ? "command" : "query", inputSchema: tool.inputSchema, handlerKey: `project.${tool.name}`, sideEffect: write ? "reversible" : "none", approvalPolicy: "auto", scopes: ["project"], permissions: [write ? "project.write" : "project.read"], aliases: { en: [tool.name], "zh-CN": [relation ? "关系 依赖" : tool.name.includes("block") ? "块 结构 内容" : tool.name.includes("compile") ? "编译 PDF" : "项目 文件 资源"], ja: [relation ? "関係 依存" : tool.name.includes("block") ? "ブロック 構造 内容" : "プロジェクト ファイル コンパイル"] } });
  }
  for (const [id, title, handlerKey, aliases, inputSchema] of [
    ["skills.list", "Search enabled workflow names and short descriptions", "skills.list", { en: ["skill", "workflow", "writing"], "zh-CN": ["技能", "写作"], ja: ["スキル", "執筆"] }, objectSchema({ query: { type: "string", maxLength: 200 }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 10 } })],
    ["skills.read", "Read one enabled workflow skill", "skills.read", { en: ["skill", "workflow"], "zh-CN": ["技能", "写作"], ja: ["スキル"] }, objectSchema({ name: { type: "string", maxLength: 64 } }, ["name"])],
    ["build.environment.status", "Inspect installed LaTeX engines and build environment", "environment.read", { en: ["compiler", "installation", "missing PDF"], "zh-CN": ["环境", "安装", "没有PDF", "编译"], ja: ["環境", "インストール", "コンパイラ"] }, objectSchema({})],
    ["registry.status", "Inspect capability registry health and supported transports", "registry.read", { en: ["registry", "capability"], "zh-CN": ["能力", "接口"], ja: ["機能"] }, objectSchema({})]
  ] as const) add({ id, apiName: `tw_${id.replaceAll(".", "_")}`, namespace: "tw_discovery", title, description: title, kind: "diagnostic", handlerKey, inputSchema: inputSchema as Record<string, unknown>, sideEffect: "none", approvalPolicy: "auto", scopes: ["global"], permissions: ["app.read"], aliases: { ...aliases, en: [...aliases.en], "zh-CN": [...aliases["zh-CN"]], ja: [...aliases.ja] } });
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
