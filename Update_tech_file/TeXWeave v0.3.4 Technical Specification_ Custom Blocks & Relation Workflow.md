# TeXWeave v0.3.4 Technical Specification

## Custom Blocks & Relation Workflow

**Version:** v0.3.4  
**Scope:** Block creation, relation editing, relation filtering, relation inspection, relation graph navigation  
**Status:** Development specification

---

# 1. Overview

v0.3.4 的核心目标，是将此前已有的 Block 与 Relation 数据结构真正转化为一个可操作的交互系统。

本版本重点完成四个模块：

1. **Custom Block System**
   - 用户可以手动创建和删除自建块。
   - 自建块必须服从现有 Block containment 结构。

2. **Relation Selection Mode**
   - 用户可以围绕某个 Block 筛选、浏览、添加和删除关系。
   - 左侧结构树、Preview 与右侧 Relation Inspector 共享统一状态。

3. **Relation Inspector**
   - 未选择 Block 时显示全文关系的总体入口。
   - 选择 Block 后显示该 Block 的局部关系信息。

4. **Relation Graph View**
   - 支持全文关系图。
   - 支持以某个 Block 为中心的局部关系图。
   - 支持前提 / 推论 / 双向观察、关系深度以及 focus 切换。

v0.3.4 不以增加复杂关系类型为主要目标。

本版本首先建立一套稳定的：

```text
Block
    ↕
Relation
    ↕
Document
    ↕
Relation Graph
```

统一交互框架。

---

# 2. Core Architectural Principle

整个关系系统必须严格区分三层：

```text
Semantic Graph
      ↓
Display Graph
      ↓
Layout Graph
```

## 2.1 Semantic Graph

Semantic Graph 保存用户真正创建的 Block 与 Relation。

它是项目数据的唯一事实来源。

任何：

- 筛选
- 淡化
- collapse
- projection
- relation depth
- graph simplification
- ELK dummy node

都不得修改 Semantic Graph。

---

## 2.2 Display Graph

Display Graph 根据当前 UI 状态，从 Semantic Graph 中计算：

- 当前需要显示哪些 Block
- 当前需要显示哪些 Relation
- 哪些元素应淡化
- 当前 focus 是谁
- 当前 relation depth
- 当前 direction

它是临时状态。

---

## 2.3 Layout Graph

Layout Graph 是交给 ELK.js 的临时图。

例如：

```text
Semantic Graph
    ↓
filter
    ↓
focus neighborhood
    ↓
optional simplification
    ↓
ELK Layout Graph
```

ELK 产生：

- node position
- node rank
- edge route
- bend points

这些信息不能反向修改 Semantic Graph。

---

# 3. Block Model

所有 Block 共享统一基础数据结构。

推荐：

```ts
interface Block {
  id: BlockId

  origin:
    | "environment"
    | "virtual"
    | "user"

  role: BlockRole

  fileId: FileId

  range: {
    start: number
    end: number
  }

  label?: string
  name?: string

  parentId?: BlockId
  childIds: BlockId[]

  capabilities: {
    connectable: boolean
    deletable: boolean
    renameable: boolean
    retypable: boolean
  }
}
```

必须将：

```text
origin
```

和：

```text
role
```

分开。

例如：

```text
origin = environment
role   = theorem
```

以及：

```text
origin = user
role   = theorem
```

在逻辑角色上都属于 theorem。

---

# 4. Three Block Origins

## 4.1 Environment Block

Environment Block 由 LaTeX parser 根据正式环境自动产生。

例如：

```latex
\begin{theorem}
...
\end{theorem}
```

对应：

```text
origin = environment
role   = theorem
```

### 生命周期

Environment Block 由源码驱动。

用户不能执行：

```text
Delete Block
```

而保留原本的 theorem 环境。

如果环境从源码中消失，则对应 Block 才消失。

推荐：

```ts
capabilities = {
  connectable: true,
  deletable: false,
  renameable: limited,
  retypable: false
}
```

---

# 4.2 Virtual Block

Virtual Block 表示逻辑上存在的文本结构，但不作为正式 Relation endpoint。

最典型的是普通文本段落。

例如：

```text
Section 2
    Paragraph
    Paragraph
    Theorem
```

其中 paragraph 可以被解析成 Virtual Block。

推荐：

```ts
capabilities = {
  connectable: false,
  deletable: false,
  renameable: false,
  retypable: false
}
```

Virtual Block：

- 参与 containment
- 参与正文导航
- 参与左侧层级显示
- 可以用于定位 Preview
- 可以作为筛选上下文

但：

```text
不能作为 relation source
不能作为 relation target
```

Virtual Block 默认不进入 Relation Graph。

---

# 4.3 User Block

User Block 由用户手动选择源码区域创建。

例如用户可以将：

```text
若干段落
+
一个完整 Lemma
+
一个完整 Remark
```

