# TeXWeave v0.4.3 — Reference Library & BibTeX Preview

> 状态：功能与技术设计草案  
> 适用范围：Electron + TypeScript + React、本地多文件 LaTeX 项目  
> 本版引用机制：**仅支持 Citation Key（例如 `\cite{chen2006}`）**。其他引用规范、样式系统与外部文献管理器连接预留接口，**不在 v0.4.3 实现**。

## 1. 目标与原则

1. 提供独立于项目的本地全局文献图书馆（Library），允许跨项目共享文献，管理分类、标签及使用记录。
2. `.bib` 是一等公民：支持直接导入 `.bib` 文件，也支持打开现有 `.bib` 文件并切换到 **BibTeX Preview / Reference Management** 模式。每个 BibTeX 条目显示为独立信息卡块，可查看引用位置、跳转，以及通过右侧 `+ / −` 管理是否加入全局 Library。
3. 编辑器的引用管理建立在 Citation Key 上。源码插入、补全、定位、使用统计与警告都以可解析的引用键为入口；全局库内部另用稳定 UUID 防止改名造成记录丢失。
4. 项目引用支持两条路径：**链接全局库中的文献**，或**复制文献内容到项目的 `reference.bib`**。全局库永远不是项目可编译性的单点依赖。
5. 全部数据本地优先；正常修改不得悄悄覆盖原始 `.bib` 文件、改变条目顺序、丢弃注释或破坏已有 LaTeX 项目。

### 1.1 本次范围

**包含：** 全局 Library、标签/分类、查询/筛选、导入 `.bib`、手动增删改、Citation Key 冲突检查、项目级关联、BibTeX Preview 信息卡、跨文件引用定位、Library `+ / −`、源码/预览中的引用插入、引用完整性警告、导出可独立编译的 `.bib`。

**暂缓：** Zotero/Better BibTeX API 同步、RIS/DOI 自动检索、CSL/citeproc 样式引擎、PDF 附件解析/批注、语义文献推荐、云同步、自动批量重写整个项目的 Citation Key、BibTeX/BibLaTeX 全语法兼容的承诺。保留相应适配器接口，但界面不要出现不可用的伪按钮。

## 2. 技术选型与数据边界

| 子系统 | 推荐实现 | 职责 |
|---|---|---|
| 文献解析/格式转换 | Citation.js + 按需 BibTeX 插件 | BibTeX 元数据解析、规范化与导出；实现前验证具体语法覆盖情况 |
| 全局 Library | 本地 SQLite | 文献实体、分类、标签、项目引用关联、导入来源及警告状态 |
| `.bib` 源文件 | 原始文本 + AST/条目区间索引 | 保留注释、宏、顺序、缩进和用户手工写法；支持局部修改及原样保留 |
| 项目引用索引 | 增量源码扫描服务 | 从主文件及其递归包含的 `.tex` 文件提取 Citation Key、源码范围、所在块 |
| 前端 | React，复用已有 Structured Preview 块体系 | Library 列表、BibTeX Preview 卡片、跳转、筛选、批量操作和状态展示 |

**重要：** Citation.js 是导入/导出工具，不是本地数据库，也不应被假定为能无损修改任意 `.bib` 原文。`@string`、`@preamble`、注释、复杂 TeX 转义和未知字段应通过源文本保留层处理。无法安全识别的片段展示警告并允许回退到源码编辑，不自动重写整份文件。

### 2.1 最小数据模型

