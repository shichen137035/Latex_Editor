# TeXWeave v0.6.1  
## Preview Rendering Optimization

### 1. 更新目标

v0.6.1 主要优化 Visual Preview 的渲染性能。

当前 Preview 已经具备：

- LaTeX 源码解析
- Block Tree
- Source Range
- KaTeX 数学公式渲染
- 图片 / 表格 / 列表 / 代码块等专用 Renderer
- `memo`
- `useMemo`
- 首屏节点数量限制

但目前仍存在几个主要性能瓶颈：

1. Preview Node 接收完整源码，导致源码发生任意变化时大量节点重新渲染。
2. 首屏 900 节点机制只限制初始 DOM 数量，不是真正的 Virtualization。
3. 加载更多后 DOM 只增不减，大型文档仍会持续变慢。
4. 节点 ID 若与源码位置高度绑定，前方编辑可能导致后续节点失去 React Identity。
5. 数学公式等复杂内容虽然使用 `memo`，但仍可能重复进行实际渲染。
6. 搜索、Relation、Filter 状态容易传播到大量 Preview Node。

v0.6.1 的核心原则：

> **只渲染当前需要显示的 Block，只重新渲染真正发生变化的 Block。**

---

# 2. 总体架构

Preview 渲染流程调整为：

```text
PreviewDocument
      │
      ▼
Stable Block Tree
      │
      ▼
Render Index
      │
      ├── Search State
      ├── Relation State
      ├── Filter State
      └── Selection State
      │
      ▼
Virtualized Preview
      │
      ▼
Visible Blocks
      │
      ├── Text Renderer
      ├── Math Renderer
      ├── Figure Renderer
      ├── Table Renderer
      └── Custom Block Renderer
```

其中：

- `PreviewDocument` 描述整个文档；
- `Render Index` 描述当前应该显示哪些 Block；
- Virtualized Renderer 只负责当前视口；
- 各 Block 只接收自身渲染所需要的数据。

---

# 3. Preview Node 去除 Full Source Dependency

## 3.1 当前问题

当前部分节点 Renderer 需要接收完整源码：

```tsx
<PreviewNode
    node={node}
    source={source}
/>
```

因此只要源码发生任意修改：

```text
source A
↓
source B
```

即使一个 Block 内容完全没有改变，其 `source` prop 仍然发生变化。

这会导致：

```text
Source Change
    ↓
大量 PreviewNode Props Change
    ↓
React.memo 失效
    ↓
大量节点重新执行 Render
```

---

## 3.2 新方案

Renderer 不再直接读取完整源码。

解析阶段或 PreviewDocument 构建阶段应提供节点自身所需内容：

```ts
interface PreviewNode {
    id: string;
    type: PreviewNodeType;

    sourceRange: SourceRange;

    content: string;
    contentHash: string;

    children: PreviewNode[];
}
```

Renderer：

```tsx
<PreviewNode node={node} />
```

而不是：

```tsx
<PreviewNode
    node={node}
    source={fullSource}
/>
```

需要源码范围的编辑、跳转等功能仍使用：

```ts
node.sourceRange
```

---

# 4. Stable Node Identity

## 4.1 问题

如果 Node ID 直接由源码 offset 生成，例如：

```ts
id = `${start}:${end}`;
```

那么在文档开头插入一个字符后：

```text
所有后续节点 offset 改变
↓
所有 ID 改变
↓
React 将其视为全新组件
```

这会直接破坏：

- `memo`
- selection state
- block focus
- relation focus
- scroll tracking
- local component state

---

## 4.2 Stable ID

节点应拥有尽可能稳定的逻辑身份：

```ts
PreviewNode {
    id: StableNodeId;
    ...
}
```

ID 不应单纯依赖：

```text
source offset
```

可以综合：

```text
Node Type
Parent Identity
Label
Structural Position
Content Signature
```

建立节点匹配。

例如：

```ts
matchNode(oldNode, newNode)
```

如果确认两者是同一个逻辑 Block：

```ts
newNode.id = oldNode.id;
```

---

## 4.3 推荐匹配优先级

优先：

```text
label / explicit block id
```