组合为一个新的自定义 Block。

User Block：

```ts
capabilities = {
  connectable: true,
  deletable: true,
  renameable: true,
  retypable: true
}
```

用户可以定义：

```text
Name
Role
Label
```

Role 可以复用系统已有类型，例如：

```text
Definition
Lemma
Theorem
Assumption
Remark
Background
Argument
Method
Result
Custom
```

User Block 与 Environment Block 在 Relation 层面应尽量保持一致。

它们主要区别在于生命周期。

---

# 5. Block Containment Invariant

Block containment 必须满足 **laminar structure**。

设 Block 对应源码区间：

\[
I(B)=[s_B,e_B].
\]

任意两个 Block \(A,B\) 必须满足：

\[
I(A)\cap I(B)=\varnothing
\]

或者：

\[
I(A)\subseteq I(B)
\]

或者：

\[
I(B)\subseteq I(A).
\]

禁止 partial overlap：

```text
A: [---------------]
B:         [---------------]
```

即禁止：

\[
s_A<s_B<e_A<e_B
\]

以及对称情况。

因此全部 Block 天然构成 containment forest。

---

# 6. User Block Creation

用户选择：

\[
[s,e]
\]

创建 User Block 时，必须对所有现有 Block 检查 overlap。

伪代码：

```ts
function canCreateUserBlock(range, blocks) {
  for (const block of blocks) {
    if (partiallyOverlaps(range, block.range)) {
      return false
    }
  }

  return true
}
```

合法情况：

```text
完全分离

A: [------]

B:             [------]
```

或：

```text
完整包含

A: [------------------------]
B:       [----------]
```

禁止：

```text
部分交叉

A: [-------------]
B:        [-------------]
```

---

# 6.1 Virtual Block 同样参与边界检查

Virtual Block 虽然不可连接，但它仍然是真实 containment node。

因此 User Block 不应部分截断一个 Virtual Paragraph。

例如：

```text
Paragraph:
[------------------------]
```

用户不能只选：

```text
        [---------]
```

创建 User Block。

如果需要包含该 paragraph，则必须完整包含。

这样才能保证整个 Block family 始终保持 laminar。

---

# 6.2 Parent Calculation

创建成功后：

\[
parent(B)
=
\min_{\subset}
\{A:B\subset A\}.
\]

即寻找完整包含新 Block 的最小 Block。

同时重新计算其直接 children。

---

# 6.3 User Block 删除

删除 User Block 时：

- 不删除其源码内容。
- 不删除内部 Environment / Virtual / User children。
- children 自动重新挂到被删除 Block 的 parent。
- 所有直接以该 User Block 为 endpoint 的 relation 同时删除。

Block 删除与 Relation 删除必须成为一个原子 transaction：

```text
DeleteUserBlockTransaction
```

Undo 时必须完整恢复：

```text
Block
+
Containment
+
Relations
```

---

# 7. Stable Block Identity

这是实现中必须特别注意的问题。

**禁止直接使用 source offset 或 line number 作为 Block ID。**

例如：

```text
blockId = "main.tex:1452"
```

是不可接受的。

因为用户在前面插入一行文字后，所有 offset 都会变化。

这会导致：

```text
Relation endpoint lost
```

---

## 7.1 Block ID

所有可连接 Block 必须拥有稳定：

```ts
BlockId
```

推荐使用 UUID。

例如：

```text
blk_8fd2...
```

Environment Block 与 User Block 的 Relation 永远引用 BlockId，而不是当前位置。

---

## 7.2 Environment Block Reconciliation

Environment Block 每次重新解析后需要进行身份匹配。

建议优先级：

```text
1. persistent internal BlockId binding
2. unique LaTeX label
3. environment type + nearby text fingerprint
4. AST / sibling position
5. unresolved
```

不能简单使用：

```text
label == BlockId
```

因为用户可能修改 label。

---

## 7.3 User Block Range Tracking

User Block 的 UUID 永久不变。

编辑器运行期间应通过 editor transaction mapping 更新：

```text
start
end
```

而不是在每次输入后重新寻找字符串。

项目重新打开时，可以使用：

```text
stored range
+
nearby content anchor
+
context hash
```

进行恢复。

---

# 7.4 Orphaned Blocks / Relations

如果 Environment Block 因源码修改无法重新识别，不应立即永久删除 Relation。

应将相关 Relation 标记为：

```text
orphaned
```

并显示 warning。

例如：

```text
⚠ Relation endpoint cannot be resolved:
thm:old-consistency
```

这样避免因为 parser reconciliation 失败导致用户数据静默丢失。

---

# 8. Relation Data Model

v0.3.4 首先支持基础 directed logical relation。

推荐：

```ts
interface RelationEdge {
  id: RelationId

  sourceId: BlockId
  targetId: BlockId

  kind: "logical"

  createdAt?: number
}
```

