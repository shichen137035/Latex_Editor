# Floating pet and companion interfaces / 浮动宠物与助手接口

## Capability Registry integration / 能力目录接入

The pet and project AI share a main-process Capability Registry, a fixed five-tool discovery/operation bridge, and the same trusted settings gateway. Model-specific adapters reuse existing provider sessions. The renderer facade documented below remains an internal GUI/developer interface; it is **not** the AI execution authority. Only capabilities in the packaged registry and their compiled handlers are callable. Theme creation/selection and block/command definition customization are registered; named preset generation and arbitrary GUI commands remain unavailable to AI execution.

宠物和项目 AI 共用主进程 Capability Registry、五个固定发现/操作入口以及同一套设置执行网关，并复用已有模型提供方会话。下文的渲染层接口保留为内部 GUI/开发者接口，**不是 AI 的执行授权入口**；AI 只能调用打包目录内且绑定可信处理函数的能力。主题创建/切换和块/命令定义配置已注册；命名预设生成和任意 GUI 命令仍不提供给 AI 执行。

See [architecture, migration, limits and verification](architecture/CAPABILITY_REGISTRY.md) and the [generated catalog](architecture/CAPABILITY_CATALOG.md). / 参见[架构、迁移、边界与验证](architecture/CAPABILITY_REGISTRY.md)以及[生成的能力清单](architecture/CAPABILITY_CATALOG.md)。

## Current frontend / 当前前端

Version 0.7.0 adds a draggable pet in the lower-right corner. Right-click it or press **T** to open and focus its chat composer. T remains ordinary text in inputs and editors; the shortcut is configurable in the shortcut manager. The chat works on the home screen and inside projects, and its history and draft survive project switches. It shares the application's Copilot/Codex accounts and model preferences, with its own provider conversation sessions and history. The pet is hidden during first-run setup and Help mode. **Settings → General → Show floating pet** controls visibility and defaults to enabled.

The pet can send messages to the selected AI provider; its companion resource facade remains separate and does not bypass the normal AI permission system. The renderer facade is not a window global; dedicated typed IPC supports skill storage, preset creation and theme creation.

0.7.0 在软件右下角加入可拖动的小宠物。**右键宠物或按 T** 打开对话框并聚焦输入；在输入框和编辑器中，T 仍然正常输入文字。可以在快捷键管理器修改该快捷键。主页和项目内均可对话，历史和草稿在切换项目后保持连续。宠物共用软件的 Copilot/Codex 登录账号和模型偏好，使用独立的提供方对话会话及历史。首次设置和帮助模式下宠物隐藏。可在 **设置 → 通用 → 显示浮动宠物** 控制显示，默认开启。

宠物可以向所选 AI 提供方发送消息；宠物资源接口保持独立，不绕过常规 AI 权限系统。渲染层统一入口不是 window 全局对象；技能存储、预设生成和主题生成使用专用的类型化 IPC。

## Entry points / 接入位置

- `apps/desktop/src/renderer/companion/api.ts`: typed factory, discovery, validation, serialized settings writes, and undo. / 类型化工厂、接口发现、校验、设置写入队列和撤销。
- `apps/desktop/src/renderer/companion/runtime.ts`: application instance `companionApi`, wired to the existing settings service and command registry. Future renderer AI adapters can import it. / 实际应用实例 `companionApi`，连接现有设置服务与命令系统，后续渲染进程 AI 适配器可导入使用。
- `apps/desktop/src/renderer/companion/CompanionPet.tsx`: presentation only, independent of the mutation interfaces. / 仅负责展示，与修改接口独立。
- `apps/desktop/src/main/ai/providers-ipc.ts` and `provider-auth.ts`: application-wide authentication, installation, account state and model discovery; concurrent login requests share one attempt and existing sign-ins are reused. / 软件级登录、安装、账号状态与模型发现；并发登录复用同一次请求，已有登录直接复用。
- `apps/desktop/src/main/ai/ipc.ts` and `ai-workspace.ts`: project conversation, working-copy edits, compilation and review. / 项目对话、工作副本修改、编译与审阅。
- `apps/desktop/src/main/ai/companion-ipc.ts` and `companion-chat.ts`: project-independent pet requests, history, streaming, Stop and cleanup. / 不依赖项目的宠物请求、历史、流式输出、停止与清理。
- `apps/desktop/src/main/ai/message-stream.ts`: shared response/reasoning assembly for both conversation types. / 两类对话共用的输出与思考摘要组装逻辑。

`apiVersion` is `1`. The factory accepts ports so interface behavior can be tested without Electron or a live project. UI text and errors use the current interface language.

`apiVersion` 为 `1`。工厂通过依赖接口连接软件能力，可以独立于 Electron 与实际项目测试。文案与错误信息跟随界面语言。

## AI ownership / AI 职责划分