其次：

```text
parent + type + local order
```

再次：

```text
content / structure signature
```

源码位置只作为辅助信息。

---

# 5. Structural Reuse

解析完成后，不直接用新的 Node Tree 完全替换旧 Tree。

增加：

```ts
reusePreviewTree(oldTree, newTree)
```

如果节点满足：

```ts
oldNode.type === newNode.type
oldNode.contentHash === newNode.contentHash
oldNode.structureHash === newNode.structureHash
```

则直接复用旧节点对象：

```ts
return oldNode;
```

例如用户只修改：

```text
Section 4 / Paragraph 2
```

最终：

```text
Section 1 → old object
Section 2 → old object
Section 3 → old object
Section 4
    Paragraph 1 → old object
    Paragraph 2 → new object
Section 5 → old object
```

这样 React 的引用比较可以真正发挥作用。

---

# 6. Render Index

Preview 数据仍保持树结构：

```text
Section
 ├─ Paragraph
 ├─ Theorem
 │   └─ Equation
 └─ Subsection
```

但 Renderer 不直接递归整个 Tree。

新增：

```ts
RenderItem[]
```

例如：

```ts
interface RenderItem {
    id: string;
    nodeId: string;

    depth: number;
    parentId?: string;

    estimatedHeight?: number;
}
```

示例：

```text
section-1       depth 0
paragraph-1     depth 1
theorem-1       depth 1
equation-1      depth 2
subsection-1    depth 1
```

注意：

> Block Tree 仍然是 Preview 的真实数据结构。

Render Index 只是显示层索引。

---

# 7. Preview Virtualization

## 7.1 替换现有 900 Node Loading

当前：

```text
900 nodes
↓
Load More
↓
1800 nodes
↓
Load More
↓
2700 nodes
```

v0.6.1 改为真正的窗口化：

```text
Top Spacer

Block 315
Block 316
Block 317
Block 318
Block 319

Bottom Spacer
```

当前视口外的 Block：

```text
Unmount
```

---

## 7.2 Overscan

为了避免滚动时频繁 Mount / Unmount：

```text
Visible Range
+
前后 Overscan
```

建议初始：

```text
约 5～15 个 Block
```

具体值根据性能测试调整。

---

# 8. Dynamic Height Cache

LaTeX Block 高度并不固定。

例如：

```text
Paragraph      60 px
Theorem        220 px
Large Table    900 px
Figure         500 px
```

因此需要记录：

```ts
Map<NodeId, number>
```

例如：

```ts
blockHeightCache.get(nodeId)
```

初次未渲染时使用：

```text
estimated height
```

实际 Mount 后通过：

```text
ResizeObserver
```

更新真实高度。

---

# 9. Scroll Position Stability

Virtualization 必须保证滚动不会跳动。

尤其在：

```text
上方 Block 高度更新
```

时，不应导致用户正在阅读的位置突然移动。

因此 Renderer 需要维护：

```text
Anchor Block
+
Anchor Offset
```

布局更新后重新补偿 scrollTop。

---

# 10. Jump / Search / Relation 定位

虚拟化后，目标 Block 很可能尚未 Mount。

因此：

```text
jumpToNode(id)
```

不能继续依赖：

```text
document.querySelector(...)
```

新的逻辑：

```text
Node ID
↓
Render Index
↓
Target Index
↓
Virtual List scrollTo
↓
Mount Block
↓
精确定位
```

适用于：

- Search result
- Citation jump
- Label jump
- Relation jump
- Outline
- Error navigation
- Source → Preview synchronization

---

# 11. Search / Filter / Relation 与 Renderer 解耦

不再通过重新构造 Block Tree 来表达筛选结果。

新增：

```ts
VisibilityIndex
```

例如：

```ts
Map<NodeId, VisibilityState>
```

其中：

```ts
type VisibilityState =
    | "visible"
    | "dimmed"
    | "hidden";
```

Renderer 根据状态决定：

```text
显示
淡化
隐藏
```

而 PreviewDocument 保持不变。

---

# 12. Selection State 局部订阅

避免：

```tsx
<PreviewPane selectedBlockId={selectedBlockId}>
```

