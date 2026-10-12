# 0.6.4 仓库体检

日期：2026-10-08。覆盖桌面主进程、preload、renderer、CLI、共享包、资源、测试和构建配置。当前目录导航见 [工程结构](architecture/PROJECT_STRUCTURE.md)，基础架构说明见 [BACKEND_ARCHITECTURE](BACKEND_ARCHITECTURE.md)。

后续处理状态：文本版本边界已改为明确的已保存/工作集视图，并移除桌面未带版本的范围更新接口。实现与回归详见 [文档版本模型](WORKING_DOCUMENT_MODEL.md)。下面保留初次体检的结果与风险证据。

AI 附件缓存的后续处理也已完成：改用草稿所属的有界暂存仓库，补齐发送、移除、切换及退出的释放路径。机制见 [AI 附件生命周期](AI_ATTACHMENT_LIFECYCLE.md)。

## 结论

项目的分层方向合理：契约集中、共享解析器、不同入口调用应用服务、项目块服务共用事务和存储。主要问题集中在跨版本状态边界、生命周期收尾、大组件承担过多职责，以及工程检查未覆盖真实 UI 生命周期。

这次没有进行全仓目录搬迁。已修复能够明确复现或局部验证的问题；其余风险按影响和修改范围分级。下面的“风险”不等同于已经发生的数据损坏或安全漏洞。

## 本次修复

### 1. Preview 加载时的 React Hook 顺序错误

[PreviewPane.tsx](../apps/desktop/src/renderer/preview/PreviewPane.tsx) 的工具栏定位 `useLayoutEffect` 位于无文件、尚未读取源码、非 TeX 文件的提前返回之后。真实 Electron 检查复现 React #310；单元测试、类型检查和原有 lint 都未发现。

已把 Hook 移入无条件调用部分。复测通过：split/single 两种布局下异步加载 Visual，以及非 TeX 文件切换至 TeX，共四个场景。

### 2. CLI 同一错误类型加载了两份模块

CLI 从跨包 `src` 引入 `AppError`，服务从包导出加载同名类，使 `instanceof` 失败。`project show missing-project --json` 原先只输出普通 stderr，退出码为 1；编译后的 CLI 又保留了指向不存在的源码 `.js` 路径，启动报 `ERR_MODULE_NOT_FOUND`。

已将 CLI 的共享依赖统一为包导出。新增源代码入口和编译入口回归：上述命令均返回 JSON `PROJECT_NOT_FOUND` 和约定退出码 2。见 [CLI 入口](../apps/cli/src/index.ts)、[工作流测试](../tests/e2e-cli/workflow.test.ts)。

### 3. 搜索、结构 reconcile 与 Preview 配置不一致

搜索控制器没有传入特殊命令配置；同时把“禁用环境的视觉块”直接用于 canonical 结构 reconcile，可能使隐藏环境的源代码块从提交的结构描述中消失。

初次修复将显示视图与 canonical 结构视图区分，双方采用同一特殊命令配置。后续版本边界改造已将 canonical 解析统一到 [工作集应用服务](../packages/application/src/working-documents.ts)，删除双重解析助手，并将配置一致性和禁用环境保留的回归迁移至工作集测试。

[searchController.ts](../apps/desktop/src/renderer/workbench/searchController.ts) 的异步 reconcile 回调也增加取消标记，避免旧文件/旧输入的响应覆盖当前界面映射。该标记阻止过期 UI 回写，不会撤销已经到达后端的写操作；buffer/磁盘边界仍需单独治理。

### 4. Markdown 测试误把属性顺序当成语义

