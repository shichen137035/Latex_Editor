# 项目结构与模块边界

检查基线：TeXWeave 0.6.4，2026-10-08。本文描述现有目录，并给出逐步拆分的方向；具体体检结论见 [体检报告](HEALTH_CHECK_0.6.4.md)。

## 目录导航

```text
Latex_Editor/
├─ apps/
│  ├─ desktop/
│  │  ├─ src/main/       Electron 组合入口、IPC、桌面服务
│  │  │  └─ ai/         AI 工作副本、工具、审批、供应商适配
│  │  ├─ src/preload/    sandbox 下的白名单桥接
│  │  ├─ src/renderer/   React、Monaco、结构预览、PDF 和管理器
│  │  ├─ scripts/        开发启动、构建、Electron 场景检查
│  │  ├─ build/          应用图标等打包输入
│  │  └─ dist/           桌面构建输出
│  └─ cli/               命令解析、终端输出及共享服务适配
├─ packages/             可被不同入口复用的契约、规则和服务
├─ resources/            默认配置、模板、样式预设、AI skill
├─ themes/               CSS 主题资源
├─ tests/                单元、集成、编译、CLI 和类型检查
├─ build/                安装器、工具链和语言资源安装配置
├─ docs/                 当前实现、接口、运维和架构说明
├─ Update_tech_file/      历次更新的需求和技术方案输入
├─ dist/                 TypeScript 构建输出
├─ release/              打包产物
├─ package.json          工作区、命令、版本号和打包配置
└─ package-lock.json     依赖锁定
```

`node_modules/`、各级 `dist/`、`release/` 和 `*.tsbuildinfo` 是生成内容，不能当成第二份源码修改。`Update_tech_file/` 是历史需求输入，`docs/` 是实现说明；发生差异时应核对实际代码及测试。当前不移动这个历史目录，避免破坏已有路径和工作流程。

## 共享包

| 包 | 当前职责 | 主要内部依赖（按 TypeScript references） |
| --- | --- | --- |
| `contracts` | 数据类型、错误、设置、类型化桌面 IPC | 无 |
| `domain` | ID、时钟等基础抽象 | 无 |
| `editor-core` | LaTeX 解析、源码索引、块图、查询、关系规则 | contracts、domain |
| `application` | 项目、文档结构、块关系等应用服务 | contracts、domain、editor-core |
| `filesystem-node` | 安全路径校验和本地文件操作 | contracts |
| `registry-sqlite` | 本地项目登记 | contracts、domain |
| `diagnostics` | 编译诊断解析和归一化 | contracts |
| `compiler-latexmk` | 工具链发现、进程调用、编译结果 | contracts、diagnostics、domain |
| `resource-catalog` | 默认命令、环境、补全等资源目录 | contracts |
| `test-support` | 当前只有未被使用的 fixture 路径常量 | 无 |

包之间应通过包导出访问，不跨包引用 `src`；同包内使用相对路径。当前 CLI 已修正跨包源码导入。内部依赖还没有声明在各包 `package.json` 中，应在后续补齐，并与 TypeScript references 对齐。

调用方向应保持为：

```text
Renderer → preload → Electron IPC ─┐
CLI 命令适配 ─────────────────────┼→ application → editor-core / contracts / domain
AI 工具、审批、工作副本适配 ──────┘               ↓
                                    文件系统 / 项目登记 / 编译适配器
```

Electron、CLI、AI 共用底层规则和应用服务，但保留各自的输入校验、权限、会话和输出格式。不能因为“统一”而让 renderer 获得任意文件系统权限，或绕过 AI 变更审查。

## 前端目录

