# TeXWeave

TeXWeave 是一款面向本地项目的 LaTeX 桌面编辑器。它将源码编辑、结构化预览、PDF 编译与定位、文献管理和块关系工具整合在一个工作区中。项目文件保留在用户选择的文件夹里；应用使用 Electron、React、TypeScript 和 Monaco Editor 构建。

版本统一以根目录 [`package.json`](package.json) 为准，界面和安装器使用同一版本来源。这是本地优先的桌面应用，不要求把论文或项目上传到云端。

开发者导航：[项目文件结构与模块边界](docs/REPOSITORY_STRUCTURE.md)、[0.6.6 功能清单与体检](docs/FUNCTIONAL_AUDIT_0.6.6.md)、[基础架构](docs/BACKEND_ARCHITECTURE.md)。

## 功能概览

- **项目与文件**：创建项目或打开已有文件夹；管理多文件 LaTeX 项目、主文件和本地文件树。可拖入图片或文件夹，支持过滤和隐藏编译产物及 TeXWeave 配置文件。
- **源码编辑**：基于 Monaco 的 LaTeX/BibTeX 编辑器，含语义补全、文档单词建议、括号配对、拼写检查、环境/引用快捷工具和可配置快捷键。
- **可视化预览**：解析标题信息、章节、常见 LaTeX 环境、行内与行间数学公式、引用、图片和表格；支持块级选择、局部源码编辑、自定义块及块关系操作。预览用于结构化阅读和编辑，不保证与 PDF 排版完全一致。
- **编译与 PDF**：通过 `latexmk` 编译，可选择可用的 LaTeX 引擎；在工作区查看 PDF 与编译诊断，并通过 SyncTeX 在源码和 PDF 之间定位。编译需要本机安装 LaTeX 工具链。
- **表格和图片**：通过工具插入图片/图组和表格；预览中可编辑常见表格结构，包括单元格内容、行列和合并/拆分。复杂或非标准 LaTeX 表格仍以源码和实际编译结果为准。
- **文献管理**：项目内文献快捷栏可筛选图书馆条目并插入引用；独立文献库页面支持管理条目、BibTeX 导入/编辑、检索、筛选、收藏和排序。
- **块关系**：为结构块建立从属与前提/结果关系，支持关系浏览、图形视图、校验与项目内持久化；也可从选区创建自定义块。
- **项目版本历史**：在左侧“历史”栏创建正式版本、临时保存和快照，比较文件差异，并恢复整个项目或选定文件。自动快照与风险操作前的快照可在设置中调整；历史数据保存在项目的 `.texweave/history/`，相同文件内容只存储一次。
- **块结构 API 与 AI 编辑**：共享 Preview/后端解析器，以稳定 ID、直接父子索引和 revision 管理文档块；AI 可先按标题、类型、标签、编号等定位，再只读取和修改必要内容。Codex/Copilot 的块工具沿用工作副本与 diff 审查。接口、迁移和使用方式见 [v0.5.3 后端说明](docs/block-structure-api.md)。
- **设置与本地化**：全局和项目级设置、浅色/深色及可导入主题、样式资源、环境管理、搜索与筛选、拼写检查资源配置。界面提供英语、简体中文、繁体中文、日语、韩语、法语和哈萨克语。

## 环境要求

- Node.js 22 或更新版本；npm 随 Node.js 安装。
- 开发和启动桌面端需要依赖安装完成。
- 要实际编译 LaTeX，需要 `latexmk`、Perl 和可用的 TeX 发行版（例如 MiKTeX 或 TeX Live）。Windows 桌面端会检查常见安装位置；非标准安装建议将工具加入 `PATH`。

## 开发与启动

在项目根目录运行：

```powershell
npm install
npm run doctor
npm run desktop:dev
```

