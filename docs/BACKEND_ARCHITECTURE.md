# v0.1 后端技术说明

本文说明项目后端各类别的作用、依赖边界和调试方式。规范中的接口和验收要求仍以 [V0.1 技术要求与测试规格](../V0.1_TECHNICAL_REQUIREMENTS_AND_TEST_SPEC.md) 及对应 v0.2.x 更新手册为准。

## 1. 运行边界

```text
CLI / future Electron main
          │
          ▼
Application services
          │
          ├── ProjectService
          ├── DocumentService
          └── LatexmkCompilerService
          │
          ▼
Ports / contracts
          │
          ├── SQLite registry
          ├── Node filesystem
          ├── JSON resource catalog
          └── latexmk process
```

当前仓库刻意没有 renderer、React 或 Monaco。CLI 和测试直接调用同一组服务，后续加入 Electron 时只应增加 preload/IPC adapter，不应把业务逻辑复制到窗口或 IPC handler 中。

## 2. 目录与类别职责

| 类别 | 位置 | 作用 | 不负责什么 |
| --- | --- | --- | --- |
| Contracts | `packages/contracts` | 公共数据模型、错误码、编译结果和诊断格式 | 不访问文件、数据库或进程 |
| Domain | `packages/domain` | 时钟、ID、时间和路径比较等可替换的纯规则 | 不直接依赖 Node fs、Electron 或 SQLite |
| Application | `packages/application` | 编排项目创建、注册、打开、主文件和删除用例 | 不实现具体存储 |
| Editor Core | `packages/editor-core` | 文档状态机、revision、外部修改检测、LaTeX 轻量扫描、补全转换 | 不依赖 Monaco 或 DOM |
| Block Graph | `packages/editor-core/src/block-graph.ts` | 稳定块 ID、结构从属树、逻辑前提图、遍历、SCC 与关系诊断 | 不解析 React 状态，不自动推断或删减语义边 |
| Block Graph Application Service | `packages/application/src/block-graph-service.ts` | 按项目串行化图修改并读写 `.texweave/block-graph.json` | 不把关系写进 LaTeX 源文档 |
| Filesystem Adapter | `packages/filesystem-node` | canonical path、UTF-8 文件读写、原子保存、路径安全和目录操作 | 不决定项目业务状态 |
| Registry Adapter | `packages/registry-sqlite` | SQLite migration、项目元数据查询和持久化 | 不保存源文件正文 |
| Resource Catalog | `packages/resource-catalog` | 校验并加载命令、环境、模板和编译器 profile | 不执行资源中的代码或 shell |
| Style Resource Repository | `apps/desktop/src/main/style-resources.ts` + `resources/style-resources` | 管理内置/用户 `.sty`、`.cls`、`.bst`、`.bib`、`.tex` 等资源，并在项目创建时提供可复制的内容快照 | 不让项目运行时引用 userData 或安装目录 |
| Diagnostics | `packages/diagnostics` | 将 TeX/latexmk 日志转成统一诊断 | 不启动编译进程 |
| Compiler Adapter | `packages/compiler-latexmk` | 检测工具链、启动/取消/超时、日志和 PDF 结果 | 不提供 UI |
| CLI | `apps/cli` | 非交互调试入口、退出码和 JSON stdout 合同 | 不复制 application 业务逻辑 |

## 3. 关键数据流

### 项目与文件

1. `ProjectService` 通过 `NodeProjectEnvironment` 规范化目录并检查读写权限。
2. `SQLiteProjectRegistry` 保存项目 ID、名称、canonical path、主文件和时间字段。
3. `NodeProjectFileService` 只接受项目相对路径。
4. 写文件时先写同目录临时文件，再 rename；项目源文件不进入 SQLite。

### 样式资源与项目 bootstrap

1. `StyleResourceRepository` 从应用资源目录读取只读的 `built-in/empty` 和 `built-in/default`，从 Electron `userData/style-resources/user` 读取用户资源。
2. 导入文件/文件夹时复制内容并写入 `resource.json`，不保存原始路径作为运行时依赖；manifest 的 `targetPath` 决定资源进入项目后的相对位置。
3. `ProjectService.createProject` 先写模板，再检测资源目标路径冲突，读取资源内容写入项目；资源复制失败会回滚新目录。
4. 资源的 `mainStyle` 只在元数据明确声明时用于在 `main.tex` 中插入 `\\usepackage{...}`。单个导入 `.sty` 会安全推断其包名，多文件资源不会猜测任意导入。
5. `reference.bib` 是新建项目的标准文件；资源内附带的其他 `.bib` 只作为独立文件复制，不会合并或静默覆盖它。

