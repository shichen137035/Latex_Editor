# Local LaTeX Editor

本项目以 `V0.1_TECHNICAL_REQUIREMENTS_AND_TEST_SPEC.md` 的本地核心为基础，并按 v0.2 Workbench、v0.2.2 Preview、v0.2.3 Foundation 和 v0.2.4 Style Resources 技术手册实现 Electron、React、Monaco、设置/主题/i18n、可视化预览和本地样式资源库。项目、文件、编译服务仍可通过 CLI 和自动化测试独立验证。

## 本地开发

要求：Node.js 22+、npm 11+。真实编译还需要安装 `latexmk`、Perl 和可用的 TeX 发行版。Windows 桌面端会在继承的 PATH 之外自动检查常见 MiKTeX、TeX Live、TinyTeX 与 Strawberry Perl 位置，避免 Explorer 使用安装前的旧 PATH；非标准安装仍应加入 PATH。

```powershell
npm install
npm run doctor
npm run verify
npm run desktop:dev
```

Windows 用户也可以直接双击项目根目录下的 `启动_TeXWeave.bat`。脚本会自动定位项目目录、检查 Node.js/npm、补齐缺失依赖并启动桌面端。

v0.2.4 资源与项目 bootstrap 的 Electron 验收：

```powershell
npm run desktop:test-foundations
```

分层测试：

```powershell
npm run test:unit
npm run test:integration
npm run test:compiler
npm run test:cli
```

CLI 入口：

```text
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

SQLite 注册表默认位于 `%LOCALAPPDATA%\latex-editor\registry.sqlite`。测试或隔离运行时可用 `LATEX_EDITOR_DATA_DIR` 指定其他目录。注册表只保存项目索引和元数据，LaTeX 源文件始终保留在用户选择的真实文件夹中。

## 已实现的后端能力

- 本地项目创建、注册、列出、打开、设置主文件及安全移除。
- 项目文件树、UTF-8 读写、新建、重命名和删除；拒绝 `..`、绝对路径及符号链接/junction 逃逸。
- 编辑缓冲区的 `clean`、`dirty`、`externallyModified`、`deletedOnDisk` 状态和 revision 检查。
- 保存前磁盘哈希校验；默认拒绝覆盖外部修改，只有显式 `force` 才覆盖。
- 容错 LaTeX 扫描和来自外部资源文件的命令/环境补全。
- `latexmk` 参数数组调用、`shell: false`、超时/取消、有限日志尾部、完整日志文件和结构化诊断。
- 数据驱动的项目模板、命令、环境和编译器 profile。
- Electron + React 项目目录页：搜索项目、创建新项目和选择已有系统文件夹。
- Monaco 源码编辑器、多文件标签、文件树、基础 Outline、保存状态及 LaTeX 快捷工具栏。
- 单栏/双栏布局、可拖拽 Sidebar/File Tree/Workspace/Bottom Panel 分隔条及本地布局持久化。
- 编译入口、结构化 Problems、Compile Log 和构建状态栏。
- i18n 资源层、主题设计变量、结构化 Preview、环境管理器，以及 Relations、AI Editor、Versions 的明确占位界面。
- 点击编辑器工具栏的 `Visual` 可进入结构化 Preview；块标题用于选择，正文用于局部源码编辑。
- 项目目录主设置和工作区项目设置均可进入环境管理器，支持启停、新建、编辑、复制、重置、删除自定义定义及高级 XML。
- 内置 Preview 环境来自 `resources/environments/preview-environments.json`，不再由 React/TypeScript 写死；编辑工具栏的 Environment 按钮会列出当前项目启用的定义并插入相应源码。
- Settings → Style Resources 管理内置 Empty/Default、用户资源导入、文件夹导入、复制、重命名和删除；自定义资源保存在 Electron userData 中。
- 新建空白项目会创建 `main.tex` 和空的 `reference.bib`；选择 Default 或自定义 `.sty` 后，资源文件会在创建时复制到项目根目录，并按安全元数据自动插入 `\\usepackage{...}`。
- 项目只依赖本地快照，不依赖 TeXWeave 安装目录；资源库后续变化不会修改已创建项目。Online Resources 目前仅保留诚实的占位区域。

目录按分层架构组织：`apps/` 放 CLI，`packages/` 放 contracts、domain、application 和基础设施适配器，`resources/` 放可编辑数据资源，`tests/` 放分层测试。

更详细的类别职责、数据流、安全边界和测试分类见 [docs/BACKEND_ARCHITECTURE.md](docs/BACKEND_ARCHITECTURE.md)。

## 工具链排查

如果 `doctor` 仍报告 `latexmk` 不可用，请依次确认 `Get-Command latexmk`、`Get-Command perl` 能找到命令，并在 MiKTeX Console 中检查更新、LaTeX 引擎与包管理器。无可用 LaTeX 工具链时，核心单元/集成测试仍会运行，真实编译测试会明确标记为 skipped。

`latexmk` 默认 profile 仅允许 `-pdf`、`-file-line-error`、`-interaction=nonstopmode` 和 `-synctex=1`；`-shell-escape` 被拒绝。

## 当前边界

Relations、AI Editor 和版本快照后端尚未实现。v0.2.2 已提供结构化 Preview 和内嵌 PDF 查看；Preview 是面向阅读与局部编辑的语义层，不追求与最终 PDF 完全相同的排版。源文件读取、保存与 `latexmk` 编译通过 preload/IPC 调用既有核心服务，renderer 不直接访问文件系统。