| Renderer interface / 渲染层接口 | Responsibility / 职责 |
| --- | --- |
| `window.latexEditor.aiProviders` | Global provider accounts, installation, sign-in/out, status and models. Existing account methods under `ai` remain compatibility aliases to the same IPC handlers. / 软件级账号、安装、登录退出、状态和模型；原 `ai` 下的账号方法继续兼容，并调用同一组处理函数。 |
| `window.latexEditor.ai` | Project conversation/history, attachments, file changes and review. / 项目对话、历史、附件、文件修改与审阅。 |
| `window.latexEditor.companionChat` | Global pet conversations: `conversations`, `createConversation`, `send`, `cancel`, `approvals`, `resolveApproval`, `onUpdate`. No project id is required or accepted. / 全局宠物对话，不要求也不接收项目编号。 |

The application creates exactly one Codex connection and one Copilot service, shared by both chat services. Each service owns its conversation sessions, subscriptions and persistence; only the application disposes provider clients. The pet provider choice is stored as global `companionProvider`, independently of the project chat's `aiDefaultMode`. Pet history lives at `ai/companion/conversations.json`, separate from project history at `ai/conversations.json`. Its working directory contains no project snapshot and registers no project editing/compilation tools. Closing the pet panel or switching projects does not stop its request. Stop and application exit do. Requests use the existing AI permission setting and expose any required approval in the pet panel.

软件仅创建一份 Codex 连接和一份 Copilot 服务，由两类对话共用。各自管理对话会话、订阅和存储，提供方客户端只由应用负责关闭。宠物提供方选择保存在全局设置 `companionProvider`，与项目对话的 `aiDefaultMode` 分开。宠物历史保存在 `ai/companion/conversations.json`，与项目历史 `ai/conversations.json` 分离；宠物工作目录不复制项目快照，也不注册项目编辑和编译工具。关闭宠物面板或切换项目不会中断请求，停止按钮和退出软件会终止请求。请求沿用已有 AI 权限设置，需要批准时在宠物面板显示。

The companion settings/resource facade described below is an independent extension point. Connecting chat providers does not automatically expose those methods as AI tools.

下述宠物设置与资源接口仍是独立扩展入口；接入聊天提供方不会自动把这些方法注册为 AI 工具。

## Settings / 设置

| Method / 方法 | Result / 作用 |
| --- | --- |
| `settings.list()` | Metadata only: setting keys, scope support, constraints and writability. / 仅列出设置键、范围、约束及是否可写，不读取全部设置值。 |
| `settings.read(key, scope?)` | Read one setting and whether a project value is inherited. / 读取单项设置及项目继承状态。 |
| `settings.choices(key)` | Discover enums, language names, or installed theme IDs. / 查询枚举、语言名称或已安装主题 ID。 |
| `settings.set(key, value, scope?)` | Validate and persist one change. / 校验并保存一项修改。 |
| `settings.reset(key, scope?)` | Remove an override; projects inherit the global value again. / 移除覆盖值，项目重新继承全局值。 |
| `settings.undo()` | Undo the latest settings change made through this instance. / 撤销此实例最近的一项设置修改。 |

The default scope is `global`; `project` requires an open project and a project-supported setting. Values are checked by the shared `validPreference` validator, including complex preferences. Discovery values are detached copies. Runtime-maintained `layout` and `lastProject` are readable but not writable through this facade. Files, secret credentials, and arbitrary IPC are not part of this interface.

默认范围为 `global`；`project` 要求当前有项目且该设置支持项目级覆盖。所有值均通过共享的 `validPreference` 校验，包括复杂设置。读取返回独立副本。软件内部维护的 `layout` 与 `lastProject` 可读，但不能通过此接口修改。本接口不提供文件、私密凭据或任意 IPC 调用能力。

Writes are serialized. A queued project change is rejected if the active project changed before dispatch. An already-started write stays bound to its original project and cannot overwrite the newly opened project's renderer state. Undo retains up to 20 changes in memory; it preserves inherited values, rejects another project's undo, and refuses to overwrite later manual edits. It covers settings changes through this instance, not arbitrary application command effects.

写入按顺序处理。排队期间切换项目，会拒绝尚未执行的项目设置修改。已经开始的写入仍绑定原项目，不覆盖新项目在界面中的设置状态。撤销在内存中最多保留 20 项修改，能恢复继承状态，并会阻止跨项目撤销及覆盖后续手动编辑。撤销仅覆盖通过此实例进行的设置修改，不覆盖任意软件命令的效果。

The shared settings service exposes `setStrict` for automation callers: persistence failures reject instead of silently appearing successful. Existing UI callers continue using `set` and its existing error reporting.

共享设置服务为自动化调用增加 `setStrict`：保存失败会拒绝请求，避免被误报为成功。现有设置界面继续使用原有 `set` 及错误展示逻辑。