方向定义统一为：

\[
source\rightarrow target
\]

表示：

> source 是 target 的逻辑前提。

因此：

```text
A → B
```

含义是：

```text
A is a prerequisite of B
B is a consequence / dependent of A
```

UI 可以使用不同描述，但底层只保存一种方向。

---

# 9. Relation Validation

所有 Relation 创建都必须经过统一：

```ts
RelationValidator
```

禁止 Preview、左侧列表、Graph View 各自实现不同检查。

推荐返回：

```ts
type RelationValidation =
  | { status: "valid" }
  | { status: "warning"; reason: string }
  | { status: "invalid"; reason: string }
```

---

# 9.1 Hard Invalid Relations

以下情况禁止创建。

### Self-loop

禁止：

\[
A\rightarrow A.
\]

---

### Virtual endpoint

如果：

```text
source.connectable == false
```

或者：

```text
target.connectable == false
```

则非法。

---

### Bidirectional relation

如果已经存在：

\[
A\rightarrow B
\]

则禁止：

\[
B\rightarrow A.
\]

系统明确不支持双向 logical edge。

---

### Duplicate relation

已经存在：

\[
A\rightarrow B
\]

再次创建同一 Relation 应视作：

```text
no-op
```

而不是新建重复 edge。

---

# 9.2 Cycle

Relation Graph 原则上应该是 DAG。

但是 v0.3.4 不强制拒绝 cycle。

如果：

\[
A\rightarrow B
\]

的加入使得：

\[
B\leadsto A,
\]

则：

```text
status = warning
```

UI 应显示：

```text
⚠ This relation creates a logical cycle.
```

Relation 仍然可以保存。

未来可增加：

```text
cyclePolicy:
  warn
  forbid
  ignore
```

v0.3.4 默认：

```text
warn
```

---

# 9.3 Containment 不参与 Logical Cycle Detection

这一点必须严格规定。

Containment：

```text
Parent contains Child
```

不是 Logical Edge。

因此 cycle detection 只在：

\[
G_L=(V,E_L)
\]

上执行。

不能把：

```text
Parent → Child containment
```

当成逻辑箭头。

否则任何 parent-child logical relation 都可能产生伪 cycle。

---

# 10. Ancestor / Descendant Relation Semantics

父块与子块之间允许建立 logical relation。

例如：

```text
Lemma A → Section 3
```

或者：

```text
Section 3 → Theorem B
```

都允许。

但是必须使用 **self-excluding semantics**。

---

## 10.1 Descendant → Ancestor

若：

\[
u\rightarrow p
\]

且：

\[
u\in descendants(p),
\]

其语义不是：

\[
u\rightarrow u.
\]

而是：

\[
u
\rightarrow
contents(p)\setminus subtree(u).
\]

即：

> u 是其父容器中除自身 subtree 以外部分内容的前提。

---

## 10.2 Ancestor → Descendant

若：

\[
p\rightarrow u
\]

且：

\[
u\in descendants(p),
\]

解释为：

\[
contents(p)\setminus subtree(u)
\rightarrow u.
\]

即：

> 父容器中除 u 自身 subtree 以外的相关内容，是 u 的前提。

---

# 10.3 不实际展开 Edge

以上语义仅用于解释和 validation。

**禁止将：**

```text
Section 3 → Theorem D
```

实际展开为：

```text
Definition A → Theorem D
Lemma B      → Theorem D
Remark C     → Theorem D
```

Semantic Graph 中仍然只保存一条 edge。

否则：

- 删除关系困难
- Undo 困难
- Relation Graph 边数量爆炸
- 用户无法知道哪些边是显式创建、哪些是系统推导

因此：

```text
aggregate semantics
```

必须保持为逻辑解释，而不是物理 edge expansion。

---

# 10.4 当前限制

v0.3.4 暂不尝试判断：

```text
Relation to container
```

究竟指：

```text
container 本身
```

还是：

```text
container 中某个无法直接连接的 Virtual Block
```

当前统一视作 coarse relation。

未来可以增加：

```ts
scope:
  "block"
  "container"
  "subtree"
```

但不属于 v0.3.4。

---

# 11. Relation Selection Mode

Relation Selection Mode 是 v0.3.4 的主要新交互模式。

基本流程：

```text
Normal Mode
    ↓
Select Block
    ↓
Enter Relation Mode
    ↓
Filter / Browse Blocks
    ↓
Add / Remove Relations
    ↓
Switch Focus
    ↓
Back / Exit
```

---

# 12. Relation UI State

推荐独立维护：

