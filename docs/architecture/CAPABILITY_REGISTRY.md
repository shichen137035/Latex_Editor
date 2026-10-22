# Capability Registry v1 / 能力目录 v1

## Architecture / 架构

Pet and project AI use the same local catalog, operation gateway and existing provider transports. Their conversation history, skill libraries and project bindings stay separate until a future UI/session merger. No new inference engine, credential store, third-party runtime or plugin loader was added.

宠物和项目 AI 共用本地能力目录、执行网关及已有的提供方连接。两边的对话历史、技能库和项目绑定仍独立，留待后续界面/会话合并。本次没有新增推理引擎、凭据仓库、第三方脚本运行时或插件加载器。

```text
Pet / Project AI → existing Codex app-server or Copilot SDK
                 → 5 fixed discovery/operation tools
                 → read-only SQLite catalog + trusted operation gateway
                 → existing SettingsRepository / project working-copy / relation services
```

`apps/desktop/src/main/capabilities/manifest.ts` derives project descriptors from the existing block, relation and resource schema tables. Primitive setting definitions come from `primitivePreferenceSchema` in contracts; `validPreference` uses the same definitions. Only code-defined handler keys are accepted. The database stores metadata and JSON schemas, never executable functions, authentication tokens or user configuration values.

`manifest.ts` 从现有块、关系、资源的参数定义生成目录。基础设置的定义来自 contracts 中的 `primitivePreferenceSchema`，`validPreference` 也使用这份定义。只有编译进程序的处理函数标识可用。数据库只保存元数据和 JSON Schema，不保存可执行函数、认证凭据或用户配置值。

## Build and deployment / 构建与部署

- `node apps/desktop/scripts/build-capabilities.cjs` builds the catalog from compiled desktop main modules. `build-preload.cjs` invokes it after compilation, so ordinary builds, Debug starts and packaging share the same path. / 生成器从编译后的桌面主进程模块建库，由 preload 构建步骤统一调用，普通构建、Debug 和打包一致。
- `resources/capabilities/registry-v1.sqlite` is included by the existing resources packaging rule. Runtime opens it read-only, checks SQLite integrity, schema version and complete descriptor hashes against compiled definitions. / 目录库随 resources 规则打包；运行时只读打开并检查完整性、结构版本及描述与代码的哈希一致性。
- `docs/architecture/CAPABILITY_CATALOG.md` is generated from the same definitions. Do not edit it independently. / 能力清单由同一份定义生成，请勿单独编辑。
- SQLite FTS5 word and trigram indexes support English and CJK searches. Exact identifiers, aliases and a bounded scan handle short queries or missing FTS. Queries are normalized and SQL parameters are bound. / 英文及中日文使用 FTS5 单词、三元组索引；精确标识、别名和有限扫描兼容短查询及缺失 FTS 的环境，查询使用规范化和参数绑定。
- Missing, corrupt or mismatched catalogs disable capability execution without preventing normal editing. Rebuild/reinstall repairs the catalog from compiled definitions. / 目录缺失、损坏或与代码不匹配时关闭能力执行，普通编辑仍可用；重新构建或安装会从可信定义恢复目录。
- Packaged startup checks require the registry to open under Electron, not just the development Node runtime. / 发布启动检查要求 Electron 实际打开目录库，不能只通过开发环境 Node 检查。

## Discovery and execution / 发现与执行

Only these tools are initially exposed to either provider:

两种提供方初始只暴露以下工具：

| Tool / 工具 | Purpose / 用途 |
| --- | --- |
| `tw_search_capabilities` | Return 3–5 compact candidates by default, at most 10, without schemas. / 默认返回少量候选摘要，不包含完整参数定义。 |
| `tw_get_capability` | Inspect one definition and current availability. Inspection grants no execution rights. / 读取单项定义与可用性，读取不等于授权。 |
| `tw_get_state` | Invoke a registered read-only capability. Rejects writes. / 执行注册的只读查询，拒绝写操作。 |
| `tw_plan_operation` | Validate arguments, bind scope, read current settings, and create a ten-minute plan with a stable retry ID. / 校验参数、绑定范围、读取设置并生成十分钟有效的计划，重试使用稳定标识。 |
| `tw_execute_operation` | Apply, verify or undo a plan after fresh checks. / 重新检查后应用、验证或撤销计划。 |