## Skills and generated resources / 技能与生成资源

Theme automation uses the shared capability registry for both providers and the native tool-search adapter: `themes.list` returns bounded metadata, `themes.read` loads selected user CSS (built-ins return `css=null`), and `themes.create` saves a new local theme through the existing repository. Creation validates local-only CSS before planning and writing, verifies the saved content, and never activates or replaces another theme. `settings.theme.get/set` reads or switches the global theme with existing permission, conflict, notification and Undo behavior. Generated CSS stays out of the operation journal; theme activation is the setting operation to undo. New themes load immediately after selection. The English `companion-themes` workflow provides the semantic token recipe and remains enabled by default but read only when relevant.

主题自动化通过共用能力注册表提供给两类对话提供方及原生工具搜索适配器：`themes.list` 返回有数量限制的元数据，`themes.read` 只读取选中的用户主题 CSS（内置主题返回 `css=null`），`themes.create` 通过已有仓库创建本地主题。创建前会校验 CSS 不含外部资源，写入后验证保存内容，不自动启用或替换其他主题。`settings.theme.get/set` 读取或切换全局主题，复用现有权限、冲突检测、通知和撤销机制。生成的 CSS 不写入操作日志；撤销针对主题启用的设置操作。新主题选中后即加载生效。英文技能 `companion-themes` 提供语义配色示例，默认启用、按需读取。

The companion library has an immutable-in-app core and five optional extensions. Manage extensions at **Settings → AI → Advanced → AI skills → Pet skills**. Project skills remain separate. See [skill layout and authoring rules](../resources/ai/companion/README.md).

宠物技能库包含应用内只读的基础规则与五个独立扩展，可通过 **设置 → AI → 高级 → AI 技能 → 宠物技能** 管理扩展。项目技能保持独立。参见 [技能结构与编写规则](../resources/ai/companion/README.md)。

Definition automation uses `customization.blocks.list/read/upsert` and `customization.commands.list/read/upsert`. Lists are paginated metadata; reads return one definition and a revision; upserts accept a closed partial patch with explicit create/update intent. Updates require the read revision, while new block definitions require an existing base and new match rule. The gateway merges nested changes, validates the resulting catalog through the same settings validators as the managers, and uses compare-and-set to preserve concurrent edits. Undo restores the previous override or inheritance and refuses to overwrite subsequent changes. Operation reports retain only changed fields; the journal retains configuration values needed for Undo, never document source. Project scope requires the originating project binding; the global pet uses global scope. Definitions configure preview recognition and presentation, without installing LaTeX macros or executing JS/TS plugins. The canonical descriptors also feed native tool search.

定义自动化通过 `customization.blocks.list/read/upsert` 和 `customization.commands.list/read/upsert` 提供。列表返回分页元数据；读取返回单个定义及版本；写入使用限定字段的局部补丁，并明确创建或更新。更新必须携带读取版本，新块必须指定现有模板和新的匹配规则。网关合并嵌套字段，复用管理器的设置校验，并通过比较后写入保护并发编辑。撤销恢复之前的覆盖值或继承状态，不覆盖后续变更。修改报告只保留变化字段，日志保存撤销所需的配置值，不包含文档源码。项目范围必须具有原始项目绑定，全局宠物使用全局范围。这些定义只配置预览识别和显示，不安装 LaTeX 宏，也不执行 JS/TS 插件。统一定义同时适配原生工具搜索。

The first request in a new native session includes the short foundation, shared gateway guidance, an enabled workflow index, and a bounded excerpt of earlier chat when restoring context. Extension bodies remain on-demand registry reads. Unchanged continuations send only the new user message. A changed index or application guidance sends one replacement context update without copying native history; a replacement provider session restores context again. Prompt fingerprints are saved beside pet history and bound to the native session, so restarting TeXWeave does not repeat unchanged guidance. Legacy history receives one context update. The immutable bundled core is read once per service lifetime; enabled extension metadata is checked each turn. Provider-maintained history, system instructions, tools and internal model calls can still contribute to reported input usage.

新建原生会话的首条请求包含简短基础规则、共用网关指引、已启用技能目录；恢复对话时还会附上有长度限制的历史摘要。扩展技能正文仍通过网关按需读取。普通续聊只发送用户的新消息；目录或应用指引变化时补发一次替换说明，不重复复制原生历史；提供方换建会话时重新恢复上下文。提示词指纹与宠物历史一起保存并绑定原生会话，因此重启软件不会重复发送未变化的指引。旧版历史首次使用时会更新一次上下文。只读基础技能在服务存活期间只读取一次，扩展技能元数据每轮检查。提供方保留的历史、系统提示、工具及内部模型调用仍可能计入输入用量。