```ts
interface RelationUIState {
  relationModeActive: boolean

  focusBlockId: BlockId | null

  direction:
    | "prerequisite"
    | "consequence"
    | "both"

  relationDepth:
    | number
    | "all"

  hierarchyScope:
    | "all"
    | "same-parent"
    | "ancestors"
    | "descendants"
    | "same-section"

  unmatchedBehavior:
    | "dim"
    | "hide"

  filters: {
    roles: BlockRole[]
    labels: string[]
    origin?: BlockOrigin[]
    textQuery?: string
  }

  focusHistory: BlockId[]

  expandedBlocks: Set<BlockId>
}
```

---

# 13. Do Not Mix Two Different "Depths"

这里必须区分两个完全不同的概念。

## Relation Depth

Relation Graph 中距离 focus 的 hop 数。

例如：

```text
Definition → Lemma → Theorem → Corollary
```

focus 为 Theorem。

Depth 1：

```text
Lemma → Theorem → Corollary
```

Depth 2：

```text
Definition → Lemma → Theorem → Corollary
```

---

## Hierarchy Scope

表示 containment tree 上的范围。

例如：

```text
Same parent
Ancestors
Descendants
Same section
All
```

Relation depth 与 hierarchy scope 禁止共用同一个字段。

---

# 14. Left Relation Panel

进入 Relation Mode 后，左侧显示临时 Block browser。

基本结构：

```text
← Back

Focus
Theorem 4.2

Direction
[Prerequisite] [Both] [Consequence]

Hierarchy
[All ▼]

Type
[All ▼]

Label
[All ▼]

Unmatched
[Dim ▼]

Search...

────────────────

Section 1
  ▾ Definition 1.1
      Paragraph
  ▸ Lemma 1.2

Section 2
  ▾ Theorem 2.1
      Proof
```

---

# 15. Candidate Ordering

候选 Block 永远优先按照：

\[
documentOrder
\]

排列。

禁止默认按照：

- graph rank
- search relevance
- relation strength
- alphabetical order

重新排序。

用户在论文中主要依赖空间和正文顺序定位内容。

Search 只改变：

```text
match state
```

而不改变正文顺序。

---

# 16. Hierarchical Display

Containment 使用缩进表达。

例如：

```text
Section 2
  Subsection 2.1
    Definition
    Lemma
      Proof
```

v0.3.4 暂不在左侧画 containment edges。

---

# 17. Expand / Collapse

Block row 需要将：

```text
Expand
```

与：

```text
Select / Focus
```

分离。

例如：

```text
[▾] [Theorem 2.1] [◎] [+]
```

其中：

```text
▾
```

只负责展开 / 收起 children。

点击 Block name：

```text
Theorem 2.1
```

负责将该 Block 设置为当前 focus。

禁止使用同一个点击区域同时：

```text
collapse + focus
```

否则会产生大量误操作。

---

# 18. Filter Context Preservation

假设：

```text
Section 1
  Subsection 1.1
    Definition
    Lemma
```

Filter：

```text
Type = Lemma
```

不能只显示：

```text
Lemma
```

而应该显示：

```text
Section 1
  Subsection 1.1
    Lemma
```

因此：

\[
V_{visible}
=
V_{match}
\cup
Ancestors(V_{match}).
\]

Ancestor 可以：

```text
muted
```

显示。

---

# 19. Filter Auto Expansion

如果一个匹配节点位于 collapsed parent 内部，Filter 应临时展开其 ancestor path。

但不能永久修改用户的手动 collapse 状态。

因此应区分：

```ts
manualExpanded
```

和：

```ts
autoExpandedByFilter
```

最终：

\[
effectiveExpanded
=
manualExpanded
\cup
autoExpandedByFilter.
\]

Filter 清除后：

```text
autoExpandedByFilter
```

清空。

用户原来的 collapse 状态恢复。

---

# 20. Dim / Hide

筛选后的非匹配元素支持：

```text
Dim
```

或：

```text
Hide
```

## Dim

保持原正文结构：

```text
Section
  Definition      20%
  Lemma           100%
  Remark          20%
```

默认推荐：

```text
Dim
```

因为关系编辑过程中保持空间上下文很重要。

---

## Hide

非匹配节点完全隐藏。

但是必要 ancestor context 仍然需要保留。

---

# 21. Preview Navigation Button

左侧每个 Block 提供单独定位按钮：

```text
◎
```

点击：

```ts
Preview.scrollTo(blockId)
```

同时：

- Preview 滚动到 Block
- Block 短暂高亮
- 不改变当前 Relation focus
- 不建立 Relation

这一操作属于导航，不属于 relation mutation。

---

# 22. Preview Relation Controls

Relation Mode 开启后，可连接 Block 的 Preview header 右上角显示 Relation controls。

例如：

```text
┌─────────────────────────────┐
│ Theorem 3.2        [◎] [+] │
├─────────────────────────────┤
│ ...                         │
└─────────────────────────────┘
```

其中：

```text
◎
```

表示：

```text
Set as Relation Focus
```

而：

```text
+
```

表示：

```text
Add Relation
```