- `LibraryEntry`: `id(UUID)`、`citationKey`、`entryType`、`fields(JSON)`、`rawBibtex?`、`createdAt`、`updatedAt`、`deletedAt?`。
- `Collection`: `id`、`name`、`parentId?`；多对多 `EntryCollection`，同一文献可属于多个分类。
- `Tag`: `id`、`name`、`color?`；多对多 `EntryTag`。
- `ProjectReference`: `projectId`、`libraryEntryId?`、`citationKeyInProject`、`mode(link|copy|local)`、`targetBibPath`、`lastExportHash?`、`lastSnapshot?`。
- `BibFileEntry`: `projectId?`、`filePath`、`entryStart/entryEnd`、`citationKey`、`parseStatus`、`matchedLibraryId?`、`sourceHash`。它是文件索引，不是 Library 的第二套权威记录。
- `CitationOccurrence`: `projectId`、`filePath`、`sourceRange`、`command`、`citationKey`、`blockId?`；属于可重建的派生索引。

全局库条目通过 UUID 识别，项目、文件和源码中的引用仍使用 Citation Key。必须分别处理“同键不同文献”和“同文献不同键”，禁止静默合并。

## 3. 全局 Library 页面

### 3.1 基本视图与操作

在主导航中增加 **Library** 入口；在项目 References 面板中增加 **Open Library**。两处打开同一数据库，但项目入口可默认筛选“可加入当前项目”的条目。

- 列表默认展示：标题、作者、年份、类型、Citation Key、标签、所在分类、被多少个项目使用、警告状态。
- 支持新增、编辑、复制条目、批量添加标签/分类、批量导入、从分类移除、从全局库移除；键盘与右键菜单保持一致。
- 支持收藏/最近使用（可选轻量字段），无须本版引入复杂阅读管理功能。
- 在详情中展示“Used in projects”：项目名称、链接/复制/本地状态、已加入但未在源码引用、实际引用出现次数；点击项目可跳转。

### 3.2 分类、标签及筛选

- **Collections**：支持嵌套、多分类归属和重命名；删除分类默认仅解除归属，不删除文献。
- **Tags**：自由输入、自动补全、颜色、批量增删、合并标签；项目私有标签如需存在，另存于项目关系，不修改全局标签。
- 搜索标题、作者、年份、Citation Key、文献类型、标签及可用的其他字段。
- 筛选：分类、多个标签（AND/OR）、年份区间、类型、是否被项目使用、是否在当前项目使用、是否在正文出现、警告/重复状态。
- 保存常用过滤器（如 Unused、Missing fields、Current project），筛选仅影响显示，不影响写盘或批量操作之外的数据。

## 4. `.bib` 导入与 Library 入库

### 4.1 两个主要入口

**入口 A：直接导入文件。** Library 顶部选择 `Import → BibTeX file...`，或将 `.bib` 文件拖入 Library 区域。文件解析完成后提供导入预览：全部条目数、有效/无效条目、潜在重复、Citation Key 冲突；可勾选全部或部分，再选择 `Import selected`。解析失败的条目保留原文并提示定位，不因一个坏条目丢弃其余内容。

**入口 B：从已打开的 `.bib` 文件加入。** 在项目或编辑器中打开任意 `.bib` 文件，切换到专门的 BibTeX Preview；单条信息卡右侧点击 `+` 即把条目添加到全局 Library，`−` 表示该条目已入库，可申请解除其 Library 归属。顶部提供 `Add all valid` / `Add selected`，并可按“尚未入库”筛选。

入库对话框可选择分类与标签。导入不应自动更改原 `.bib` 文件，也不应默认把当前文件外的所有条目加入项目。

### 4.2 去重与冲突

对候选条目先尝试稳定字段（如 DOI，若条目已有），否则以标题/作者/年份做辅助提示；Citation Key 相同也仅代表**可能**相同。出现匹配时选择：`Link existing`、`Update Library entry`（差异预览）、`Import as separate entry`（必须选择不冲突的 Library Key）、`Skip`。

对于已入库条目，信息卡显示 `In Library`；如果当前 `.bib` 文件内容和库中版本不同，显示 `Modified / Diff available`，不简单地显示一个“已同步”状态。

## 5. BibTeX Preview：以条目为块