核心不变量：

```text
TeXWeave style library --copy snapshot--> Project/texweave.sty
                                           Project/main.tex
                                           Project/reference.bib
```

项目编译只读取项目目录中的副本。删除或修改资源库条目不会回写已存在项目。

### 源代码编辑

1. `DocumentService.open` 读取 UTF-8 文件，记录 `diskHash` 和 `revision=1`。
2. `applyChanges` 更新内存缓冲区并递增 revision，状态变为 `dirty`。
3. `save` 重新计算磁盘哈希；不同且没有 `force` 时返回 `EXTERNAL_MODIFICATION_CONFLICT`。
4. `scanLatex` 只处理命令、环境、label/ref/cite/input/include，并忽略真实注释。
5. `EditorIntelligenceService` 从外部 JSON catalog 生成编辑器无关的补全结果。

### LaTeX 编译

1. `LatexmkCompilerService` 验证项目、主文件和项目根边界。
2. 编译参数来自 `resources/compiler-profiles/latexmk-pdf.json`，并经过 allowlist；禁止 `-shell-escape`。
3. 使用参数数组和 `shell: false` 启动 `latexmk`，工作目录是项目根目录。
4. Windows GUI 进程可能继承 Explorer 的旧 PATH；compiler adapter 会在不启用 shell 的前提下补入已存在的常见 MiKTeX、TeX Live、TinyTeX 和 Strawberry Perl 目录，并去除大小写重复的 PATH 键。
4. stdout/stderr 的有限 tail 返回给调用方，完整输出写入 `.latex-editor/build/<compilation-id>.log`。
5. 退出码、PDF 是否存在、超时/取消状态和诊断共同决定最终结果。

### v0.3 块关系图

1. `SemanticBlock.id` 是独立于行号和字符偏移的稳定 ID；源码位置只作为可更新的附加信息。
2. 结构从属关系是至多一个父节点的树/森林，写入结构环会返回 `STRUCTURAL_CYCLE`。
3. 逻辑边统一解释为 `from（前提）→ to（结论）`。逻辑环可以保存，Tarjan SCC 会将其作为 warning 报告。
4. `ProjectBlockGraphService` 把图快照保存到项目的 `.texweave/block-graph.json`，同一项目的并发修改按顺序提交。
5. 删除块会移除所有入边、出边和结构关系，但不会自动生成跨过该块的新依赖。
6. Electron renderer 只能通过 `window.latexEditor.blockGraph` 的 preload 白名单调用图接口；算法不在前端重复实现。

主要查询接口包括直接/完整前提与结果、最短距离与深度限制、结构祖先/后代、SCC/环检测、前提集合内的结构重叠与逻辑分层、两块之间的路径候选集合，以及统一 `validate` 诊断。

## 4. 安全约束

- `validateRelativePath` 拒绝绝对路径、空路径、`.` 和 `..`。
- `resolveSafeProjectPath` 对现有目标和最近存在父目录执行 `realpath`，阻止 symlink/junction 逃逸。
- 本地目录删除需要 `--delete-local` 和完全匹配的 `--confirm-path`，根目录和用户目录会被拒绝。
- 编译器不使用 shell，不从资源文件读取任意命令字符串。
- renderer 只能通过白名单 preload API 调用这些服务；资源库和编译器路径不会暴露给 renderer。

## 5. 测试分类

- `tests/unit`：文档状态机、扫描器、资源接口、诊断 parser，以及块关系图和项目级图持久化。
- `tests/integration`：临时目录、真实 UTF-8 文件、SQLite、外部修改和路径安全。
- `tests/compiler`：真实 `latexmk`，覆盖 PDF 成功、语法错误、引用警告和缺失 package。
- `tests/e2e-cli`：验证 CLI 的创建、写入、JSON 输出和真实编译闭环。

推荐执行：

```powershell
npm run typecheck
npm run lint
npm run resources:validate
npm test
```

## 6. 当前未接入的类别

版本快照、在线资源目录和复杂模板向导仍是后续模块。Electron renderer 只能通过白名单 preload API 管理资源，不能直接读写 userData、资源安装目录或调用 `latexmk`。