Windows 也可以双击根目录的 [`Start.bat`](Start.bat)。脚本会检查 Node.js/npm；若 Electron 依赖缺失，会先运行 `npm install`，然后构建一次并启动桌面端。运行期间不会因源码或构建文件变化而自动重启。已有构建可通过 [`Debug.bat`](Debug.bat) 快速启动；需要监听源码和热重载时，使用 `npm run desktop:dev`，主进程重建会重启 Electron。

运行开发检查、资源校验和全部非桌面测试：

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

发行前运行完整检查，包括构建和隔离的 Electron 桌面回归：

```powershell
npm run verify:release
```

单元测试按功能域分组运行，完整列表见 [测试说明](docs/TESTING.md)：

```powershell
npm run test:unit:ai
npm run test:unit:editor
npm run test:unit:preview
npm run test:unit:projects
npm run test:unit:references
npm run test:unit:compiler
npm run test:unit:settings
```

桌面检查清单和运行方式：

```powershell
npm run desktop:test-check-list
npm run desktop:test-check -- project-references
npm run desktop:diagnose-preview
```

`npm run test:debug` 会串行运行并打印详细用例位置和耗时。完整测试覆盖矩阵、测试隔离方式及发行检查范围见 [测试说明](docs/TESTING.md)。

## Windows 打包

在 Windows 环境中生成 NSIS 安装程序和便携版：

```powershell
npm run desktop:dist:win
```

产物位于 `release/`。安装器允许选择安装目录并创建快捷方式；卸载时默认保留用户设置和其他用户数据。打包结果的版本号来自根目录 `package.json`。

## CLI

仓库还提供用于项目和工具链操作的 CLI：

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

`doctor` 会报告 Node、资源和 `latexmk` 工具链状态。缺少 LaTeX 工具链时，项目管理和不依赖真实编译器的测试仍可使用；实际编译则无法完成。

## 数据与隐私

LaTeX 项目文件保留在用户创建或打开的项目目录中。桌面应用的注册表、设置、文献库及其他用户数据位于 Electron 的用户数据目录（Windows 通常为 `%APPDATA%\TeXWeave`）；项目级设置和块结构数据保存在各项目自己的 `.texweave/` 目录中。CLI 注册表默认位于 `%LOCALAPPDATA%\latex-editor`，可通过 `LATEX_EDITOR_DATA_DIR` 更改。

拼写检查可在设置中管理语言资源；下载词典需要网络连接。应用不提供云端同步。

## 架构

- `apps/desktop/`：Electron 主进程、preload、安全 IPC 和 React 桌面界面。
- `apps/cli/`：命令行入口。
- `packages/`：contracts、domain、application，以及文件系统、SQLite 注册表和 LaTeX 编译器适配器。
- `resources/`：环境定义、命令/模板及其他数据驱动资源。
- `tests/`：单元、集成、编译器和 CLI 测试。
- `docs/`、`Update_tech_file/`：架构说明及版本技术要求。

关于模块职责、数据流和安全边界，参阅 [后端架构说明](docs/BACKEND_ARCHITECTURE.md)。

## 当前边界

可视化预览是 LaTeX 文档的结构化编辑视图，不是完整 TeX 排版引擎；最终版面请以编译后的 PDF 为准。LaTeX 宏包、用户自定义宏及复杂表格在预览中的支持范围可能有限，但源码仍可交由本机 TeX 工具链编译。

AI 支持 Codex 和 Copilot，新建、重命名及管理对话。输入框下方提供三种权限：审查后应用、自动编辑（默认）、完全访问；普通联网查询在三种模式下均可用。自动编辑保留待审查的 diff，可逐条或全部接受/撤回；明确接受后不再保留 AI Undo 按钮，改用工作台的 Ctrl+Z/Ctrl+Y，包括文件创建与删除。完全访问允许外部文件和命令操作，这些外部副作用不属于项目编辑撤销历史。

`npm run desktop:test-ai-review` 使用离屏 Electron、隔离的临时项目及模拟 AI 输出，验证布局、权限切换、diff 审查与多次撤销；不连接真实 AI 服务。