这是 v0.4.3 的核心 UI。打开 `.bib` 后，和 `.tex` 一样可以切换 **Source / Preview**。Preview 不是编译后的参考文献排版，而是**结构化管理界面**，把每个有效的 `@article`、`@book`、`@inproceedings` 等条目转为一个独立信息卡块，并映射其源码区间。

### 5.1 单条信息卡布局

```text
┌──────────────────────────────────────────────────────────────────┐
│ ARTICLE   Chen & Fan (2006)                   [In Library]  [−] │
│ Estimation of Copula-Based Semiparametric Time Series Models    │
│ Key: chen2006   Journal: ...                 [Edit] [Source]     │
│ Tags: [Copula] [Time series]  Collection: [Statistics]           │
│ Used here: 3 occurrences in 2 files                [Show ▼]     │
│   main.tex:42       ... see \cite{chen2006}             [→]       │
│   chapter2.tex:118  ... \citep{chen2006}                [→]       │
│   chapter2.tex:201  ... \cite{chen2006}                 [→]       │
└──────────────────────────────────────────────────────────────────┘
```

卡片上方始终显示文献类型、作者年份、标题与 Citation Key；可折叠展示其他字段（期刊/书名/卷期/页码/DOI/URL 等）、标签与分类、当前项目使用情况。右侧 **`+` / `−` 仅表示是否属于全局 Library**，绝不同时承担“删除当前 `.bib` 条目”的语义。

- 未入库：`+ Add to Library`。成功后改为 `In Library / −`。
- 已入库：`− Remove from Library`。如果其他项目仍链接此条目，先弹出影响范围及安全选项；删除不得造成引用悬空。
- 已入库但本地内容有差异：显示差异标识与 `Compare / Update`。
- 无法解析条目：显示警告卡片、错误位置和 `Open source`，禁止危险的一键同步。
- `@string`、`@preamble` 和独立注释作为非引用辅助块或源码片段展示，不提供添加为文献的 `+`。

### 5.2 Preview 块行为

- 单击选中信息卡；多选配合 Shift/Ctrl；批量添加/移除 Library、批量打标签及分类。
- 卡片上的 `Edit` 打开简洁的字段 GUI；`Source` 定位并打开对应的 `.bib` 原文；高级/无法安全解析的内容始终可用源码编辑。
- GUI 写回时，仅补丁更新对应条目及相关字段；保留其他条目、注释、宏、空白和文件编码，写盘前比较 `sourceHash` 以防覆盖外部修改。无法无损局部编辑时要求改用源码或显式预览整体格式化差异。
- 文件修改后增量更新受影响卡片和其区间；解析过程放入 Worker/后台任务，列表虚拟滚动，避免大型 `.bib` 文件造成 Visual 初始化阻塞。
- 原 `.bib` 文件不是 Library 的“镜像”：`+` 是导入快照；之后文件与 Library 发生变化时均不默默双向覆盖。

### 5.3 “是否被引用”与跨文件跳转

每张卡展示当前项目中的引用状态：`Cited (n)`、`Not cited`、`Indexing` 或 `Unknown / partial`。展开显示引用该 Key 的其他 `.tex` 文件、行号、附近源码摘要、所在 section/块；点击跳转到对应文件及精确源码范围，并在 Source 或 Structured Preview 中高亮关联引用。

索引范围：项目入口主文件、递归 `\input` / `\include` 的本地文件，以及用户明确加入项目的 `.tex`；避免递归环、重复扫描和越界路径。支持常见 `\cite{...}` 及配置的 `\citep` / `\citet` 等多键命令，拆分 `\cite{a,b}` 为独立 occurrences；排除注释和 verbatim 等非正文区域。自定义宏、动态生成键和未加载子项目无法可靠静态识别时显示 `Partial`，不要错误地宣称“未引用”。