任务列表测试依赖 React 输出 HTML 的属性排列顺序。已改为检查 checkbox、只读、选中状态和文字内容，保留原有行为约束。见 [测试](../tests/unit/ai-message-markdown.test.ts)。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run verify` | 共享类型、桌面类型、全仓 lint、资源校验、测试通过 |
| Vitest | 53 个测试文件，360 项测试通过 |
| 实际 LaTeX 工具链测试 | compiler 项目 5 项通过；CLI 创建、编辑、编译流程通过 |
| 桌面生产构建 | 通过，renderer、main、preload 已生成 |
| `desktop:test-preview-startup` | 真实 Electron 4 个加载/切换场景通过 |
| 静态导入图检查 | 初次扫描 189 个模块、367 条解析到的运行时静态边，未发现强连通环 |

导入图检查跳过 type-only import；不涵盖动态导入、Worker、IPC、事件或状态依赖，因此不能据此宣称不存在逻辑循环。

本次没有调用付费或联网 AI 模型，没有重新制作安装器，没有做长时间内存曲线或全量大项目性能测量，也没有完成依赖漏洞公告扫描。自动化通过不代表所有交互、供应商状态和打包机器均已验证。

## 优先改进：正确性与生命周期

| 优先级 | 问题和证据 | 建议 |
| --- | --- | --- |
| 高 | **结构的文本版本边界不明确**。前端 searchController 使用未保存 tabs 内容 reconcile；后端 document-structure-service 的 `#refresh` / `#read` 从磁盘读取。两条路径会更新同一块图。 | 明确 saved 与 working 文档版本；buffer 操作携带 revision/hash，或引入应用层 overlay read port；避免把未保存投影与已保存结构混为同一版本。测试未保存编辑、AI 查询、导航及保存交错场景。 |
| 高 | **AI 附件缓存缺少释放**。ai-workspace 的 `#attachments` 存储粘贴的 Buffer，没有 delete/clear；AIView 移除附件仅删界面数组；dispose 也未清缓存。20 MB 单文件、50 MB 单轮限制不限制会话累计缓存。 | 建立草稿/会话归属、remove/release 接口、总容量和过期清理；成功写入工作副本后按重试需求释放。关闭项目及销毁 workspace 时回收。不能只删除当前对话数组。 |
| 中 | **预览链接修饰键仍写死 Ctrl**。源码 editorMount 读取 `referenceLinkModifier`，PreviewPane 的指针/点击判断硬编码 ctrlKey。 | 共享链接修饰键判定；保留块多选修饰键的独立职责。覆盖 Alt/Shift/Meta 与多选的冲突场景。 |
| 中 | **环境配置的运行时校验不完整**。contracts/settings 的 environments 校验仅验证浅层字段；renderer environmentConfig 又维护一份不同的 guard。 | 将完整判别联合、family、match/style/behavior 字段校验放到共享边界，导入、IPC 和读取沿用同一规则；损坏配置退回默认并给简洁提示。 |
| 中 | **跨项目结构缓存没有清晰回收入口**。document-structure-service 持有项目级解析、文本、查询 Map；文件删除处理不等同于关闭项目释放。 | 明确 closeProject/dispose 生命周期并建立容量限制；不能让“缓存存在”成为结构真值判定。 |

证据入口：[结构服务](../packages/application/src/document-structure-service.ts)、[AI workspace](../apps/desktop/src/main/ai/ai-workspace.ts)、[AIView](../apps/desktop/src/renderer/ai/AIView.tsx)、[编辑器挂载](../apps/desktop/src/renderer/workbench/editorMount.ts)、[共享设置](../packages/contracts/src/settings.ts)、[环境配置](../apps/desktop/src/renderer/preview/environmentConfig.ts)。这些风险尚未在本次修改中整体解决；尤其 buffer 与磁盘的交错影响属于代码路径确认，尚未执行完整复现场景。

## 性能与构建

1. **Preview 增量优化没有覆盖所有旁路。** searchController 的 filterDocuments 在 tabs 内容变动时重新解析全部搜索到的 TeX 文件；450 ms debounce 延迟的是 reconcile IPC，未延迟这次解析。应增加按文件内容及解析配置版本缓存，变更只失效对应文件。需要大项目基准验证收益，不能仅凭代码路径宣称已有某个耗时。
2. **结构查询仍有全项目检查成本。** 后端缓存避免重复完整 parse，但 refresh 仍遍历项目、检查文本、指纹和 aux 编号。可利用文件变更版本和编号依赖逐项失效，保留外部编辑的正确性检测。
3. **初始 renderer 包较大。** 本次生产构建主 JS 约 5.17 MB，gzip 约 1.40 MB；CSS 约 480 KB。离线捆绑合理，但设置管理器、AI、PDF 等可以评估按需加载。先测首页与首次打开编辑器，不能简单提高警告阈值作为优化成果。

## 模块职责和重复

以下规模是本次检查时的近似行数；长 JSX 行意味着行数并不能代表真实复杂度。