| Methods / 方法 | Contract / 约定 |
| --- | --- |
| `skills.list/read/prepare` | Metadata catalog; read one document; prepare core plus explicitly selected enabled skills. / 元数据目录、单个正文、基础规则与明确选择的启用技能。 |
| `configurations.list(kind)` | Discover saved presets of one kind. / 查询指定类型的已保存预设。 |
| `configurations.create(document)` | Validate and save a named preset document, without applying it. / 校验并保存命名预设，不直接应用。 |
| `configurations.saveCurrent(name, kind?, scope?)` | Snapshot existing configuration. / 将现有配置保存为预设。 |
| `configurations.apply(id, scope?)` | Apply an existing preset with the normal settings service. / 通过正常设置服务应用预设。 |
| `configurations.export(id)` | Open the native export dialog. / 打开系统导出对话框。 |
| `themes.list/read/create` | Metadata catalog, selected CSS, or a new local theme file. Creation does not activate it. / 元数据目录、单个 CSS 或创建本地主题文件，创建不等于启用。 |
| `blocks.list/read/upsert` | Metadata catalog, one full definition, or validated insert/update preserving other definitions. / 元数据目录、单个完整定义、校验后增改并保留其他定义。 |

Generated presets support `settings`, `themes`, `blockEnvironments`, `previewCommands`, `shortcuts`, and `dictionaries`. Private toolchain paths, resources, skill files, last-project records and layout are excluded from generated preset documents. A full settings preset follows existing replacement semantics; unspecified settings return to defaults. Ordinary incremental changes should use `settings.set`. Theme files are new files limited to 256 KiB, reject external imports/URLs and script constructs, and never overwrite bundled themes. Block definitions use the shared settings validator; this does not implement arbitrary JavaScript/TypeScript plugins or define LaTeX macros in a document.

生成预设支持普通设置、主题、块环境、预览命令、快捷键和词典；禁止通过生成预设写入私有工具链路径、资源、技能文件、最近项目和布局。完整设置预设沿用替换语义，未声明的项恢复默认，普通增量修改应使用 `settings.set`。主题写为新文件，最大 256 KiB，拒绝外部导入、URL 和脚本构造，不覆盖内置主题。块定义沿用共享设置校验；不提供任意 JavaScript/TypeScript 插件执行，也不会在文章中定义 LaTeX 宏。

Preset application uses existing settings behavior and is not part of the single-setting undo stack; creating files is also not undone by `settings.undo`. Future AI adapters must apply the existing permission policy before mutations. Skill text itself is not an authorization or security boundary.

预设应用沿用已有设置行为，不属于单项设置撤销栈，创建的文件也不会由 `settings.undo` 删除。后续 AI 适配器必须在修改前接入已有权限策略；技能文字本身不构成授权或安全边界。

## Commands and future AI integration / 命令与未来 AI 接入

`actions.list()` discovers commands and their current availability, including compilation, save, search, AI tools, navigation and settings. `actions.run(id)` dispatches a registered, available command and awaits its handler. A result with `dispatched: true` means dispatch completed; commands that report their own errors in the UI retain that behavior. Unknown or unavailable commands reject. To add a future capability, extend the shared command catalog and register its handler with the normal lifecycle cleanup.

`actions.list()` 查询编译、保存、搜索、AI 工具、导航、设置等已有命令及当前可用状态。`actions.run(id)` 调用已注册且可用的命令，并等待处理函数返回。`dispatched: true` 表示分发已完成；由界面自行展示错误的原有命令继续沿用该行为。未知或不可用命令会被拒绝。后续能力可通过共享命令目录及正常生命周期内注册的处理函数扩展。

`invoke(request)` accepts the same methods in a JSON-compatible discriminated request. The future AI integration should use this entry point with its existing permission and approval handling, rather than bypassing the facade or exposing arbitrary code execution. Nothing calls this entry point automatically in 0.7.0.

`invoke(request)` 提供同样方法的 JSON 请求形式，方便后续 AI 使用。未来接入应沿用软件现有的权限与批准处理，通过此入口调用，避免绕过接口或暴露任意代码执行。0.7.0 不会自动调用此入口。

```ts
import { companionApi } from "./companion/runtime.js";

const context = companionApi.context();
const options = await companionApi.settings.choices("theme");
await companionApi.invoke({ method: "settings.set", key: "wordWrap", value: true, scope: "project" });
await companionApi.invoke({ method: "settings.reset", key: "wordWrap", scope: "project" });
await companionApi.settings.undo();
const actions = companionApi.actions.list();
```

`subscribe(listener)` reports settings and companion history changes; it returns a cleanup function. Command availability should be queried again immediately before dispatch. Project-specific work should use the current context instead of retaining an old project ID.

`subscribe(listener)` 订阅设置及助手修改历史变化，并返回取消订阅函数。分发命令前应重新查询可用性。项目操作应使用当前上下文，避免长期保留旧项目 ID。
