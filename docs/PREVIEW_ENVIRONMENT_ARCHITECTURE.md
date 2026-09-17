# Preview 与环境管理架构

TeXWeave v0.2.2 的 `Visual` 模式不是 PDF 替代品，而是保留源码位置的结构化阅读与局部编辑层。

## 数据流

1. `preview/parser.ts` 扫描 LaTeX 环境、章节命令、展示公式、TeXWeave 虚拟块和启用的自定义模式。
2. 解析结果由 `StructuralBlock` 与 `ContentRegion` 组成；每个节点都保留精确的文件、偏移量和行列范围。
3. `PreviewPane.tsx` 根据环境定义渲染块。单击块标题只选择块，单击正文才打开该范围的 Monaco 局部编辑器。
4. 应用编辑时只替换节点的源码范围，保存仍沿用工作区原有文件 IPC。

## 环境定义

`EnvironmentDefinition` 同时描述：

- 匹配来源：LaTeX 环境、命令、展示公式、虚拟块或自定义正则模式；
- 视觉族与语义样式 token；
- 是否可选、可局部编辑、允许子块、显示标题/标签及加入 Outline；
- 启用状态与内置/自定义身份。

内置目录的唯一来源是 `resources/environments/preview-environments.json`。该文件包含默认样式、各视觉族 token、默认行为和所有内置匹配规则；`preview/environments.ts` 只负责加载、检查重复 ID、合并默认值和生成类型安全的运行时对象。资源校验器也会检查该文件的环境 ID、family 和 match 字段。

项目目录齿轮中的管理器修改工作区定义；工作区内 Settings 的子菜单保存项目级定义。项目级定义存在时优先使用。两套 GUI 均可切换到高级 XML，XML 与表单编辑同一个内存模型，只有验证成功后才替换活动配置。

## 降级原则

- 禁用环境仅移除 TeXWeave 块语义，不删除源码；正文继续以普通内容显示。
- 未知 LaTeX 环境使用通用块渲染，不会导致 Preview 崩溃。
- 无效自定义正则只产生局部诊断，不阻止其他内容显示。
- 普通未选中块使用透明背景和极淡边框；选中后才显示明确边框与强调色。

## 持久化

- 工作区定义：`texweave.environments.global.v1`
- 项目定义：`texweave.environments.project.<projectId>`
- 旧版仅保存启停布尔值的项目配置会在首次读取时合并到当前工作区定义。

当前持久化位于 Electron renderer 的本地存储中；后续若迁移到配置文件或后端 repository，环境模型和 XML 格式可以保持不变。

## 快捷插入

源码与 Preview 工具栏共用 `EnvironmentQuickAction`。弹出列表直接读取当前项目最终生效的定义，只显示已启用并且可安全生成源码的 LaTeX Environment、Display Math 和 Virtual Block。选中已有文本时会用对应环境包裹该文本；没有选择时会创建空环境体。弹窗支持搜索、Escape 和点击外部关闭。
