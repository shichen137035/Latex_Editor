# TeXWeave

TeXWeave 是一款面向本地项目的 LaTeX 桌面编辑器。它将源码编辑、结构化预览、PDF 编译与定位、文献管理和块关系工具整合在一个工作区中。项目文件保留在用户选择的文件夹里；应用使用 Electron、React、TypeScript 和 Monaco Editor 构建。

当前仓库 `package.json` 中的版本为 **0.3.4**。这是本地优先的桌面应用，不要求把论文或项目上传到云端。

## 功能概览

- **项目与文件**：创建项目或打开已有文件夹；管理多文件 LaTeX 项目、主文件和本地文件树。可拖入图片或文件夹，支持过滤和隐藏编译产物及 TeXWeave 配置文件。
- **源码编辑**：基于 Monaco 的 LaTeX/BibTeX 编辑器，含语义补全、文档单词建议、括号配对、拼写检查、环境/引用快捷工具和可配置快捷键。
- **可视化预览**：解析标题信息、章节、常见 LaTeX 环境、行内与行间数学公式、引用、图片和表格；支持块级选择、局部源码编辑、自定义块及块关系操作。预览用于结构化阅读和编辑，不保证与 PDF 排版完全一致。
- **编译与 PDF**：通过 `latexmk` 编译，可选择可用的 LaTeX 引擎；在工作区查看 PDF 与编译诊断，并通过 SyncTeX 在源码和 PDF 之间定位。编译需要本机安装 LaTeX 工具链。
- **表格和图片**：通过工具插入图片/图组和表格；预览中可编辑常见表格结构，包括单元格内容、行列和合并/拆分。复杂或非标准 LaTeX 表格仍以源码和实际编译结果为准。
- **文献管理**：项目内文献快捷栏可筛选图书馆条目并插入引用；独立文献库页面支持管理条目、BibTeX 导入/编辑、检索、筛选、收藏和排序。
- **块关系**：为结构块建立从属与前提/结果关系，支持关系浏览、图形视图、校验与项目内持久化；也可从选区创建自定义块。
- **设置与本地化**：全局和项目级设置、浅色/深色及可导入主题、样式资源、环境管理、搜索与筛选、拼写检查资源配置。界面提供英语、简体中文、繁体中文、日语、韩语和法语。

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

Windows 也可以双击根目录的 [`Start.bat`](Start.bat)。脚本会检查 Node.js/npm；若 Electron 依赖缺失，会先运行 `npm install`，然后启动桌面开发版。

运行完整静态检查、资源校验和测试：

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

部分桌面端验证脚本需要启动 Electron，可按需运行：

```powershell
npm run desktop:test-ui
npm run desktop:test-preview
npm run desktop:test-preview-startup
npm run desktop:test-preview-large
npm run desktop:test-compiler-path
npm run desktop:test-foundations
npm run desktop:test-spellcheck
```

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

可视化预览是 LaTeX 文档的结构化编辑视图，不是完整 TeX 排版引擎；最终版面请以编译后的 PDF 为准。AI 编辑和版本历史目前仍是预留界面，尚未实现完整功能。LaTeX 宏包、用户自定义宏及复杂表格在预览中的支持范围可能有限，但源码仍可交由本机 TeX 工具链编译。