导致所有子节点重新计算。

节点应只订阅：

```text
自己是否 selected
自己是否 relation focused
自己是否 search matched
```

例如：

```ts
const selected = usePreviewStore(
    state => state.selectedBlockId === nodeId
);
```

而不是：

```ts
usePreviewStore(state => state);
```

---

# 13. PreviewNode Memo Strategy

每个节点 Renderer 使用稳定 Props：

```tsx
const PreviewNode = memo(...)
```

主要 Props：

```text
node
visibility
selection
render configuration
```

应避免传入：

```text
full source
entire search state
entire relation state
entire preview tree
global diagnostics
```

---

# 14. Math Rendering Cache

新增数学渲染缓存：

```ts
MathRenderCache
```

Key：

```text
expression
+
displayMode
+
macroVersion
+
renderOptions
```

例如：

```ts
const key = hash(
    latex,
    displayMode,
    macroVersion
);
```

如果缓存命中：

```text
直接复用 Render Result
```

而不是重新执行 KaTeX。

---

# 15. Math Macro Version

由于宏可能影响公式含义：

```latex
\newcommand{\R}{\mathbb{R}}
```

因此宏配置发生变化时：

```ts
macroVersion++
```

对应旧的数学缓存自动失效。

避免产生：

```text
旧宏
+
新文档
```

的不一致状态。

---

# 16. Heavy Block Lazy Rendering

对于特别昂贵的 Block，例如：

```text
复杂表格
大型图片
代码高亮
Diagram
长公式
```

采用：

```text
Visible
    ↓
完整 Renderer
```

离开视口后：

```text
轻量 Placeholder
```

或者：

```text
Unmount + Height Cache
```

---

# 17. Image Lazy Loading

Preview 中图片默认：

```text
接近 viewport
↓
加载实际资源
```

远距离 Block 不提前：

```text
decode image
创建大型 DOM
执行尺寸计算
```

图片 Block 仍保留：

```text
width / height estimate
```

防止布局剧烈跳动。

---

# 18. Large Table Handling

对于大型表格：

```text
Table Block
```

整体作为一个 Virtual Block。

不对整个 Preview 做 cell 级 Virtualization。

如果未来确实出现数千行表格，再单独考虑 Table Renderer 内部虚拟化。

v0.6.1 不做这一层复杂化。

---

# 19. Progressive Mount

Preview 第一次打开时：

```text
Preview Shell
↓
当前 viewport blocks
↓
near viewport blocks
↓
其他索引初始化
```

而不是等待所有渲染相关工作结束后再整体出现。

目标是：

> 优先保证 Time to First Preview。

---

# 20. Performance Diagnostics

开发模式新增 Preview 性能统计。

建议包括：

```text
Parse Time
Render Index Build Time
Visible Block Count
Mounted Block Count
React Render Time
KaTeX Render Count
Math Cache Hit Rate
Height Cache Hit Rate
```

可通过 Developer Panel 查看。

---

# 21. Performance Warning

开发模式下，如果出现：

```text
Mounted Preview Blocks > threshold
```

或：

```text
Single Block Render > threshold
```

可以输出：

```text
Preview Performance Warning
```

帮助后续发现：

- 特殊 Renderer 性能异常
- memo 失效
- 意外重复渲染

---

# 22. 推荐模块结构

建议 Preview 模块逐步整理为：

```text
preview/
├── parser/
│
├── model/
│   ├── PreviewDocument.ts
│   ├── PreviewNode.ts
│   └── NodeIdentity.ts
│
├── index/
│   ├── RenderIndex.ts
│   ├── VisibilityIndex.ts
│   └── HeightIndex.ts
│
├── virtualization/
│   ├── VirtualPreview.tsx
│   ├── useVirtualBlocks.ts
│   └── ScrollAnchor.ts
│
├── renderers/
│   ├── PreviewNode.tsx
│   ├── MathRenderer.tsx
│   ├── FigureRenderer.tsx
│   ├── TableRenderer.tsx
│   └── ...
│
└── performance/
    ├── MathRenderCache.ts
    └── PreviewProfiler.ts
```