| 目录 | 责任 |
| --- | --- |
| `workbench` | 工作区组合、文件标签、导航、搜索和编译控制器 |
| `editor`、`completion`、`spellcheck`、`math` | 源码编辑及语言服务 |
| `preview` | 共享解析器适配、增量预览、虚拟化、块操作和局部源码编辑 |
| `figure`、`table` | 图表的结构识别和编辑工具 |
| `search`、`filter` | 文本检索、结构筛选和结果模型 |
| `pdf` | PDF 显示及源码定位 |
| `relations`、`custom-blocks` | 关系视图和自定义块交互 |
| `references` | 文献库及 BibTeX 阅读、编辑 |
| `history` | 项目历史和差异界面 |
| `ai` | 对话、附件、权限和变更应用界面 |
| `settings`、`themes`、`resources` | 设置及资源管理器 |
| `i18n`、`lifecycle` | 本地化、未保存内容退出等跨功能逻辑 |

`preview/parser.ts`、`types.ts` 等薄适配文件是有意保留的稳定导入入口，实际解析实现来自 `editor-core`；不应把它们误判为重复解析器。

## 状态归属

| 状态 | 权威来源 | 派生或交互状态 |
| --- | --- | --- |
| 文档文字 | 已保存文件；编辑期间的未保存 buffer | Preview、搜索、源码位置映射 |
| 块身份与语义关系 | 项目 `.texweave/structure.json`，通过共享服务更新 | renderer 的瞬时节点 ID、选择和聚焦 |
| 编译结果 | 实际工具链输出 | 诊断列表、PDF 和同步定位 |
| 项目登记 | SQLite registry | 首页项目列表 |
| 设置 | 全局设置及允许覆盖的项目设置 | 管理器筛选、输入状态 |
| 阅读位置、折叠、选择 | 用户界面状态 | 不应混入文档语义关系 |
| AI 待应用变更 | 工作副本及审查结果 | 对话显示、应用状态 |

`structure` 管文档块及源码操作，`blockGraph` 管块身份、图关系和兼容操作，`relations` 管逻辑关系用例；三者通过 [project-block-services.ts](../packages/application/src/project-block-services.ts) 共用持久化和项目事务边界。逐步迁移兼容方法即可，不新增第二份结构文件。

未保存 buffer 与磁盘文本现已使用明确的读视图：桌面查询读取带会话版本的内存工作集，磁盘结构只接收已保存内容；AI 工作副本使用自己的文件根目录。具体更新和销毁机制见 [文档版本模型](WORKING_DOCUMENT_MODEL.md)。共享存储和锁保证串行，文本指纹及会话版本保证所解释的文本一致。

## 建议的下一阶段拆分

优先拆职责和生命周期，再调整物理目录。下面是目标方向，并非已完成的目录迁移：

```text
renderer/preview/
├─ PreviewPane.tsx                 组合和公共属性入口
├─ document/usePreviewDocument.ts  增量解析、版本、语义映射
├─ selection/useBlockSelection.ts  单选、多选、范围、marquee
├─ actions/useBlockActions.ts      复制、移动、禁用、删除
├─ navigation/usePreviewLinks.ts   链接修饰键、位置跳转
└─ components/                    节点、标题编辑、工具栏

main/
├─ index.ts                       最薄启动入口
├─ bootstrap.ts                   实例组合与资源生命周期
├─ ipc/                           按项目/编辑/编译/AI 等注册处理器
└─ ai/
   ├─ ai-workspace.ts             保持现有公共入口
   ├─ turn-lifecycle.ts           运行、停止、结束、失败状态
   ├─ attachments.ts              草稿归属、容量、释放
   └─ review/                    工作副本审查和应用
```

每一步保留公共接口和行为，先补相应回归场景，再迁移调用方。不要为了行数限制把同一个状态机分散到互相调用的碎片模块中。

## 检查入口

- `npm run verify`：共享及桌面类型检查、lint、资源校验、Vitest。
- `npm run desktop:test-preview-startup`：构建后验证真实 Electron 中异步加载和非 TeX/TeX 文件切换。
- `apps/desktop/scripts/README.md`：其他桌面场景脚本的用途。
- `npm run desktop:verify:package`：对已经生成的对应版本安装包进行检查；不能替代源码检查。

直接运行测试前应先构建共享包，因为包导出指向 `dist`，新增的 CLI 回归也验证编译后入口。`verify` 已包含这些构建前置条件。
