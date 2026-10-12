# TeXWeave 工程结构与模块职责

本文是面向后续开发者的仓库导航，按 **TeXWeave 0.6.7** 当前代码整理。它说明代码放在哪里、运行时如何连接，以及修改功能时通常从哪里开始。根目录 [`package.json`](../../package.json) 是版本、工作区、命令和打包配置的权威来源；本文描述模块职责，不取代具体功能的接口文档。

## 仓库总览

```text
Latex_Editor/
├─ apps/                       可执行应用入口
│  ├─ desktop/                 Electron 桌面端
│  └─ cli/                     命令行工具
├─ packages/                   桌面端和 CLI 共用的规则、服务与适配器
├─ resources/                  随应用提供的数据驱动资源
├─ themes/                     可导入的 CSS 主题资源
├─ build/                      安装器、工具链和资源安装配置
├─ tests/                      单元、集成、编译器、CLI 和类型测试
├─ docs/                       用户、开发、架构和功能技术文档
│  └─ architecture/            仓库结构与架构导航
├─ package.json                工作区、脚本、版本和 Electron Builder 配置
├─ package-lock.json           npm 依赖锁定
├─ tsconfig.json               TypeScript 项目引用的根配置
├─ Start.bat / Debug.bat       Windows 开发启动入口
└─ .gitignore                  生成物和本地文件排除规则
```

`Update_tech_file/` 是本地保留的历史技术输入目录，已由 `.gitignore` 排除，不属于克隆仓库后的源码或规范来源。需求输入与实际行为不一致时，以当前实现、测试和 `docs/` 中维护的技术说明为准。

## 运行时边界与调用方向

```text
Electron Renderer (React / Monaco / PDF / preview)
        │ window.latexEditor：preload 白名单 API
        ▼
Preload ── 类型化 IPC 契约 ── Electron Main
                                  │
                                  ├─ application 用例服务
                                  ├─ AI、设置、文献、历史等桌面服务
                                  └─ 文件系统、SQLite、资源目录、LaTeX 编译适配器

CLI 命令 ─────────────────────── application 用例服务与适配器
```

- **Renderer** 负责交互、视图和短期界面状态；不能直接访问 Node 文件系统、SQLite 或 Electron 主进程 API。
- **Preload** 只暴露明确列出的 `window.latexEditor` 方法；新增桌面能力时不应让 Renderer 任意调用 IPC 通道。
- **Main** 负责应用组合、受控 IPC、原生集成和桌面专属服务，并将文件、项目、结构及编译操作交给共享服务或适配器。
- **CLI** 负责参数解析、终端输出和机器可读结果；它可以直接调用共享服务，不经过 Electron。
- **AI 工具层** 负责模型、工具参数、权限审批和隔离工作副本；项目操作仍应走应用服务，文件改动以可审查的变更应用。

桌面 IPC 的方法名、参数、返回值及事件载荷由 [`packages/contracts/src/desktop-ipc.cts`](../../packages/contracts/src/desktop-ipc.cts) 定义。增加端点时，应同步修改契约、Main handler、Preload 暴露和对应测试；类型检查与 IPC 测试会验证这些边界。

## `apps/desktop/`：Electron 桌面端

```text
apps/desktop/
├─ src/
│  ├─ main/                    主进程启动、服务组合、IPC handler 和桌面服务
│  │  └─ ai/                   AI 对话、供应商、工具、权限、附件与工作副本
│  ├─ preload/                 受限的 Renderer API 桥接
│  └─ renderer/                React 界面、编辑器、预览和管理器
├─ scripts/                    开发启动、构建、Electron 回归和诊断脚本
├─ vite.config.ts              Renderer 开发服务器与打包配置
├─ tsconfig.main.json          主进程 TypeScript 配置
└─ package.json                桌面端入口和包配置
```

### 主进程 `src/main/`

`index.ts` 是 Electron 主进程入口；`desktopContext.ts` 组装共享服务和桌面服务。`ipc.ts` 提供统一的 IPC 注册与检查，`structure-ipc.ts`、`block-graph-ipc.ts`、`relation-ipc.ts`、`history-ipc.ts`、`working-document-ipc.ts` 等按功能注册 handler。

主进程其他模块按桌面能力归类：