若同一项目内多个 `.bib` 文件包含相同 Citation Key，`Cited` 仅证明**该键在正文出现**，不证明编译器选择了这张卡片对应的条目；必须附带冲突警告。BibTeX Preview 中也可筛选 `Cited / Unused / Missing from Library / Conflict`。

## 6. 项目 References：链接与复制

| 选择 | 保存方式 | 与 Library 的关系 | 编译和分享 |
|---|---|---|---|
| **Link to Library** | 项目保存 Library UUID、项目 Citation Key；编译前生成该项目所需 `.bib` 内容 | 元数据仍以 Library 为主；有快照和可确认的更新提示 | 项目导出时附带完整 `.bib`，确保可独立编译 |
| **Copy to `reference.bib`** | 将选中文献实体写入项目指定的 `.bib` 文件 | 复制后独立编辑，不自动追随 Library | 现有 LaTeX 工具链直接使用该文件 |
| **Existing local `.bib` entry** | 保留项目原有条目 | 可从卡片点击 `+` 单独加入 Library | 原文件不被强制迁移 |

**默认交互：** 从 Library 中点 `Add to project` 时，明确展示 `Link` 与 `Copy` 两种选项，记住当前项目上次选择，但新项目首次使用时不隐式决定；从打开的 `.bib` Preview 点击 `+` 只加入 Library，绝不自动再复制到当前文件（条目本来就在当前文件中）。

**生成策略：** 对链接项写入单独的可识别生成文件（例如 `.texweave/generated-references.bib` 或项目配置指定路径），不要覆盖用户维护的 `reference.bib`。根据用户现有 `\bibliography{...}` 或 `\addbibresource{...}` 的配置选择最小必要接入方法；本版仅负责 Citation Key 的条目插入与有效引用，不引入 CSL 样式变换。用户选择导出合并版时，再合并成项目可携带的 `reference.bib`，先检查键冲突。

**无 Library 时的恢复：** 对每个 Link 存储最近一次成功导出的条目快照。数据库不可用时优先保留已生成 `.bib`、提示“引用库离线 / 使用缓存”，避免破坏已有编译。

## 7. 引用输入、定位与批量操作

- Source 模式：输入 `\cite{` 打开 Citation Key 搜索补全；可查当前项目与全局库。选 Library 中未在项目登记的文献时先链接或复制，再插入 `\cite{key}`；输入多个键时去重并提供预览。
- 文本/块 Preview：点击已经识别的 `\cite{key}`，弹出简洁引用信息卡，提供 `Open BibTeX entry`、`Show occurrences`、`Open Library`、`Go to source`；BibTeX Preview 的 `→` 与此互相跳转。
- `.bib` Preview 顶部操作：`Add all`、`Add selected`、`Remove selected from Library`、`Filter`、`Search`、`Show only cited`；多选范围为当前文件，不扩展到 Library 全库。
- 允许用户从多个 `.bib` 文件选条目复制到当前项目的 `reference.bib`；写入前检查 Key 冲突及目标文件的外部改动。

## 8. 删除语义及警告

必须明确区分以下动作：

1. `Remove from collection`：仅取消分类归属。
2. `Remove from Library`（BibTeX Preview 的 `−`）：从全局库解除该条目，**当前 `.bib` 文件条目保持不变**；如果其被项目链接，先建议 `Convert links to local copies` 或取消操作。
3. `Remove from current project`：解除该项目关联；若源码仍引用该 Key，先显示出现位置，默认不允许留下未解决引用。
4. `Delete entry from .bib file`：单独的显式文件编辑命令（不能复用 `−`），确认后删除对应源码范围；如果被引用，先展示影响并阻止意外删除。
5. `Delete globally`：仅在 Library 管理界面提供，支持回收站/软删除和恢复；受影响项目逐一列出。

