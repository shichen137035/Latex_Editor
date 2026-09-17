# v0.1 后端技术说明

本文说明当前没有前端时，项目后端各类别的作用、依赖边界和调试方式。规范中的接口和验收要求仍以 [V0.1 技术要求与测试规格](../V0.1_TECHNICAL_REQUIREMENTS_AND_TEST_SPEC.md) 为准。

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
| Filesystem Adapter | `packages/filesystem-node` | canonical path、UTF-8 文件读写、原子保存、路径安全和目录操作 | 不决定项目业务状态 |
| Registry Adapter | `packages/registry-sqlite` | SQLite migration、项目元数据查询和持久化 | 不保存源文件正文 |
| Resource Catalog | `packages/resource-catalog` | 校验并加载命令、环境、模板和编译器 profile | 不执行资源中的代码或 shell |
| Diagnostics | `packages/diagnostics` | 将 TeX/latexmk 日志转成统一诊断 | 不启动编译进程 |
| Compiler Adapter | `packages/compiler-latexmk` | 检测工具链、启动/取消/超时、日志和 PDF 结果 | 不提供 UI |
| CLI | `apps/cli` | 非交互调试入口、退出码和 JSON stdout 合同 | 不复制 application 业务逻辑 |

## 3. 关键数据流

### 项目与文件

1. `ProjectService` 通过 `NodeProjectEnvironment` 规范化目录并检查读写权限。
2. `SQLiteProjectRegistry` 保存项目 ID、名称、canonical path、主文件和时间字段。
3. `NodeProjectFileService` 只接受项目相对路径。
4. 写文件时先写同目录临时文件，再 rename；项目源文件不进入 SQLite。

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

## 4. 安全约束

- `validateRelativePath` 拒绝绝对路径、空路径、`.` 和 `..`。
- `resolveSafeProjectPath` 对现有目标和最近存在父目录执行 `realpath`，阻止 symlink/junction 逃逸。
- 本地目录删除需要 `--delete-local` 和完全匹配的 `--confirm-path`，根目录和用户目录会被拒绝。
- 编译器不使用 shell，不从资源文件读取任意命令字符串。
- renderer 尚未存在；未来只能通过白名单 preload API 调用这些服务。

## 5. 测试分类

- `tests/unit`：文档状态机、扫描器、资源接口和诊断 parser。
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

版本快照、Electron IPC/preload、Monaco adapter 和 renderer UI 仍是后续模块。它们应复用当前 contracts/application 服务，不应把文件读写或 `latexmk` 调用移入前端。