The current login transports use the existing Codex dynamic-tool bridge and Copilot `defineTool`. Native Responses client tool search is implemented separately in `responses.ts` and bound through the same service; it is not injected into app-server RPC or Copilot requests. A standalone MCP server is not enabled.

当前登录通道继续复用 Codex 动态工具桥和 Copilot `defineTool`。原生 Responses 客户端工具搜索单独实现在 `responses.ts`，绑定到相同服务，不会将 Responses 字段注入 app-server RPC 或 Copilot 请求；尚未启用独立 MCP 服务端。

## Native OpenAI Tool Search / 原生 OpenAI 工具搜索

The official [Tool Search protocol](https://developers.openai.com/api/docs/guides/tools-tool-search) supports client-controlled discovery. `CapabilityService.bindResponses(context, { protocol: "responses", clientToolSearch: true })` creates an isolated adapter for either a pet or project context. Support must be declared by a trusted transport after verifying its endpoint and selected model; a model name alone is not a capability probe. There is no new provider/account UI or API-key store in this change.

根据官方[工具搜索协议](https://developers.openai.com/api/docs/guides/tools-tool-search)，`CapabilityService.bindResponses(context, { protocol: "responses", clientToolSearch: true })` 为宠物或项目上下文创建独立的适配会话。可信通道必须确认端点与所选模型支持后，显式声明支持；不能仅凭模型名猜测。本次没有增加提供方/账号界面或 API 密钥存储。

| Transport / 通道 | Discovery / 发现机制 | Active in current UI / 当前界面启用 |
| --- | --- | --- |
| Codex app-server | Five fixed gateway tools / 五个固定网关工具 | Yes / 是 |
| Copilot SDK | Five fixed gateway tools / 五个固定网关工具 | Yes / 是 |
| Supported Responses endpoint | Native client `tool_search` / 原生客户端工具搜索 | Adapter ready; requires an authenticated transport / 适配层就绪，需接入已认证通道 |

The [ChatGPT token-sharing limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) explicitly exclude Responses `tool_search`, including client execution, and app-server does not accept arbitrary Responses parameters. Do not reuse Codex OAuth credentials to bypass this limit or claim native search is active for the existing login. Registry diagnostics distinguish the available Responses adapter from active native support (`nativeToolSearch: false`).

[ChatGPT 登录通道限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)明确排除 Responses `tool_search`，包括客户端执行；app-server 也不接受任意 Responses 参数。不得复用 Codex OAuth 凭据绕过限制，也不能宣称现有登录已启用原生搜索。目录诊断分别报告原生适配层就绪与当前通道实际状态（`nativeToolSearch: false`）。

1. Initially expose only client `tool_search` and `tw_execute_operation`. No catalog schemas are injected up front. / 初始仅提供客户端搜索及执行计划入口，不预先注入目录中的完整参数定义。
2. `handleOutput(response.output)` processes complete calls, echoes search `call_id` in `tool_search_output`, and loads at most ten currently available trusted definitions (five by default). Previously loaded definitions are not resent; their earlier loading items must remain in history. / 处理完整调用，原样关联搜索标识，默认加载五项、最多十项当前可用的可信定义；已加载定义不重复返回，历史中必须保留原加载记录。
3. Loaded read functions invoke the existing read gateway. Loaded write functions only create plans; their descriptions explicitly require `tw_execute_operation` to apply them. Arguments, scope, grants, live state and conflicts are checked again by the same gateway. / 已加载的查询进入现有只读网关，写入只生成计划并要求调用执行入口；网关重新校验参数、范围、权限、存活状态和冲突。
4. Function schemas explicitly use `strict: false` to preserve optional arguments and existing validation semantics. Never force optional fields to required or silently add nulls. The main-process validator remains authoritative. / 函数显式采用非严格生成模式以保留可选参数与原有语义，不强行要求可选字段、不偷偷填充 null；主进程校验仍是最终依据。
5. `run(transport, {model, input, signal, onResponse})` provides the bounded Responses loop and returns `{response, history}`. Inject `transport.create(request, signal)` using a supported authenticated SDK client, and `transport.toInputItems(output)` using that SDK's `toResponseInputItems` conversion. Reuse the returned history with this session while its context remains alive; preserve reasoning items, assistant phases and discovery ordering. Requests use `store: false`, sequential tools and the explicit caller-selected model. / 已实现有轮数限制的 Responses 循环，返回最终回复与完整历史；调用方注入已认证客户端及 SDK 的输出转输入函数，在上下文存活期间复用该会话时必须携带返回历史，完整保留推理条目、回复阶段和工具加载顺序。请求关闭服务端保存，顺序执行工具，保留调用方指定模型。
6. Repeated call IDs return the original result; changed payloads using the same ID fail. Loaded tools and retry state are bounded and isolated. Abort, close, context release and service shutdown disable further writes, including approval still pending. No automatic transport retry or downgrade occurs after operations. / 重复调用标识复用原结果，标识与内容不一致则拒绝；加载与重试状态有限且隔离。取消、关闭、释放上下文及退出服务都会阻止后续写入，包括等待审批的操作；操作后不自动重试或降级通道。

### Adding capabilities / 新增能力约定

Add the canonical schema and trusted handler once through the manifest's existing source tables. Do not handwrite a second Responses inventory, add API descriptions to skills, or implement provider-specific bypass handlers. `validateManifest` now checks OpenAI-compatible function/namespace identifiers, reserved gateway names and native schema projection at build time. The same descriptors automatically feed SQLite search, fixed bridges, native deferred functions and catalog generation. Bind real handlers and permissions to both relevant context types; do not advertise unimplemented functions.

通过 manifest 已有来源表只维护一份标准参数定义和可信处理函数，不另写一份 Responses 清单、不将 API 说明塞进技能、不为提供方增加绕过网关的处理函数。构建阶段会检查函数/命名空间标识、网关保留名及原生参数投影。同一份描述自动用于 SQLite 搜索、兼容网关、原生延迟函数及目录生成；同时为相关上下文绑定真实处理函数和权限，不登记尚未实现的功能。

`tests/unit/ai-native-tool-search.test.ts` tests all manifest projections and complete search → call → plan → apply/undo round trips with the real SQLite registry and gateway, plus project compilation, permission changes, cancellation during approval, replay, malformed requests and ordered SDK conversion. The transport is simulated: live endpoint compatibility, latency and billed tokens still require an actual supported API account and integration test.

`tests/unit/ai-native-tool-search.test.ts` 使用真实目录与网关检查全部描述投影、搜索调用及计划执行撤销，也覆盖项目编译、权限变化、审批中取消、重放、无效请求及 SDK 转换顺序。传输层采用模拟；真实端点兼容性、延迟和计费用量仍需支持的 API 账号及集成测试。

Execution validates the selected schema on the main process, uses only registered handlers, rechecks live grants, permission mode, project binding/writability, engine availability and cancellation. Model-provided project IDs or handler paths are never accepted. Ordinary reversible changes follow the existing AI mode: Ask requests approval, Approve for me/Full can apply them. Existing relation/main-file handlers still require their own explicit approval in all modes.

执行由主进程再次校验所选参数 Schema，只使用注册的处理函数，并重新检查当前授权、权限模式、项目绑定及可写性、引擎环境和取消状态。模型不能传入项目 ID 或处理函数路径。普通可撤销修改遵守现有 AI 模式：Ask 要求批准，Approve for me/Full 可以直接应用；已有关系及主文件处理函数仍在所有模式下执行其明确审批。

The journal is `<userData>/ai/operation-journal.sqlite`. It retains status, identifiers, hashes and primitive setting before/after values for 90 days; it does not store document bodies, prompts or credentials. Settings writes use serialized, atomic compare-and-set operations, including inherited-value checks. Repeated execution of an active successful plan returns its existing result. Expired or ended-turn plans cannot execute; completed settings can be undone from their reply card after restart if no later manual write conflicts. Undo restores inheritance rather than writing a guessed default. Interrupted, unverified operations are marked failed at startup and require state inspection, never blind replay.

操作日志位于 `<userData>/ai/operation-journal.sqlite`，保留九十天的状态、标识、哈希及基础设置前后值，不保存文章正文、提示词或凭据。设置写入使用串行、原子的比较后写入，并检查继承值变化。有效期内重复执行成功计划会返回原结果。过期或已结束轮次的计划无法执行；已验证设置在重启后仍可从对应回复卡片撤销，但不会覆盖后续手动修改。撤销恢复继承关系而不猜测默认值。启动时把中断且未验证的操作标为失败，需要读取现状，不会盲目重放。

Project source writes still go to the existing reviewable working copy. Their existing incremental auto-apply, diff review and Undo behavior remain authoritative. A successful gateway call confirms the underlying project service returned successfully, not that a user has accepted every pending source diff. Project selection remains bound to the originating conversation when windows switch projects; a global pet conversation has no project-content access.

项目源码修改仍进入现有可审查工作副本，增量自动应用、差异审查与撤销沿用原流程。网关调用成功只说明底层项目服务成功返回，不代表用户接受了所有待处理源码差异。界面切换项目时，任务仍绑定原对话的项目；全局宠物对话没有项目内容操作权。

## Skills, context and migration / 技能、上下文与迁移

Skills now contain task workflow and constraints rather than API inventories. Project requests send an enabled name/description index, then retrieve individual bodies through registry capabilities. Pet requests additionally include a short, immutable foundation. Disabled skills cannot be read through the gateway. Oversized custom bodies are capped at 24,000 characters per read. Workflow text cannot change permissions.

Skill 现在只描述任务流程和约束，不承载 API 清单。项目请求先发送启用技能的名称、简介索引，再通过目录读取单个正文；宠物额外带简短且应用内不可修改的基础规则。网关拒绝读取已禁用技能，过大的自定义正文每次读取上限为 24,000 字符。技能文字不能改变权限。

New gateway tool sessions use tool version 6. Old native sessions are replaced once, with a bounded copy of recent user/assistant messages restored. UI conversation history stays intact. Native Codex skill attachments and repeated full skill bodies have been removed; continuing a native session no longer reinjects recent chat history. The project file inventory is bounded, and full file/source data remains on demand. Custom workflow overrides remain intact, but users should remove obsolete direct-tool instructions from them.

新网关使用工具版本 6。旧原生会话会一次性替换，并恢复有长度上限的近期用户/助手消息；界面对话历史保留。已去掉原生 Codex skill 附件与重复的 skill 全文，续接原生会话时不再重复注入聊天历史。项目文件清单有长度上限，完整文件及源码按需读取。用户自定义技能覆盖文件保留，建议清理其中旧的直接工具调用说明。

Measured custom-tool schema JSON: a full 26-project-tool projection is 11,949 bytes; the five fixed gateway definitions are 1,986 bytes. The nine built-in skill files total 6,495 bytes after this change versus 18,463 bytes before it. These are local byte measurements, not token-billing promises. Providers can still include their own system instructions, native tools, conversation context and multiple internal model calls; total usage must be measured with real requests.

本地测量：完整二十六项项目工具投影的 Schema JSON 为 11,949 字节，五个固定入口为 1,986 字节；九份内置 skill 文件总量从 18,463 字节减为 6,495 字节。这些是字节测量，不是账单 token 节省承诺。提供方仍可能加入其系统规则、原生工具、会话上下文及多次内部调用，实际用量需要真实请求测量。

## Coverage and limits / 覆盖与边界

The generated catalog lists 61 capabilities: 22 read/write setting entries, 26 project entries, three theme resource operations, six block/command definition operations, workflow discovery/read, environment diagnostics and registry health. Settings covered are theme selection, font size, wrapping, minimap, hover math preview, PDF-follow behavior, engine, automatic pairing, preview-edit confirmation, token visibility and preview performance metrics. Theme discovery is paginated metadata; selected user CSS is read on demand, while built-in CSS remains compiled into the application. Theme creation saves a new local copy without activation or overwrites; activating its returned id is a separate global setting operation with Undo. Definition list/read/upsert operations use compact metadata, selected definitions and closed partial patches with read revisions; catalogs merge on the server and use the same validation, conflict and Undo services as settings. Reports contain only changed fields. All descriptors project through the same native tool-search adapter. Environment inspection reports detected engines without exposing installation paths.

生成清单包含六十一项能力：二十二项设置读写、二十六项项目能力、三项主题资源操作、六项块/命令定义操作，以及技能发现/读取、环境诊断和目录健康状态。设置覆盖主题选择、字号、换行、小地图、悬浮公式预览、PDF 跟随、编译引擎、自动配对、预览修改确认、token 显示和预览性能指标。主题发现返回分页元数据；用户主题 CSS 按需读取，内置 CSS 保持编译在应用中。主题创建保存新副本，不启用或覆盖；用返回 id 启用主题是另一个支持撤销的全局设置操作。定义列表/读取/保存使用精简元数据、单个定义及携带读取版本的局部补丁；由服务端合并目录，并复用设置的校验、冲突和撤销服务。报告只包含变化字段。所有定义复用原生工具搜索适配器。环境诊断报告检出的引擎，不暴露安装路径。

Not registered yet: arbitrary application commands, preset application/generation, executable block plugins, environment installation, secrets/account changes and settings without a trusted capability. Block and standalone-command definitions configure preview behavior; they do not add LaTeX macros to project source. The example “automatic compilation” from the design document is not invented as a setting: no corresponding setting key exists in the current contracts. Existing renderer resource facades remain available for GUI/developer use and do not automatically become AI permissions.

尚未注册：任意应用命令、预设应用/生成、可执行块插件、环境安装、凭据/账号修改，以及没有可信能力映射的设置。块和独立命令定义配置预览行为，不向项目源码添加 LaTeX 宏。设计提案中的“自动编译”示例未被凭空实现为设置，因为当前 contracts 中没有对应设置键。现有渲染层资源接口仍供 GUI/开发者使用，不会自动获得 AI 执行权限。

The gateway constrains its own calls. Codex/Copilot native shell/filesystem privileges are still controlled by their existing provider sandbox; Full Access can operate beyond the working copy. This registry does not claim to eliminate every bypass available to an unrestricted native agent. No arbitrary SQL, handler imports or shell execution is exposed by registry tools.

网关约束经过自身的调用。Codex/Copilot 原生 Shell/文件权限仍由提供方的已有沙盒控制，Full Access 可以越出工作副本；不能声称这个目录已经消除了不受限原生代理的所有绕行方式。目录工具本身不暴露任意 SQL、动态处理函数导入或 Shell 执行。

## Validation / 验证

- Unit coverage: multilingual/exact/short-CJK search, schema rejection, unknown IDs/handlers, absent FTS, catalog tampering/corruption/rebuild, settings apply/verify/undo, restart, idempotency, concurrent/manual/inherited conflicts, changed grants, missing engines, canceled/expired plans, cross-project isolation and read-only projects. / 单元测试覆盖多语言搜索、参数校验、目录损坏恢复、设置执行撤销及各类权限/并发边界。
- Existing project tests now call the real gateway before invoking block, compile, resource and explicitly approved relation services. Conversation lifecycle, attachments and skills tests are retained. / 已有项目测试先经过真实网关，再调用块、编译、资源和关系审批服务，并保留对话生命周期、附件和技能测试。
- Desktop companion checks also seed a verified setting in an isolated profile, render its reply card, click Undo through IPC and confirm restored settings. Package smoke checks require the catalog to open under Electron. No live model call or full signed installer was produced as part of the registry refactor. / 桌面检查还会在隔离配置中生成已验证的设置操作，显示对应回复卡片，通过 IPC 点击撤销并确认设置恢复。打包冒烟检查要求 Electron 实际读库；本次重构不发送真实模型请求，也不生成完整签名安装包。
- A curated 100-query recall benchmark, native Responses Tool Search comparison and hosted MCP deployment remain future work; no unmeasured recall or token reduction target is claimed. / 百条真实语句召回评测、原生 Responses Tool Search 对比及独立 MCP 部署留待后续，不声称未测得的召回率或 token 降幅。

See the [generated catalog](CAPABILITY_CATALOG.md), [project structure](PROJECT_STRUCTURE.md), and [companion API](../COMPANION_API.md). / 参见[生成清单](CAPABILITY_CATALOG.md)、[工程结构](PROJECT_STRUCTURE.md)及[宠物接口](../COMPANION_API.md)。


## Usage and approval display / 用量与审批展示

Reply usage is the provider-reported sum across model calls, including repeated context. Cached input is a subset of input, not an extra charge or an additional token count. The UI shows the total plus input/cache/output when the provider supplies cache data; unknown cache values in older history are not fabricated. Totals are not billing estimates. Both project and pet replies use the same display and accounting helpers.

回复用量是提供方报告的多次模型调用累计值，包含重复上下文。缓存输入是输入的一部分，不能再次相加，也不能将合计直接视为计费额度。提供方有缓存字段时展示合计及输入/缓存/输出分项；旧历史中的未知缓存值不凭空补零。项目与宠物对话共用记账与显示逻辑。

The explicit permission selected for a submitted turn takes precedence over the stored default and is used consistently by provider and gateway. Ordinary auto-approved operations still use review/Undo reports; confirmation-only operations keep their Allow/Deny controls visible in a shared card. Unanswered approvals remain pending until an explicit answer, Stop, or shutdown. Provider idle watchdogs do not treat waiting for a human as provider failure. A canceled request must not be reported as an explicit user refusal.

已提交请求明确选择的权限优先于保存的默认值，提供方与网关采用同一权限。普通自动批准操作仍通过报告与撤销展示；需要确认的操作使用共用卡片，始终保留允许/拒绝按钮。未回答的审批持续等待，直至用户回答、停止任务或退出；提供方空闲检测不能将等待用户视为连接失败，取消请求也不能谎报为用户明确拒绝。


## Context efficiency / 上下文效率

- Shared policy: `ai/context-policy.ts` supplies registry/native-search guidance. Discover relevant schemas once, reuse IDs, batch related lookups, await an existing pending call with a long supported wait, and avoid short polling, clock queries or re-execution while approval is pending. These are model instructions; a third-party provider's internal polling and system prompt remain outside this adapter's control. No live token-reduction percentage is claimed. / 共用策略要求复用能力定义、批量查询及较长等待，避免短轮询、查询时间或重复执行。第三方引擎内部的轮询和系统提示仍由该引擎控制，不声称未经真实请求测量的 token 降幅。
- Capability inspection returns public schemas and policy, omitting internal aliases, handlers and empty output schemas. `knownSchemaHash` allows an unchanged schema response with fresh availability and approval information. / 能力说明只返回公开参数和策略，省去内部别名、处理函数标识及空输出定义；通过已知参数哈希可避免重复返回定义，同时重新检查可用性与审批要求。
- AI block list/find defaults to ten cards and supports `offset`/`page.nextOffset`. Block details default to ten children; `childOffset`/`childLimit` paginate them. Abbreviated title/summary/tag fields are marked; `detail=full` retrieves unabridged metadata. Labels, exact source, revisions, locations and edit preconditions are preserved. The shared GUI API's default page size is unchanged. / AI 块列表默认十项并支持分页，详情默认十个子块；缩短的元数据有明确标记，并能读取完整信息。标签、准确源码、版本号、位置和编辑前置条件保持完整，GUI 原有默认数量保持不变。
- Only simultaneously pending identical reads are coalesced within one binding. No completed document result is cached. Writes invalidate reuse; every reader rechecks live permissions before receiving the result. A failed project query is exposed as an error, never an outer successful envelope around a failure. / 仅合并同一绑定内同时等待的相同查询，不缓存已完成的文档结果。写操作使合并失效，返回结果前复查权限；查询失败直接返回失败，不能包成外层成功、内层失败。
- Existing native sessions retain history and immutable rules; continuations receive current selection, attachments, workflow index and a working-copy refresh notice instead of repeating full setup. A new provider session restores at most six recent user/assistant messages within 12,000 characters, explicitly marking excerpts. UI history is not deleted. Current user instructions and exact edit source are not abbreviated by this history helper. / 原生会话继续时复用历史及固定规则，仅更新选区、附件、技能索引和副本刷新提示。新建底层会话时恢复最多六条近期消息、总计不超过一万二千字符，节选明确标记；界面历史不删除，当前用户指令和精确编辑源码不经过该节选函数。
- Tool protocol revision is centralized in `CAPABILITY_TOOLS_VERSION` (7). Existing conversations migrate their provider session once to receive updated schemas; visible history stays available. If Windows keeps the old resource database open, the build writes a manifest-hashed immutable sidecar. Startup selects only the sidecar matching compiled definitions and still performs complete integrity checks. / 工具协议版本集中管理，旧会话会迁移一次底层会话以获得新参数定义，界面历史保留。Windows 占用旧目录库时，构建写入按定义哈希命名的新文件，启动只选择与代码匹配的文件并重新完成完整性检查。

Regression coverage: `ai-context-efficiency.test.ts` checks real block pagination without lost IDs, compact/full recovery, untouched exact source, schema reuse, concurrent reads, invalidation, permission revocation, error propagation, bounded history and occupied-catalog rebuilds. / 回归测试覆盖真实分页、完整信息回读、准确源码、定义复用、并发合并与失效、权限撤销、错误传递、历史注入预算及占用中的目录构建。