如果当前 Relation 已存在：

```text
-
```

表示：

```text
Remove Relation
```

---

# 23. Relation Direction

如果：

```text
direction = prerequisite
```

focus 为 \(A\)，点击 B 的：

```text
+
```

创建：

\[
B\rightarrow A.
\]

如果：

```text
direction = consequence
```

则创建：

\[
A\rightarrow B.
\]

---

# 24. Both Mode

Both 模式存在一个方向歧义问题。

如果当前：

```text
direction = both
```

那么一个普通：

```text
+
```

无法知道应该创建：

\[
A\rightarrow B
\]

还是：

\[
B\rightarrow A.
\]

因此 v0.3.4 规定：

### 已有关系

可以直接显示：

```text
← -
```

或者：

```text
→ -
```

表示其方向并允许删除。

### 未建立关系

点击：

```text
+
```

弹出一个极小的 direction chooser：

```text
Add as prerequisite
Add as consequence
```

禁止系统自动猜方向。

---

# 25. Illegal Relation Controls

所有 Preview / Left Panel / Graph View 的添加按钮必须调用同一个：

```ts
RelationValidator
```

状态：

```text
valid
warning
invalid
```

例如：

```text
[+] normal
```

表示合法。

```text
[+] warning
```

表示可能产生 cycle。

```text
[+] disabled
```

表示：

- Virtual Block
- self-loop
- bidirectional edge
- endpoint invalid

Hover 可以显示原因。

---

# 26. Focus Switching

点击左侧 Block 名称或 Preview 中：

```text
◎
```

都会：

```ts
setRelationFocus(blockId)
```

这两个入口必须完全等价。

切换 focus 后：

- 左侧 candidate 状态重新计算
- Preview +/- 状态重新计算
- Relation Inspector 更新
- Relation Graph 更新
- 当前 filter 配置尽量保留

---

# 27. Focus History

Relation focus 切换维护独立：

```ts
focusHistory
```

例如：

```text
Theorem 4.2
    ↓
Lemma 3.1
    ↓
Definition 2.4
```

点击：

```text
Back
```

恢复：

```text
Lemma 3.1
```

再次 Back：

```text
Theorem 4.2
```

---

# 28. Back Is Not Undo

必须严格区分：

```text
Back
```

和：

```text
Ctrl+Z
```

## Back

修改：

```text
navigation state
```

不修改数据。

即：

\[
focus_t\rightarrow focus_{t-1}.
\]

---

## Ctrl+Z

修改：

```text
document / structure data
```

例如：

```text
Add Relation
Remove Relation
Create User Block
Delete User Block
```

都应该支持 Undo。

Filter、focus、collapse、scroll 不进入 Undo history。

---

# 29. Undo / Redo Architecture

Relation 与 User Block 修改必须统一走 Command / Transaction system。

例如：

```ts
AddRelationCommand
RemoveRelationCommand

CreateUserBlockCommand
DeleteUserBlockCommand
```

每个 command 必须实现：

```ts
execute()
undo()
redo()
```

---

# 29.1 Do Not Hijack Text Editor Undo

如果文本编辑器本身拥有 Ctrl+Z history，则不能粗暴全局拦截：

```text
Ctrl+Z
```

推荐规则：

### 焦点在 Source Editor

Ctrl+Z：

```text
editor.undo()
```

### 焦点在 Preview / Relation Panel / Relation Graph

Ctrl+Z：

```text
structuralHistory.undo()
```

如果未来可以将两套 history 统一为 transaction timeline，再进一步整合。

v0.3.4 不应为了统一 Undo 而破坏正常源码编辑行为。

---

# 30. Relation Inspector

右侧 Relation 模块分为两种状态。

---

# 31. Global Relation State

当：

```text
focusBlockId = null
```

Relation Inspector 显示全文级入口。

例如：

```text
Relations

Default Perspective
[Prerequisite] [Both] [Consequence]

Default Depth
[2 ▼]

Blocks       84
Relations   126
Warnings      2

[ Open Full Relation View ]
```

整体应保持轻量。

不要变成复杂 dashboard。

---

# 31.1 Direction Without Focus

当没有 focus Block 时：

```text
Prerequisite
Consequence
Both
```

在数学上无法直接过滤整个 Directed Graph。

因为没有中心节点时，每条：

\[
A\rightarrow B
\]

同时意味着：

```text
A is prerequisite
B is consequence
```

因此：

**Global State 下 direction 只是“下一个局部 Focus View 的默认 perspective”。**

Full Relation View 在没有 focus 时默认显示所有 active logical edges。

禁止错误地把：

```text
Prerequisite only
```

解释为全文只显示某一方向的 edge。

---

# 32. Block Relation State

当选中：

```text
Theorem 4.2
```

右侧切换为：