| 能力 | 代表模块 | 职责 |
| --- | --- | --- |
| 项目与文件 | `project-directory-size.ts`、`project-removal-data.ts`、`project-export.ts` | 项目目录信息、移除项目时的数据处置、导出 |
| 编译与 PDF | `compile-preview.ts`、`project-pdfs.ts`、`synctex.ts` | 编译预览协调、多 PDF 目标、源码与 PDF 定位 |
| 历史 | `project-history.ts`、`history-object.ts`、`history-content.ts` | 快照、版本、对象存储、内容比较与回收 |
| AI | `ai/` | Codex/Copilot 会话、AI 工具、权限审批、附件和隔离工作区 |
| 文献与图片 | `references.ts`、`images.ts`、`graphic-dependencies.ts` | 文献库、项目图片导入和图片依赖 |
| 设置与资源 | `settings.ts`、`themes.ts`、`style-resources.ts`、`spellcheck*.ts`、`i18n.ts` | 设置持久化、主题、样式资源、拼写检查和界面语言 |
| 安全与安装 | `renderer-security.ts`、`installation.ts`、`app-info.ts` | 窗口安全策略、安装状态、版本和应用信息 |

`ai/` 中的 `ai-workspace.ts` 协调对话和任务；`codex-app-server.ts`、`copilot-chat.ts` 适配不同供应商；`block-tools.ts`、`relation-tools.ts`、`project-resources.ts` 定义工具接口；`ai-approvals.ts`、`approval-requests.ts`、`relation-review.ts` 处理审批；`attachment-store.ts`、`workspaceFiles.ts`、`send-context.ts` 管理附件、工作副本和上下文。

### Preload `src/preload/`

`index.cjs` 在隔离的 Renderer 与 Main 之间建立明确的 API。Renderer 使用共享契约生成的 `DesktopApi` 类型。需要 Node 或操作系统能力的功能应由 Main 实现并经 Preload 暴露，不能在界面组件中直接引入 Node API。

### Renderer `src/renderer/`

| 目录 | 主要职责 |
| --- | --- |
| 根目录 `App.tsx`、`main.tsx`、`styles.css` | React 入口、顶层页面组合和全局样式 |
| `workbench/` | 编辑工作区、工具栏、文件标签、导航、编译控制和主要布局 |
| `directory/` | 首页项目列表、项目选择、分页和项目操作 |
| `editor/`、`completion/`、`spellcheck/` | Monaco 源码编辑、补全与拼写检查交互 |
| `preview/`、`math/` | 结构化文档预览、块交互、源位置编辑和公式渲染 |
| `pdf/` | PDF 阅读、缩放、页面位置与双向源码定位界面 |
| `figure/`、`table/` | 图片/子图布局以及表格预览和编辑器 |
| `search/`、`filter/` | 文档搜索、结构筛选和过滤器界面 |
| `references/` | 项目引用栏、BibTeX 条目和完整文献库界面 |
| `relations/`、`custom-blocks/` | 块关系浏览、图视图和自定义块交互 |
| `history/` | 快照、正式版本、临时保存和差异查看界面 |
| `ai/` | 对话、流式输出、附件、队列、变更审查和权限控件 |
| `settings/`、`themes/`、`resources/` | 设置、主题选择及资源管理界面 |
| `i18n/` | 界面翻译目录、语言切换和本地化服务 |
| `lifecycle/` | 未保存状态、关闭和离开工作区等生命周期交互 |

`preview/parser.ts` 等薄适配入口会复用 `packages/editor-core` 的解析能力；它们不是第二套 LaTeX 解析器。`collapseState.ts`、`wheelAcceleration.ts`、`projectAvatar.ts` 等位于 Renderer 根目录的模块是跨界面小型状态或展示工具。

`apps/desktop/scripts/` 保存开发启动和打包脚本，以及真实 Electron 回归检查。`scripts/electron/` 放用户可见流程检查，`scripts/diagnostics/` 放测量和诊断，`scripts/ai/` 放 AI 探测工具；`scripts/README.md` 说明其运行方式和外部服务要求。

## `apps/cli/`：命令行入口

`apps/cli/src/index.ts` 是 CLI 命令入口，负责命令解析、参数验证和文本/JSON 输出，再调用共享应用服务与适配器。CLI 与桌面端共享项目、文件、结构和编译规则，但不依赖 Renderer 或 Electron。`apps/cli/dist/` 是构建输出。