| 等级 | 检查场景 | 表现与处理 |
|---|---|---|
| Error | `\cite` 的 Key 在当前配置参考文献集合中不存在；重复 Key 导致解析不确定 | 错误列表可跳转到源码；提供从 Library 添加、重命名或定位重复条目 |
| Warning | 将已被项目 Link 的条目从 Library 移除；项目文件和 Library 元数据分叉 | 删除前影响预览/差异对比；必要时转换成项目副本 |
| Warning | `.bib` 条目缺少必要字段、BibTeX 解析失败、生成文件和手工文件键冲突 | 定位到相应 BibTeX Preview 卡片及 Source 范围 |
| Info | 本项目尚未引用某条目、某文献尚未入库、Library 中存在疑似重复 | 提供筛选及批量管理，不自动删除 |

标记 `Not cited` 之前必须确保源码索引已完成且没有无法解析/外部生成的引用来源；未满足时展示 `Unknown` 而不是误报。

## 9. 性能、持久性与兼容要求

- 文件索引采用 `path + content hash/mtime` 缓存；文件保存后只更新受影响的 `.bib` 条目与 `.tex` 引用出现位置，项目配置或文件依赖发生变化时才重建相关部分。
- 大型 `.bib` Preview 虚拟列表 + 后台解析；主线程避免同步解析、成百上千张卡片同时渲染。
- SQLite 所有批量导入/移除使用事务；SQLite schema 版本迁移；失败可回滚。
- 文件写回用临时文件 + 原子替换（平台允许时），保留用户编码与换行约定；发生并发修改时弹出冲突处理，不覆盖。
- 每个操作提供 Undo 或可恢复快照；跨数据库与 `.bib` 文件的组合操作需有失败补偿策略。
- 尊重现有 LaTeX 工具链；不强制重命名 `reference.bib`，也不在没有用户同意时改变引用命令或项目的 BibTeX/Biber 配置。

## 10. 推荐开发顺序与验收

### Phase A：基础设施

实现 SQLite schema、Citation.js 解析适配层、`.bib` 原文区间映射、单文件导入、重复检测与基础 Library UI。

**验收：** 导入含普通条目、注释、字符串宏及一个损坏条目的 `.bib` 时，有效条目可选择入库，原文件完全不变，失败条目可定位。

### Phase B：BibTeX Preview（本版重点）

实现 `.bib` 文件 Source/Preview 切换、每条目独立卡片、GUI 与 Source 定位、右侧 `+ / −`、批量入库、差异状态与解析警告。

**验收：** 从一个已有项目的 `.bib` 打开 Preview，点 `+` 将单条加入 Library，再点 `−` 移出 Library；两个操作均不删除或重排原 `.bib` 内容。

### Phase C：项目关联与引用导航

实现项目级 Key 索引、跨文件 occurrences、`Cited/Unused/Partial` 状态及点击跳转；提供从 Library `Link` 或 `Copy` 到项目及 `\cite{}` 补全。

**验收：** 一条文献在两个 `.tex` 文件中被三次引用，卡片准确显示三个位置且逐一跳转；重复键和找不到的键都有可定位警告。

### Phase D：安全输出与回归测试

实现链接项目 `.bib` 的生成/缓存、复制到 `reference.bib`、可携带导出、冲突与删除保护、性能测试。

**验收：** 断开 Library 后，最近一次完整导出的项目仍能依靠本地 `.bib` 编译；大型参考文献文件切换 Preview 时界面可响应；GUI 修改一个条目不重排/损坏其他条目、注释或宏。

## 11. v0.4.3 的最终交付标准

用户既可以**直接导入一份 `.bib` 文件**，也可以**打开现有 `.bib`，将其作为一组可操作的文献信息卡来浏览**：一眼看到作者、标题、年份、Key、是否入库、是否被引用及所有引用位置；用右侧 `+ / −` 决定条目是否属于全局 Library，用跳转按钮打开其他文件中的引用现场。同时，全局 Library 可独立分类、打标签、搜索和复用；项目能按需链接或复制文献，并导出标准、独立可编译的 BibTeX 内容。
