# TeXWeave

TeXWeave is a local-first desktop editor for LaTeX projects. It brings source editing, structured previews, PDF compilation and navigation, bibliography management, and block-relation tools into one workspace. Project files remain in the folders chosen by the user. The application is built with Electron, React, TypeScript, and Monaco Editor.

TeXWeave is licensed under the [PolyForm Internal Use License 1.0.0](LICENSE). It permits use and modification for the internal business operations of the recipient and their company; it does not grant redistribution rights. See the [testing and licensing policy](docs/TEST_DISTRIBUTION_AND_LICENSE.md) for source access and beta distribution. Third-party dependencies remain subject to their own licenses.

The root [`package.json`](package.json) is the single source of truth for the application version. TeXWeave is local-first and does not require papers or projects to be uploaded to a cloud service.

Developer documentation: [feature catalog and help gaps](docs/FEATURE_CATALOG_AND_HELP_GAPS.md), [project structure and module responsibilities](docs/architecture/PROJECT_STRUCTURE.md), [0.6.7 release readiness](docs/RELEASE_READINESS_0.6.7.md), and [backend architecture](docs/BACKEND_ARCHITECTURE.md).

## Features

- **Projects and files:** Create projects or open existing folders; manage multi-file LaTeX projects, the main TeX file, and a local file tree. Drag in images or folders, filter files, and hide build outputs or TeXWeave metadata.
- **Source editing:** Monaco-based LaTeX and BibTeX editors with semantic completion, document-word suggestions, bracket pairing, spell-checking, environment and reference shortcuts, and configurable keyboard shortcuts.
- **Visual preview:** Parses title information, sections, common LaTeX environments, inline and display math, references, images, and tables. Supports block selection, local source editing, custom blocks, and block relations. The preview is a structured editing view and may differ from final TeX typesetting.
- **Compilation and PDF:** Compile with `latexmk` and choose an available LaTeX engine. View PDFs and compiler diagnostics in the workspace, and navigate between source and PDF with SyncTeX. A local LaTeX toolchain is required to compile.
- **Tables and images:** Insert images, image groups, and tables with editor tools. Edit common table structures in the preview, including cell contents, rows, columns, and merge/split operations. Complex or nonstandard LaTeX tables should be checked in source and in the compiled PDF.
- **Bibliography management:** Filter library entries and insert citations from the project bibliography panel. The full library view supports entry management, BibTeX import and editing, search, filtering, favorites, and sorting.
- **Block relations:** Add prerequisite and dependent relationships between structural blocks. Browse and visualize relations, validate them, and persist them in the project. Create custom blocks from a selection.
- **Project history:** Create versions, temporary saves, and snapshots in the History panel; compare changes and restore a project or selected files. Configure automatic and pre-operation snapshots. History is stored under `.texweave/history/`, with identical file contents stored only once.
- **Block structure API and AI editing:** Shared preview and backend parsers use stable IDs, direct parent/child indexes, and revisions to manage document blocks. AI can locate blocks by title, type, label, or number, then read and edit only the necessary content. Codex and Copilot block tools use working copies and diff review. See the [block structure API](docs/block-structure-api.md) for interfaces and migration details.
- **Settings and localization:** Global and project settings, light and dark themes, imported themes and style resources, environment management, search and filters, and spell-check resource settings. The interface is available in English, Simplified Chinese, Traditional Chinese, Japanese, Korean, French, and Kazakh.

## Requirements

- Node.js 22 or later; npm is included with Node.js.
- Install project dependencies before developing or launching the desktop application.
- Compiling LaTeX requires `latexmk`, Perl, and a TeX distribution such as MiKTeX or TeX Live. The Windows app checks common installation locations; add tools to `PATH` for nonstandard installations.

## Develop and run

Run these commands from the repository root:

```powershell
npm install
npm run doctor
npm run desktop:dev
```

On Windows, you can also double-click [`Start.bat`](Start.bat). It checks for Node.js and npm; if Electron dependencies are missing, it runs `npm install`, builds once, and launches the desktop app. It does not restart automatically when source or build files change. Use [`Debug.bat`](Debug.bat) to launch an existing build quickly. Use `npm run desktop:dev` to watch source files and hot reload; rebuilding the main process restarts Electron.

Run development checks, resource validation, and all non-desktop tests:

```powershell
npm run verify
```

Individual checks are also available:

```powershell
npm run typecheck
npm run desktop:typecheck
npm run lint
npm run resources:validate
npm run test:unit
npm run test:integration
npm run test:compiler
npm run test:cli
```

Run all release checks, including the build and isolated Electron desktop regression suite:

```powershell
npm run verify:release
```

Unit tests can be run by functional area. See the [testing guide](docs/TESTING.md) for the full list:

```powershell
npm run test:unit:ai
npm run test:unit:editor
npm run test:unit:preview
npm run test:unit:projects
npm run test:unit:references
npm run test:unit:compiler
npm run test:unit:settings
```

List and run desktop checks or diagnose preview behavior:

```powershell
npm run desktop:test-check-list
npm run desktop:test-check -- project-references
npm run desktop:diagnose-preview
```

`npm run test:debug` runs tests serially and prints detailed test locations and timings. The [testing guide](docs/TESTING.md) describes coverage, isolation, and release checks.

## Windows packaging

Create a Windows x64 portable package after the complete release checks pass:

```powershell
npm run desktop:dist:win
```

The package is written to `release/<version>/`. The current workflow creates a portable app only; it does not register file associations or create installation shortcuts. User settings remain in the system user-data directory, and projects stay in their original folders. The current build is unsigned, so Windows may show a SmartScreen warning. An installer will be designed separately.

## CLI

The repository also includes a CLI for project and toolchain operations:

```powershell
npm run cli -- doctor
npm run cli -- project create --name paper --parent D:\Projects --json
npm run cli -- project register D:\Projects\existing --json
npm run cli -- project list --json
npm run cli -- file tree <project-id> --json
npm run cli -- file read <project-id> main.tex
npm run cli -- file write <project-id> main.tex --stdin --json
npm run cli -- main set <project-id> main.tex --json
npm run cli -- compile <project-id> --json
npm run cli -- resources validate
npm run cli -- resources search sec --json
```

`doctor` reports the status of Node.js, resources, and the `latexmk` toolchain. Project management and tests that do not need a real compiler remain available without a LaTeX toolchain; actual compilation does not.

## Data and privacy

LaTeX project files stay in the folders users create or open. The desktop app registry, settings, bibliography library, and other user data are stored in Electron's user-data directory (usually `%APPDATA%\\TeXWeave` on Windows). Project-specific settings and block structure data are stored in each project's `.texweave/` directory. The CLI registry defaults to `%LOCALAPPDATA%\\latex-editor` and can be moved with `LATEX_EDITOR_DATA_DIR`.

Spell-check language resources are managed in Settings; downloading dictionaries requires an internet connection. The application does not provide cloud sync.

## Architecture

- `apps/desktop/`: Electron main process, preload, secure IPC, and React desktop UI.
- `apps/cli/`: CLI entry point.
- `packages/`: Shared contracts, domain and application logic, plus filesystem, SQLite registry, and LaTeX compiler adapters.
- `resources/`: Environment definitions, commands, templates, and other data-driven resources.
- `tests/`: Unit, integration, compiler, and CLI tests.
- `docs/`: User, developer, architecture, and feature documentation. See the [project structure guide](docs/architecture/PROJECT_STRUCTURE.md) for the full directory map.

For module responsibilities, data flow, and security boundaries, see the [backend architecture guide](docs/BACKEND_ARCHITECTURE.md).

## Current limitations

The visual preview is a structured editing view, not a full TeX typesetting engine. Use the compiled PDF as the source of truth for final layout. Preview support for LaTeX packages, custom macros, and complex tables may be limited, while the source can still be compiled with a local TeX toolchain.

AI supports Codex and Copilot conversations. The composer offers three permission modes: review before applying, automatic editing (default), and full access. Ordinary web searches are available in all three modes. Automatic editing retains diffs for review; changes can be accepted or undone individually or together. After acceptance, use the workbench's Ctrl+Z/Ctrl+Y history instead of an AI Undo button, including for file creation and deletion. Full access permits operations on external files and commands; those external side effects are outside the project-edit undo history.

`npm run desktop:test-ai-review` uses a headless Electron app, an isolated temporary project, and simulated AI output to check layout, permission changes, diff review, and repeated undo. It does not connect to a live AI service.

---

# TeXWeave（简体中文）

TeXWeave 是一款面向本地项目的 LaTeX 桌面编辑器。它将源码编辑、结构化预览、PDF 编译与定位、文献管理和块关系工具整合在一个工作区中。项目文件保留在用户选择的文件夹里；应用使用 Electron、React、TypeScript 和 Monaco Editor 构建。