不要求 v0.6.1 一次完成目录重构。

以逐步迁移为主。

---

# 23. 性能目标

建议以真实论文测试。

## 普通论文

约：

```text
20–40 pages
```

目标：

```text
Preview 打开后快速显示首屏
滚动稳定接近 60 FPS
普通 selection 无明显延迟
```

---

## 大型论文

约：

```text
100+ pages
1000+ Preview Nodes
```

目标：

```text
Mounted Blocks 始终维持较低数量
DOM 数量不随“浏览过的内容”持续增长
```

---

## 编辑

修改单个普通 Block：

```text
目标：
只有对应 Block 和必要父节点更新
```

不应：

```text
重新 Render 所有已显示节点
```

---

# 24. Compatibility

v0.6.1 不改变：

- LaTeX 源码格式
- Preview Block 定义
- Source Range API
- Relation API
- Filter API
- Search API
- User Project Format

主要属于：

```text
internal rendering optimization
```

因此无需项目 migration。

---

# 25. 风险

## Virtualization + Nested Block

这是本版本最大的技术风险。

必须避免因为扁平化 Render Index 而破坏：

```text
Parent / Child
Section Hierarchy
Relation Hierarchy
Block Selection
```

因此：

> Flat Render Index 只能存在于 View Layer。

真实数据结构保持 Tree。

---

## Dynamic Height

图片、公式、表格加载后可能改变高度。

必须依赖：

```text
ResizeObserver
+
Height Cache
+
Scroll Anchor
```

防止滚动跳动。

---

## Node Matching

Stable Node Identity 不需要追求百分之百完美。

匹配失败时：

```text
允许生成新的 Node ID
```

正确性优先于复用率。

---

# 26. 不属于 v0.6.1

以下内容暂不纳入：

```text
真正的 Incremental LaTeX Parser
Parser Worker
字符级 AST 增量更新
复杂多线程 Preview Pipeline
Table Cell Virtualization
GPU Rendering
```

这些可以根据 v0.6.1 profiling 结果决定是否进入后续版本。

---

# 27. 实施顺序

建议：

```text
Phase 1
去除 Full Source Props
↓
Stable Node Identity
↓
Structural Reuse

Phase 2
Render Index
↓
Preview Virtualization
↓
Dynamic Height Cache

Phase 3
Search / Relation / Jump 适配
↓
Selection 局部订阅
↓
Math Cache
↓
Image Lazy Loading

Phase 4
Performance Profiling
↓
Regression Tests
```

---

# 28. Regression Tests

至少测试以下情况：

### 基本渲染

```text
短文档
长文档
深层 section
大量 theorem
大量 equation
```

### 滚动

```text
快速滚动
拖动 scrollbar
滚动到文档末尾
向上快速返回
```

### 跳转

```text
Source → Preview
Preview → Source
Search → Block
Relation → Block
Label → Block
```

### 修改

```text
顶部修改
中间修改
尾部修改
插入 Block
删除 Block
移动 Block
```

重点检查：

```text
scroll position
selection
focus
node identity
```

是否保持稳定。

### Filter

```text
普通筛选
Relation 筛选
Search 筛选
多筛选组合
Dim Mode
Hide Mode
```

### 数学

```text
大量 inline math
大量 display math
自定义 macro
修改 macro
极长公式
```

---

# 29. 完成标准

v0.6.1 可视为完成，当：

- Preview Node 不再依赖完整源码 Props；
- 大部分未变化节点能保持对象引用；
- Node ID 在普通源码编辑后保持稳定；
- Preview 使用真正的 viewport virtualization；
- 浏览文档不会导致 DOM 数量无限增长；
- Search / Relation / Jump 能正确定位未 Mount 节点；
- 数学渲染具备有效 Cache；
- Selection / Relation 状态不会导致整个 Preview 重渲染；
- 大型论文滚动与编辑性能相比 v0.6.0 有明显改善。

---

# v0.6.1 核心原则

```text
Stable Data
    ↓
Stable Identity
    ↓
Minimal Re-render
    ↓
Viewport-only DOM
```

或者更简单地概括：

> **Keep the document large, keep the DOM small.**