## `packages/`：共享代码与适配器

| 包 | 职责 | 边界 |
| --- | --- | --- |
| `contracts` | IPC、设置、块、关系、历史、AI 等共享类型与数据契约 | 只定义形状和约束，不执行 I/O |
| `domain` | ID、时钟等运行时无关的基础值与抽象 | 不依赖 Electron、React 或 Node 适配器 |
| `editor-core` | LaTeX/BibTeX 解析、预览 AST、源码索引、结构块、查询索引和关系规则 | 共享编辑规则，不依赖桌面 UI |
| `application` | 文档结构、块图、关系、工作文档及项目缓存回收等用例服务 | 协调领域规则和持久化端口 |
| `filesystem-node` | 本地文件访问、相对路径和项目元数据处理 | Node 文件系统适配器 |
| `registry-sqlite` | 本地项目注册信息持久化 | SQLite 适配器；不保存论文正文 |
| `diagnostics` | 编译器诊断的解析与归一化 | 供编译适配器和应用层复用 |
| `compiler-latexmk` | LaTeX 工具链发现、编译计划/进程、产物管理和 SyncTeX 数据 | 外部编译器适配器 |
| `resource-catalog` | 默认环境、命令、模板等资源的读取、校验和索引 | 对数据驱动资源提供共享访问方式 |
| `test-support` | 测试 fixture 路径等共享小工具；当前只有 fixture 根路径常量 | 仅供测试使用，不参与运行时 |

仓库使用 npm workspaces 和 TypeScript project references。包内实现从包公开导出入口访问；不要从其他包直接导入其 `src/` 私有路径。新增包依赖时应同时检查 `package.json`、`tsconfig` references 和根构建配置。

## 数据与资源

| 路径 | 内容和用途 |
| --- | --- |
| `resources/commands/`、`environments/` | 默认命令和预览环境定义；命令/环境的用户可配置项以资源配置为准 |
| `resources/schemas/` | 资源文件的 JSON Schema |
| `resources/compiler-profiles/` | 编译器配置档案 |
| `resources/completions/`、`snippets/`、`diagnostics/` | 补全、片段和诊断资源扩展入口 |
| `resources/style-resources/built-in/` | 默认、空白和 Light 样式资源及其 LaTeX 样式文件 |
| `resources/templates/` | 新建项目模板元数据 |
| `resources/ai/skills/` | 随应用提供的 AI 项目技能说明 |
| `themes/` | 可扫描/导入的 CSS 主题文件；内置主题及语义颜色基础仍由应用代码与主题令牌共同提供 |
| `build/manifests/`、`build/profiles/`、`build/scripts/` | LaTeX、语言、拼写资源的安装清单、安装配置和环境脚本 |
| `build/installer.nsh` | Windows NSIS 安装器扩展配置 |

资源配置与程序逻辑应保持分工：稳定的执行行为放在代码中；默认条目、标签、样式和可调整属性尽量放在资源文件中。用 `npm run resources:validate` 检查资源完整性。

## 项目数据与权威来源

- LaTeX 文件是文档文字的权威来源；可视化预览和块结构是从源码解析得到的索引与交互视图。
- 打开编辑器后的未保存文本由 `application` 的工作文档读视图管理；保存的文本位于用户项目目录。详情见 [工作文档模型](../WORKING_DOCUMENT_MODEL.md)。
- 项目块身份、语义元数据和关系存储在项目的 `.texweave/` 中。结构读取和 revision-aware 修改优先使用 `ProjectDocumentStructureService`；关系浏览与历史由块图/关系服务协调。详情见 [块结构 API](../block-structure-api.md) 和 [关系系统](../relation-system.md)。
- 项目历史对象位于 `.texweave/history/`，编译缓存位于 `.texweave/build/`；两者都不是论文源码。历史压缩和回收见 [历史存储说明](../HISTORY_STORAGE.md)。
- 项目注册表、全局设置和文献库等应用级数据位于 Electron 用户数据目录；项目级配置留在项目目录中。
- AI 编辑使用受控工作副本和变更审查路径，模型输出不会直接成为用户文件；附件和来源编辑机制见 [AI 附件生命周期](../AI_ATTACHMENT_LIFECYCLE.md) 与 [AI 源码编辑](../AI_SOURCE_EDITING.md)。