TeXWeave 采用 [PolyForm Internal Use License 1.0.0](LICENSE)，允许接收者为自己及其公司的内部业务使用和修改软件，不授予再分发权限。源码访问和测试版分发规则见[测试与许可说明](docs/TEST_DISTRIBUTION_AND_LICENSE.md)；第三方依赖仍分别受其各自许可证约束。

应用版本以根目录 [`package.json`](package.json) 为唯一来源。TeXWeave 采用本地优先设计，不要求将论文或项目上传到云端。

开发者文档：[功能总览与 Help 缺口](docs/FEATURE_CATALOG_AND_HELP_GAPS.md)、[完整工程结构与模块职责](docs/architecture/PROJECT_STRUCTURE.md)、[0.6.7 发布准备记录](docs/RELEASE_READINESS_0.6.7.md)和[后端架构](docs/BACKEND_ARCHITECTURE.md)。

## 功能概览

- **项目与文件：**创建项目或打开已有文件夹；管理多文件 LaTeX 项目、主 TeX 文件和本地文件树。可拖入图片或文件夹，筛选文件并隐藏构建产物或 TeXWeave 配置文件。
- **源码编辑：**基于 Monaco 的 LaTeX 和 BibTeX 编辑器，支持语义补全、文档单词建议、括号配对、拼写检查、环境与引用快捷工具，以及可配置快捷键。
- **可视化预览：**解析标题信息、章节、常见 LaTeX 环境、行内与行间公式、引用、图片和表格；支持块级选择、局部源码编辑、自定义块及块关系操作。预览用于结构化阅读和编辑，最终排版请以编译后的 PDF 为准。
- **编译与 PDF：**通过 `latexmk` 编译，并可选择可用的 LaTeX 引擎；在工作区查看 PDF 和编译诊断，通过 SyncTeX 在源码和 PDF 之间定位。编译需要本机安装 LaTeX 工具链。
- **表格和图片：**通过编辑器工具插入图片、图片组和表格；在预览中编辑常见表格结构，包括单元格内容、行列以及合并/拆分。复杂或非标准 LaTeX 表格应以源码和实际编译结果为准。
- **文献管理：**在项目文献栏筛选文献库条目并插入引用。完整文献库页面支持条目管理、BibTeX 导入与编辑、搜索、筛选、收藏和排序。
- **块关系：**为结构块建立前提和从属关系，支持浏览、图形查看、校验和项目内持久化；也可从选区创建自定义块。
- **项目版本历史：**在“历史”栏创建正式版本、临时保存和快照；比较更改并恢复整个项目或选定文件。可在设置中调整自动快照和高风险操作前的快照。历史保存在项目的 `.texweave/history/` 目录中，相同文件内容只存储一次。
- **块结构 API 与 AI 编辑：**预览和后端共享解析器，使用稳定 ID、直接父子索引和 revision 管理文档块。AI 可按标题、类型、标签或编号定位，再只读取和修改必要内容。Codex 与 Copilot 的块工具使用工作副本和差异审查。接口和迁移说明见[块结构 API 文档](docs/block-structure-api.md)。
- **设置与本地化：**全局和项目级设置、浅色与深色主题、导入主题和样式资源、环境管理、搜索与筛选、拼写检查资源设置。界面支持英语、简体中文、繁体中文、日语、韩语、法语和哈萨克语。

## 环境要求

- Node.js 22 或更新版本；npm 随 Node.js 一同安装。
- 开发或启动桌面应用前，需要安装项目依赖。
- 编译 LaTeX 需要 `latexmk`、Perl 和 TeX 发行版，例如 MiKTeX 或 TeX Live。Windows 应用会检查常见安装位置；非标准安装请将工具加入 `PATH`。

## 开发与启动

在仓库根目录运行：

```powershell
npm install
npm run doctor
npm run desktop:dev
```

Windows 用户也可以双击根目录的 [`Start.bat`](Start.bat)。它会检查 Node.js 和 npm；若缺少 Electron 依赖，则运行 `npm install`、构建一次并启动桌面应用。应用运行期间不会因源码或构建文件变化而自动重启。使用 [`Debug.bat`](Debug.bat) 可快速启动已有构建；使用 `npm run desktop:dev` 可监听源码并热重载，主进程重建时 Electron 会重启。

运行开发检查、资源校验及所有非桌面测试：

```powershell
npm run verify
```

也可以单独运行检查：

