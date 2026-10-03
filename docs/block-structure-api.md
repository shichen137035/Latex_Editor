# v0.5.3 文档块结构与 API

## 职责与兼容性

`.tex` 是正文唯一来源。`.texweave/structure.json` 保存结构、定位和元数据，不保存正文副本。结构的持久化形状为 `schemaVersion: 2`，使用 `files` / `blocks` 字典、`roots`、每个块的 `parentId` 与按源码顺序排列的 `childIds`。

现有关系接口继续使用原来的 `BlockGraphSnapshot` 数组 DTO；适配器负责读写新的持久化形状。旧版数组结构和 `.texweave/block-graph.json` 在首次结构查询时迁移，已有 ID、用户块和显式依赖关系保留。没有绑定源文件的旧关系节点保存在兼容字段 `unboundBlocks`。本次不新增自动关系推断。

- `packages/contracts/src/document-structure.ts`：持久化类型、轻量查询 DTO、统一结果及 API 合约。
- `packages/editor-core/src/preview/`：UI 无关的共享解析器、环境类型、标签处理与 reconciliation。Renderer 原路径只做重导出。
- `packages/editor-core/src/document-structure.ts`：能力推导、旧图适配和结构校验。
- `packages/editor-core/src/block-query-index.ts` / `source-index.ts`：元数据倒排索引及 UTF-16 行位置索引。
- `packages/application/src/document-structure-service.ts`：文件索引、查询、revision 校验及源码修改。
- `apps/desktop/src/main/ai/block-tools.ts`：两个 AI 提供方共用的工具 schema/dispatch。

## 块规则

`type`、`kind`、`origin` 相互独立。结构块通常是章节、定理、证明、列表或自定义容器；内容块通常是 paragraph、公式、图片、表格。正常公式、图片和表格的内部实现不拆成文档子块。

内容块有显式子块时允许保留，结果附带 `CONTENT_BLOCK_HAS_CHILDREN` warning，不强制展平。只有完全没有子块的结构块才生成 `origin: virtual`、`type: paragraph`、`placeholder: true` 的空占位；已有结构子块也算有内容。占位不写入 `.tex`，填写后以相同 ID 转为实际 paragraph；实际子块出现时移除空占位。空公式等内容块不额外生成 paragraph。

`source.range` 包含完整外壳，`bodyRange`（适用时）定位外壳内部。offset 为 UTF-16 半开区间，行/列从 1 开始。读取 API 默认不暴露 offset 或正文。能力由 `getBlockCapabilities()` 推导，特殊覆盖才写入 `capabilityOverrides`。

块源码/类型变化会推进 `revision`；仅前面插入文字造成位置移动，不自动推进未改内容块的 revision。`structureRevision` 和 `files[fileId].version` 分别描述结构索引和源文件版本。

`number` 来自已有 `.aux` 中对应 label 的编译编号，代表最后可用的编译结果；源码改动后应重新编译刷新。没有可靠编号时省略，绝不把同类型出现次数冒充排版编号。`ordinal` 独立表示同类型块在索引顺序中的出现次序。

可选 `semantic.summary` 标记来源和对应块 revision；`semantic.tags` 分开保存 user/ai 标签。内容更新时保留这些元数据，查询 DTO 用 `semanticStale` 提示陈旧。不会自动生成或覆盖用户摘要/标签。

## 公共接口

每次调用返回统一 envelope：

```ts
{ ok: true, data, warnings: [] }
// 或
{ ok: false, error: { code, message, expectedRevision?, currentRevision? } }
```

| 接口 | 用途 |
| --- | --- |
| `list_blocks` | 按父块、文件、kind、types、origin 列出轻量卡片；支持递归和 limit |
| `find_blocks` | 按标题/query、type、kind、label、number、ordinal、tags 等查找；元数据优先 |
| `get_block` | 父块摘要、直接子块卡片、位置、能力与当前 revision；不读正文 |
| `get_blocks` | 批量获取详情，最多 100 项 |
| `get_block_source` | 只返回 blockId、revision、content |
| `replace_block_content` | 以 expectedRevision 替换 Content Block 的精确源码 |
| `insert_block` | 在父块 start/end 或指定兄弟块 before/after 插入类型块 |
| `delete_block` | 删除完整子树，不是 unwrap；需要 expectedRevision |
| `set_block_semantic` | 设置可选摘要与独立的 user/ai 标签，不修改 `.tex` |

结构块不支持直接 `replace_block_content`，返回 `STRUCTURAL_BLOCK_HAS_NO_DIRECT_CONTENT`，应编辑其内容子块。环境内容的 source 包括 wrapper，替换时应保留 wrapper 和 label；不合法的类型改变/跨边界插入会在写入前拒绝。删除内容请使用 `delete_block`，不要用一个破坏 wrapper 的空字符串替换。

`insert_block.block.content` 是新块内部内容，服务根据环境配置生成外壳；章节标题使用可选 `block.title`。多文件项目在根位置插入时必须指定 `fileId`。插入到内容块内部仍合法，但会返回 warning。

写入被同一项目锁串行化。过期写入返回 `STALE_BLOCK`；重新读取并合并更新，不盲目重试旧源码。写入前还比较源文件，检测操作期间发生的外部改动。

桌面调用方式：

```ts
const api = window.latexEditor!.structure;
const found = await api.find_blocks(projectId, { type: "theorem", label: "thm:main" });
if (found.ok && found.data[0]) {
  const detail = await api.get_block(projectId, { blockId: found.data[0].id });
  // 先检查 detail.children，再只读取需要编辑的 paragraph。
}
```

直接后端调用：`ProjectDocumentStructureService.api(projectId)`；完整索引可通过服务或桌面 `structure.snapshot(projectId)` 获取。现有工作台编辑逻辑不必切换到新的写入接口。

## AI 工作流与性能

默认使用 `list/find → get → source → write`，不要先读取整篇论文。Codex dynamic tools 和 Copilot SDK tools 使用相同合约；工具修改与 shell 修改落在同一个工作副本，随后形成待审批 diff，不直接覆盖原项目。普通源码编辑产生的结构索引更新不会作为独立文件修改提交；摘要与标签通过 `set_block_semantic` 注入，结构元数据的差异需要用户手动审阅。明确需要时仍可直接修改 `.texweave/structure.json`，其他内部元数据不进入 AI 审阅。原来的 `texweave_compile` 继续开放，skill 指导使用项目配置的编译接口。

项目自带 skill 已同步上述流程；用户在设置中自定义的同名 skill 保持原覆盖规则，不强制覆盖用户的编辑。

性能措施包括：共享解析器、按源文件版本复用 AST/行索引、经过路径安全检查的文件版本 token 缓存、类型/标签/编号/tag 倒排索引、排序区间栈构建从属关系、稳定匹配的 label/fingerprint 索引、重复元数据查询不重读正文也不重写索引。正文搜索仅在元数据结果不足时处理内容范围。

## 验证

`tests/unit/document-structure.test.ts` 覆盖迁移、源范围、占位、内容叶节点、轻量 DTO、编译编号、revision 冲突、摘要陈旧、插入/删除、warning、并发、旧关系 undo/redo、错误写入无副作用和 1000 定理缓存查询。AI 测试覆盖工具读取以及修改进入待审批 source diff。

这些 AI 测试使用本地模拟提供方，不需要登录，也不声称验证真实模型的回答质量。桌面 IPC 冒烟检查：`npm run desktop:test-structure`。