```text
Theorem 4.2
Consistency of estimator

Type
Theorem

Label
thm:consistency

Contained in
Section 4

────────────────

Prerequisites   3

Definition 2.1
Lemma 3.4
Assumption A

[ + Add ]

────────────────

Consequences    2

Corollary 4.3
Theorem 5.1

[ + Add ]

────────────────

Warnings        0

[ Open Relation View ]
```

Relation Inspector 只显示基础信息和快捷入口。

详细筛选仍由 Relation Mode / Graph View 处理。

---

# 33. Full Relation View

没有 focus 时：

```text
Open Full Relation View
```

打开全文 Semantic Relation Graph 的 Display Graph。

默认：

```text
focus = null
depth = all
show all logical edges
```

Containment Edge 暂不显示。

---

# 34. Focused Relation View

如果当前 focus：

```text
Theorem 4.2
```

点击：

```text
Open Relation View
```

构造：

\[
N_k(Theorem\,4.2)
\]

其中：

\[
k = relationDepth.
\]

例如：

```text
Definition
    ↓
Lemma
    ↓
Theorem 4.2
    ↓
Corollary
```

---

# 35. Relation View Controls

第一版推荐只提供：

```text
Focus
Theorem 4.2

Direction
[← Prerequisite] [Both] [Consequence →]

Depth
[-] 2 [+]

[Back]
[Fit View]
```

复杂 graph analysis controls 留到后续版本。

---

# 36. Graph Node Interaction

Relation View 中点击 Block：

```text
single click
```

选择节点并显示基本信息。

用户可以：

```text
Set as Focus
```

推荐双击节点直接：

```ts
setRelationFocus(blockId)
```

同时提供：

```text
Go to Preview
```

实现：

```ts
Preview.scrollTo(blockId)
```

---

# 37. Relation View Direction

focus 为 \(A\)。

## Prerequisite

显示：

\[
\{v:v\leadsto A\}
\]

在指定 depth 内的 upstream graph。

---

## Consequence

显示：

\[
\{v:A\leadsto v\}.
\]

---

## Both

显示 upstream 与 downstream 的并集。

---

# 38. Relation Depth Algorithm

推荐 BFS。

例如：

```ts
function getRelationNeighborhood(
  focusId,
  direction,
  depth
)
```

Depth 1：

只取 direct neighbors。

Depth 2：

继续向外扩一层。

Depth All：

取所有 reachable nodes。

对于 cycle 必须维护：

```ts
visited
```

避免无限遍历。

---

# 39. Relation Graph Layout

推荐：

```text
React Flow
+
ELK.js
```

React Flow 负责：

- rendering
- node selection
- zoom
- pan
- interaction
- focus
- highlight

ELK.js 负责：

- hierarchical ranking
- node ordering
- crossing minimization
- long edges
- orthogonal routing
- node coordinates

推荐主方向：

```text
LEFT → RIGHT
```

对应：

```text
prerequisite → consequence
```

---

# 40. Cross-Level Relation

例如：

```text
A → D
```

跨越多个逻辑层。

不要自行修改 Semantic Edge。

直接交给 ELK layered layout。

ELK 可以内部处理长边与中间 dummy layout node。

这些 dummy node 不进入 Semantic Graph。

---

# 41. Containment Visualization

v0.3.4 暂不正式定义 Relation Graph 中的 containment 表现方式。

目前：

```text
Containment Tree
```

只用于：

- 左侧缩进
- hierarchy filtering
- parent / child calculation
- aggregate relation semantics

Relation Graph 只绘制：

```text
Logical Relation
```

未来可以增加：

- compound node
- section band
- nested box
- hierarchy overlay

但不属于 v0.3.4。

---

# 42. Single Source of Truth

Preview、Left Relation Panel、Relation Inspector、Relation Graph 不能分别维护 relation copy。

必须统一：

```text
RelationStore
```

例如：

```ts
interface RelationStore {
  edges: RelationEdge[]
}
```

所有 UI：

```text
Left Panel
Preview
Inspector
Graph
```

都从同一个 Store 派生。

---

# 43. Relation Mutation API

禁止组件直接操作：

```ts
edges.push(...)
```

统一通过：

```ts
RelationService.add(...)
RelationService.remove(...)
```

例如：

```ts
addRelation(sourceId, targetId)
```

内部流程：

```text
validate
    ↓
create transaction
    ↓
update RelationStore
    ↓
push undo command
    ↓
invalidate Display Graph
    ↓
update UI
```

---

# 44. User Block Mutation API

同理：

```ts
BlockService.createUserBlock(...)
BlockService.deleteUserBlock(...)
```

组件不得直接修改 containment tree。

---

# 45. Derived Containment Tree

建议：

```text
range
```

作为 containment 几何事实。

```text
parentId
childIds
```

可以缓存，但必须能够从 interval structure 重建。

不要同时让：

```text
range
```

和：

```text
parentId
```