```powershell
npm run typecheck
npm run desktop:typecheck
npm run lint
npm run resources:validate
npm run test:unit
npm run test:integration
npm run test:compiler
npm run test:cli
```

发行检查会运行所有检查，包括构建和隔离的 Electron 桌面回归：

```powershell
npm run verify:release
```

单元测试可以按功能域运行。完整列表见[测试说明](docs/TESTING.md)：

```powershell
npm run test:unit:ai
npm run test:unit:editor
npm run test:unit:preview
npm run test:unit:projects
npm run test:unit:references
npm run test:unit:compiler
npm run test:unit:settings
```

查看和运行桌面检查或诊断预览：

```powershell
npm run desktop:test-check-list
npm run desktop:test-check -- project-references
npm run desktop:diagnose-preview
```

`npm run test:debug` 会串行运行测试，并输出详细用例位置和耗时。[测试说明](docs/TESTING.md)介绍覆盖范围、隔离方式和发行检查。

## Windows 打包

在 Windows 上运行完整发行检查并生成 x64 便携版：

```powershell
npm run desktop:dist:win
```

产物写入 `release/<版本号>/`。当前流程只生成便携版，不注册文件关联或创建安装快捷方式。用户设置保存在系统用户数据目录，项目仍留在原位置。当前构建尚未签名，Windows 可能显示 SmartScreen 提示。安装器将另行设计。

## 命令行工具

仓库也提供用于项目和工具链操作的 CLI：

```powershell
npm run cli -- doctor
npm run cli -- project create --name paper --parent D:\Projects --json
npm run cli -- project register D:\Projects\existing --json
npm run cli -- project list --json
npm run cli -- file tree <project-id> --json
npm run cli -- file read <project-id> main.tex
npm run cli -- file write <project-id> main.tex --stdin --json
npm run cli -- main set <project-id> main.tex --json
npm run cli -- compile <project-id> --json
npm run cli -- resources validate
npm run cli -- resources search sec --json
```

`doctor` 会报告 Node.js、资源和 `latexmk` 工具链状态。缺少 LaTeX 工具链时，项目管理和不依赖真实编译器的测试仍可运行；实际编译则无法进行。

## 数据与隐私

LaTeX 项目文件保留在用户创建或打开的文件夹中。桌面应用的注册表、设置、文献库及其他用户数据位于 Electron 用户数据目录（Windows 通常为 `%APPDATA%\\TeXWeave`）；项目级设置和块结构数据保存在各项目自己的 `.texweave/` 目录中。CLI 注册表默认位于 `%LOCALAPPDATA%\\latex-editor`，可通过 `LATEX_EDITOR_DATA_DIR` 更改。

可在设置中管理拼写检查语言资源；下载词典需要网络连接。应用不提供云端同步。

## 工程结构

- `apps/desktop/`：Electron 主进程、preload、安全 IPC 和 React 桌面界面。
- `apps/cli/`：CLI 命令行入口。
- `packages/`：共享 contracts、domain、application，以及文件系统、SQLite 注册表和 LaTeX 编译器适配器。
- `resources/`：环境定义、命令、模板和其他数据驱动资源。
- `tests/`：单元、集成、编译器和 CLI 测试。
- `docs/`：用户、开发、架构和功能技术文档。完整目录职责见[工程结构文档](docs/architecture/PROJECT_STRUCTURE.md)。

模块职责、数据流和安全边界见[后端架构说明](docs/BACKEND_ARCHITECTURE.md)。

## 当前限制

可视化预览是结构化编辑视图，不是完整的 TeX 排版引擎；最终版面请以编译后的 PDF 为准。预览对 LaTeX 宏包、用户自定义宏和复杂表格的支持可能有限，但源码仍可交由本机 TeX 工具链编译。

AI 支持 Codex 和 Copilot 对话。输入框提供三种权限模式：审查后应用、自动编辑（默认）和完全访问。三种模式均可进行常规网络搜索。自动编辑会保留差异供审查，可逐条或全部接受、撤销。接受后，使用工作台的 Ctrl+Z/Ctrl+Y 撤销或重做，包括文件创建与删除；不再显示 AI Undo 按钮。完全访问允许操作项目以外的文件和运行命令；这些外部副作用不属于项目编辑撤销历史。

`npm run desktop:test-ai-review` 使用离屏 Electron、隔离的临时项目和模拟 AI 输出，检查布局、权限切换、差异审查和多次撤销；它不会连接真实 AI 服务。