## 测试与诊断

```text
tests/
├─ unit/             纯规则、状态机、Renderer 控制器和服务策略
├─ integration/      服务、持久化、临时项目文件树之间的集成
├─ compiler/         真实 LaTeX 工具链、PDF、诊断和 SyncTeX
├─ e2e-cli/          多进程 CLI 工作流
├─ types/            IPC 等编译期约束的正反例
├─ fixtures/         编译成功/失败、预览和其他固定输入
├─ helpers/          测试服务组合与通用辅助
├─ unit-domains.mjs  单元测试分组目录
└─ validate-catalog.mjs  测试目录完整性校验
```

桌面 UI 回归和探针集中在 `apps/desktop/scripts/`，其 `electron-check-catalog.mjs` 是桌面检查索引。完整测试层级、隔离规则和维护要求见 [测试说明](../TESTING.md)。

常用入口：

| 命令 | 用途 |
| --- | --- |
| `npm run desktop:dev` | 启动开发桌面端 |
| `npm run typecheck`、`npm run desktop:typecheck` | 检查共享包、CLI、主进程和桌面类型 |
| `npm run lint` | ESLint 检查 |
| `npm run resources:validate` | 校验数据资源 |
| `npm run test:unit`、`test:integration`、`test:compiler`、`test:cli` | 按测试层运行 Vitest |
| `npm run desktop:test-check-list` | 列出可运行的 Electron 场景检查 |
| `npm run verify` | 常规静态检查、资源检查和自动化测试 |
| `npm run verify:release` | 完整验证及桌面发行回归 |

各命令的完整定义以根 `package.json` 为准，测试域选择见 [测试说明](../TESTING.md)。

## 哪类改动从哪里开始

| 改动 | 首选位置 | 需要同步检查 |
| --- | --- | --- |
| 纯 LaTeX 解析、源码映射、结构查询 | `packages/editor-core` | parser/index 单元测试；需要时更新 Renderer 薄适配 |
| 跨入口的项目/文档用例 | `packages/application` | contracts、文件系统/注册适配器和服务集成测试 |
| Renderer 交互或布局 | 对应 `apps/desktop/src/renderer/<feature>/` | 组件/状态单元测试；依赖实际 Electron 布局时加桌面检查 |
| 新增桌面系统能力或数据存储 | `apps/desktop/src/main/` | IPC 契约、handler、preload 暴露、安全边界和集成检查 |
| 新增 IPC 方法 | `packages/contracts/src/desktop-ipc.cts` 起 | Main handler、Preload 类型/API、Renderer 调用和 IPC 测试 |
| 新增 CLI 命令 | `apps/cli/src/index.ts` | CLI 参数/JSON 行为和 `tests/e2e-cli/` |
| 新增默认环境、命令或样式资源 | `resources/` | schema、资源索引、`resources:validate` 和相关预览测试 |
| 编译、输出文件或 SyncTeX 行为 | `packages/compiler-latexmk`，桌面整合在 Main | 编译器测试；真实工具链可用时运行 `test:compiler` |
| 新增用户可见翻译 | `apps/desktop/src/renderer/i18n/locales/` | Main 使用同一套目录中的翻译数据；运行 `npm run i18n:check` 和语言完整性测试 |

## 生成内容与文档维护

以下是本地生成或依赖安装内容，通常不应直接编辑，也不应作为源码提交：根目录和各包的 `dist/`、`node_modules/`、`release/`、TypeScript build-info、Vite 缓存，以及用户项目里的 `.texweave/build/`。根 `build/` 目录是安装和发布配置源码，不是通用构建输出目录。

新增或移动重要模块时，请同步更新本页的目录职责表和 README 开发者导航。新的实现细节写在功能文档中，并从相应入口互链；本页只维护仓库地图、责任边界和开发入口，避免复制一份易过期的功能手册。

## 关联文档

- [基础架构与数据流](../BACKEND_ARCHITECTURE.md)
- [功能目录与 Help 缺口](../FEATURE_CATALOG_AND_HELP_GAPS.md)
- [测试策略](../TESTING.md)
- [文档版本模型](../WORKING_DOCUMENT_MODEL.md)
- [块结构 API](../block-structure-api.md)
- [历史存储](../HISTORY_STORAGE.md)