都成为不可冲突的“权威数据”。

推荐：

```text
range = primary
containment tree = derived/cache
```

---

# 46. Parser Update Validation

源码重新 parse 后：

```text
Environment Blocks
Virtual Blocks
```

可能改变。

更新过程：

```text
Parse
 ↓
Reconcile Block IDs
 ↓
Update ranges
 ↓
Rebuild containment
 ↓
Validate User Blocks
 ↓
Validate Relations
 ↓
Report conflicts
```

---

# 47. User Block Conflict After Source Edit

如果源代码修改导致某 User Block 与新解析出的 Environment Block 产生 partial overlap：

```text
User:
[---------------]

Environment:
        [---------------]
```

不能静默移动 User Block。

应该将其标记：

```text
conflicted
```

并提示：

```text
⚠ Custom block boundary conflicts with document structure.
```

相关 relation 暂时保留，但结构编辑功能可以受限。

这样避免系统自行改变用户定义的语义范围。

---

# 48. Relation Mode Performance

不能每次：

```text
hover
select
scroll
```

都重新跑 ELK。

只在 Display Graph 的结构改变时 invalidate layout。

例如：

```text
relation added
relation removed
focus changed
direction changed
relation depth changed
full graph filter changed
```

才重新布局。

普通：

```text
hover
selection highlight
scroll
preview navigation
```

不得重新运行 layout。

---

# 49. ELK Worker

对于全文关系图，ELK 应优先运行于 Web Worker。

结构：

```text
Main Thread
   │
   ├─ React
   ├─ Editor
   ├─ Preview
   │
   └──── Layout Request
              ↓
          Web Worker
              ↓
             ELK
              ↓
         Layout Result
```

避免大论文 relation graph 布局阻塞 UI。

---

# 50. Relation View Layout Stability

切换 focus 时，不应每次将所有节点完全随机重排。

推荐尽可能保留：

```text
previous positions
```

或者将已有 layout 作为 hint。

未来可以加入：

\[
C_{\text{movement}}
=
\sum_v
\|x_v^{new}-x_v^{old}\|^2.
\]

v0.3.4 不要求实现复杂稳定布局优化，但架构中不要假设每次 layout 必须从零开始。

---

# 51. Persistence

User Block 与 Relation 属于项目结构数据，不应直接污染 LaTeX 源码。

推荐项目目录保存：

```text
.texweave/
    structure.json
```

示例：

```json
{
  "schemaVersion": 1,
  "userBlocks": [],
  "blockBindings": [],
  "relations": []
}
```

UI filter、当前 focus、scroll 等临时状态不应该混入 semantic structure。

可以另存：

```text
ui-state.json
```

或者只存于本地 application state。

---

# 52. Recommended Store Separation

推荐：

```text
BlockStore
RelationStore
RelationUIStore
HistoryStore
```

职责：

```text
BlockStore
    blocks
    ranges
    containment

RelationStore
    semantic edges

RelationUIStore
    focus
    filters
    depth
    collapsed states
    relation mode

HistoryStore
    structural undo / redo
```

不要合成一个巨大 store。

---

# 53. Relation Mode State Machine

推荐简化为：

```text
Inactive
   ↓
FocusSelected
   ↓
RelationMode
   ↓
FocusChanged
   ↓
RelationMode
   ↓
Exit
```

Relation 添加本身不需要进入独立 modal state。

Preview 或 Left Panel 的：

```text
+
-
```

即可直接修改。

Both 模式的方向选择是唯一需要临时 popover 的情况。

---

# 54. Typical User Workflow

用户选择：

```text
Theorem 4.3
```

右侧：

```text
Prerequisites [+]
```

进入：

```text
Relation Mode

Focus:
Theorem 4.3

Direction:
Prerequisite
```

左侧：

```text
Section 2
  Definition 2.1    [+]
  Lemma 2.3         [-]

Section 3
  Proposition 3.1   [+]
```

Preview：

```text
Definition 2.1       [◎] [+]

Lemma 2.3            [◎] [-]

Proposition 3.1      [◎] [+]
```

用户：

```text
+ Definition 2.1
```

创建：

\[
Definition\,2.1
\rightarrow
Theorem\,4.3.
\]

然后点击：

```text
◎ Proposition 3.1
```

focus 切换：

```text
Theorem 4.3
    ↓
Proposition 3.1
```

点击 Back：

```text
Theorem 4.3
```

Ctrl+Z：

撤销最近一次 relation mutation。

Back 与 Ctrl+Z 完全独立。

---

# 55. Non-Goals for v0.3.4

以下内容明确暂不要求完成：

```text
Drag-to-connect graph editing
Complex relation types
AI recommended relations
Automatic semantic relation inference
Containment edges in graph
Edge bundling
Manual graph positioning persistence
Advanced transitive reduction UI
Relation strength / confidence
Multi-user relation editing
```