| 模块 | 规模和责任集中情况 | 建议边界 |
| --- | --- | --- |
| PreviewPane | 约 1,600 行；解析、虚拟化、选中、编辑、导航、块操作、菜单、持久化及多个 effect | document / selection / actions / navigation / rendering，保留 Pane 组合入口 |
| Workbench | 约 915 行、37 个 useEffect，已有控制器但仍承接大量状态与接口组合 | 各功能控制器拥有生命周期；Workbench 负责布局和连接 |
| AI workspace | 约 935 行；两个供应商的准备、停止、完成、持久化和审查 | turn 生命周期、附件仓库、工作副本/审查；供应商适配保持分开 |
| main/index | 约 722 行、84 个直接 handleIpc 调用 | bootstrap 组合与按功能 IPC 注册分开，沿用现有 typed descriptor |
| editor-core/block-graph | 约 931 行；身份、结构、能力、关系、历史等 | 保留稳定 facade，内部拆领域职责；避免新增重复持久化 |
| SettingsDialog | 约 624 行，分类、搜索、控制渲染、重置和管理器组合 | 单一 SettingDefinition registry 驱动分类和可见性，存储契约独立 |

除此之外：

- **包边界只在 TypeScript 中声明。** 10 个 packages 的 manifest 均没有 dependencies，内部边实际存在于 references/import。根目录 hoisting 暂时掩盖它；应补齐依赖元数据和 lockfile，并加入边界检查及干净构建验证。
- **测试启动器仍有重复。** desktop/scripts 共 44 个文件，多个 run 脚本重复 spawn/env/退出码逻辑，共享 launcher 只覆盖部分场景。整合启动器，保留场景检查文件及 npm 旧入口兼容；不合并不同测试的断言逻辑。
- **本地化定义分散。** i18n/index 中存在 JSON 字典之外的数组、循环和覆盖；查找键的最终值不直观。收敛到每种语言的字典及统一 fallback/key 检查，动态自定义环境标签另行处理。
- **test-support 是空壳包。** 只有没有使用方的 fixture 路径常量，可以迁至 tests/helpers 或在后续移除。domain 虽小但有真实使用方，不应按行数合并。
- **源文件分类、LaTeX 小型扫描有重复。** AI 依赖收集、图表识别、数学定位和预览可共用注释、参数、词法工具，但结果语义不同。编译 `.fls` 仍是实际依赖证据；静态扫描不能取代工具链输出。历史/导出/AI 的文件包含策略也不能粗暴统一为最窄过滤器。
- **设置与阅读状态的存储边界分散。** 明确全局、项目、设备阅读状态、一次会话状态；可移植配置与设备位置不能都写入 structure。

## 应保留的设计

- [desktop-ipc.cts](../packages/contracts/src/desktop-ipc.cts) 已是 preload、renderer 和 main 的契约来源。它的 CJS 格式是 sandbox preload 的兼容需要。
- Renderer 的 parser/types/reconciliation facade 对共享 editor-core 的依赖是合理的；不再引入第三份解析实现。
- [project-block-services](../packages/application/src/project-block-services.ts) 共用项目锁、持久化和图历史，structure/blockGraph/relations 的职责分离值得保留。
- Electron nodeIntegration 关闭，contextIsolation/sandbox 开启；文件适配器有路径、真实路径和原子写入保护。现有安全边界与编译参数检查测试通过，但本次不是完整渗透测试。
- 版本号来自根 package.json，首页、Vite 注入、主进程和打包沿用同一来源，不新增手写版本常量。

## 测试与发布门槛

当前 `verify` 没有运行 Electron 场景检查，ESLint 也没有 React Hook 规则；本次 #310 正好证明这个缺口。建议最小发布检查包括：

1. `verify`（已有）；
2. Hook 规则和模块依赖边界检查；
3. 独立 profile 的 Preview 启动及文件切换检查；
4. buffer/磁盘交错、附件移除及反复开关项目的回归；
5. 对应版本安装器/portable 的 package 验证。

常规检查不要自动调用真实 AI 模型。CLI 与测试需要先构建包导出，避免用旧 dist 或源码/编译产物混合实例得出误判。

## 推荐实施顺序

1. **先统一文档版本边界、附件回收、链接修饰键和配置校验。** 这些直接影响正确性或长期运行。
2. **补工程门槛。** Hook lint、包依赖元数据、UI smoke 和干净构建。
3. **拆 PreviewPane 和 AI turn 生命周期，再继续收窄 Workbench、main/index。** 按状态归属拆分，每一步都保持现有入口。
4. **做文件级缓存和按需加载，最后整理字典与重复启动器。** 用实际基准判断收益。

完成这些后再考虑更大目录重排，避免把现有状态问题搬进更多目录而没有解决。