这些可以建立在 v0.3.4 架构之上。

---

# 56. Key Invariants

实现中必须始终保持以下条件。

### Block structure

\[
\forall A,B,\quad
A\cap B=\varnothing
\lor
A\subseteq B
\lor
B\subseteq A.
\]

### Virtual Blocks

\[
Virtual\notin RelationEndpoints.
\]

### Relation direction

\[
A\to B
\]

统一表示：

```text
A is prerequisite of B
```

### Bidirectional relation

禁止：

\[
A\to B
\land
B\to A.
\]

### Self-loop

禁止：

\[
A\to A.
\]

### Cycle

允许但警告。

### Containment

不参与 logical cycle detection。

### Parent-child logical relation

使用 self-excluding semantics。

### Semantic Graph

永远不被 Display / Layout transformation 修改。

### Relation State

所有 UI 使用同一个 RelationStore。

### Back

只修改 navigation。

### Undo

只修改 persistent structural data。

---

# 57. Acceptance Criteria

v0.3.4 完成时应至少满足以下测试。

## Custom Block

- 可以选择合法范围创建 User Block。
- 部分覆盖现有 Block 时禁止创建。
- 完整包含现有 Block 时允许创建。
- 删除 User Block 不删除源码。
- 删除 User Block 后 children 正确 reparent。
- 删除 User Block 可以 Ctrl+Z 恢复。
- Environment Block 不能手动删除。
- Virtual Block 不能建立 Relation。

## Relation Editing

- 可以添加 prerequisite。
- 可以添加 consequence。
- 可以删除 Relation。
- 双向 Relation 被禁止。
- self-loop 被禁止。
- cycle 被警告但允许。
- parent-child Relation 可创建。
- ancestor/descendant Relation 不产生伪 self-loop。

## Left Relation Panel

- Block 按正文顺序显示。
- hierarchy 使用缩进表示。
- expand / collapse 独立于 focus。
- Filter 保留必要 ancestor。
- Dim / Hide 工作正常。
- Filter 自动展开不会覆盖用户原本 collapse 状态。
- Preview locate 不改变 focus。

## Preview

- Relation Mode 时显示 +/-。
- 已连接 Relation 显示 -。
- 非法 candidate 按钮 disabled。
- ◎ 可以切换 focus。
- 左侧状态与 Preview 状态同步。

## Relation Inspector

- 未选 Block 时显示 Global State。
- Global Direction 不错误过滤 Full Graph。
- 选中 Block 后显示 prerequisites / consequences。
- 可以进入局部 Relation View。

## Relation Graph

- 可以打开 Full Graph。
- 可以打开 focused graph。
- Direction 正确。
- Depth 1 / 2 / All 正确。
- cycle 不导致 BFS 无限循环。
- Graph 中可以切换 focus。
- Graph 中可以跳转 Preview。

## History

- Back 只影响 focus history。
- Ctrl+Z 可以撤销 Relation add/remove。
- Ctrl+Z 可以撤销 User Block create/delete。
- Source Editor 中 Ctrl+Z 不被 Relation UI 错误劫持。

---

# 58. Final Architecture

最终数据流：

```text
                     Source Document
                           │
                           ▼
                        Parser
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
      Environment Blocks         Virtual Blocks
              │
              └────────────┬────────────┘
                           │
                    + User Blocks
                           │
                           ▼
                      Block Store
                           │
                           ▼
                 Containment Forest
                           │
                           ├──────────────┐
                           │              │
                           ▼              ▼
                    Relation Store    Block Browser
                           │
                           ▼
                  Semantic Relation Graph
                           │
                           ▼
                  Relation UI Filters
                           │
                           ▼
                     Display Graph
                           │
                           ▼
                       ELK.js
                           │
                           ▼
                     Layout Graph
                           │
                           ▼
                     React Flow
```

同时：

```text
Block Store
Relation Store
      │
      ├──────── Preview
      ├──────── Left Relation Panel
      ├──────── Relation Inspector
      └──────── Relation Graph
```

四个界面共享同一数据源。

---

# 59. Design Principle

v0.3.4 最重要的原则不是“画一张关系图”，而是建立：

\[
\boxed{
Document
\leftrightarrow
Block
\leftrightarrow
Relation
\leftrightarrow
Graph
}
\]

之间统一且可逆的导航关系。

用户应该可以：

```text
从正文找到 Block
从 Block 查看 Relation
从 Relation 找到其他 Block
从 Graph 回到正文
```

而不需要离开当前工作流。

因此 Relation Graph 不应成为独立工具。

它应该成为正文结构的另一个观察角度。

同样，Left Relation Panel 也不是一个单纯的 Node Picker。

它本质上是：

> 一个以当前 Block 为中心、保留文档层级上下文的 Relation Browser。

这构成 v0.3.4 的核心设计。