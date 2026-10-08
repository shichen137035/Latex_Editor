# TeXWeave v0.6.3  
## Block Manipulation System

### 1. 更新目标

v0.6.3 主要增强 Preview / Block 模式下的块操作能力，使用户能够更加直接地对 LaTeX 文档结构进行编辑，而不需要频繁进入源码模式。

本版本新增或完善以下能力：

- 块收起与展开
- 块移动
- 块复制
- 块剪切
- 块暂时关闭
- 批量块操作
- 块级剪贴板
- 块操作事务
- 统一的块选择与操作验证机制

核心原则：

> 任意单块操作都应天然支持多个块。

因此内部 API 应优先采用：

```ts
copyBlocks(blockIds)
moveBlocks(blockIds, target)
disableBlocks(blockIds)
```

而不是分别实现单块版本后再额外添加批量逻辑。

---

# 2. 设计原则

## 2.1 LaTeX 项目必须保持独立可编译

TeXWeave 不应引入只有 TeXWeave 自己能够解释、且会改变最终编译结果的隐藏状态。

即：

> 任何影响最终 PDF 输出的状态，都必须能够仅通过项目文件本身确定。

因此：

- Collapse 可以只保存在 TeXWeave UI 状态中；
- Close / Disable 必须直接反映在 `.tex` 源码中；
- 项目在 Overleaf、TeXstudio、VS Code LaTeX Workshop 或其他标准 LaTeX 环境中编译时，应得到与 TeXWeave 相同的结果。

禁止采用：

```text
metadata 中保存 disabled block
↓
TeXWeave 编译时临时跳过
↓
其他编辑器仍然正常编译该内容
```

因为这种方案会导致不同编辑器得到不同 PDF。

---

# 3. 统一块选择模型

所有块操作均基于一个统一的 `SelectionSet`。

```ts
interface BlockSelection {
  blockIds: BlockId[];
}
```

执行操作前必须进行：

```ts
normalizeSelection()
```

---

## 3.1 Root Selected Blocks

如果用户同时选中了父块和其子块，应只保留最高层级的被选中节点。

例如：

```text
Section A
├── Paragraph 1
├── Theorem 1
│   ├── Paragraph 2
│   └── Equation 1
└── Paragraph 3
```

如果用户选择：

```text
Section A
Theorem 1
Equation 1
```

实际操作对象应规范化为：

```text
Section A
```

否则可能发生：

- 重复复制
- 重复删除
- Source Range 重叠
- 移动时重复插入
- AST 更新冲突

---

## 3.2 Selection Normalization

建议：

```ts
function normalizeSelection(
  blockIds: BlockId[]
): BlockId[]
```

基本流程：

```text
Raw Selection
    ↓
去除重复 BlockId
    ↓
按 Block Tree 计算祖先关系
    ↓
移除已有选中祖先的节点
    ↓
按源码位置排序
    ↓
Normalized Selection
```

---

# 4. Collapse / Expand

## 4.1 定义

Collapse 为纯 UI 行为：

```text
Collapse
≠
Close
```

Collapse：

- 不修改 `.tex`
- 不影响编译
- 不改变 AST 语义
- 只控制 Preview 中内容是否展开

---

## 4.2 示例

展开：

```text
▼ Theorem 3.2  Consistency
    Suppose that ...
    ...
    Proof...
```

收起：

```text
▶ Theorem 3.2  Consistency
```

---

## 4.3 推荐适用对象

主要针对结构块：

```text
section
subsection
subsubsection
theorem
lemma
proposition
proof
enumerate
itemize
custom container
```

对于以下叶节点默认无需提供：

```text
equation
image
table
普通短 paragraph
```

除非后续用户明确开启相关设置。

---

## 4.4 UI State

Collapse 状态可以保存在：

```ts
collapsedBlockIds: Set<BlockId>
```

该状态可以属于：

```text
Workspace State
或
Session State
```

其本身不属于文档语义。

---

## 4.5 操作

支持：

```text
Collapse
Expand
Collapse Children
Expand Children
Collapse Siblings
Expand All
```

批量选择时：

```text
Collapse Selected
Expand Selected
```

---

# 5. Move

Move 是源码级结构操作。

需要支持：

```text
Reorder
Reparent
```

即：

- 同级重新排序
- 移入其他结构块
- 从当前结构提升到父层级

---

# 5.1 基础 API

建议统一实现：

```ts
moveBlocks({
  blockIds,
  target,
  position
})
```

其中：

```ts
type MovePosition =
  | "before"
  | "after"
  | "inside";
```

例如：

```ts
moveBlocks({
  blockIds: ["theorem-5"],
  target: "section-3",
  position: "inside"
})
```

---

# 5.2 快捷移动

可以为常用操作提供快捷方式：

```text
Alt + ↑
向上移动

Alt + ↓
向下移动

Alt + ←
提升层级

Alt + →
降低层级
```

具体快捷键仍交由 v0.6.2 的 Shortcut System 管理。

---

# 5.3 Drag & Drop

Preview 模式应支持拖动块。

拖动时必须明确区分：

```text
──────
插入 before / after
```

和：

```text
┌──────────────┐
│ Move Inside  │
└──────────────┘
```

避免用户混淆：

```text
重新排序
```

与：

```text
改变层级
```

---

# 5.4 Move Validation

移动前必须执行结构验证。

禁止：

```text
将节点移动进入其自身
```

以及：

```text
将节点移动进入自己的后代
```

例如：

```text
Section A
└── Theorem A
```

禁止：

```text
Section A
↓
Theorem A
↓
Section A
```

否则会形成结构环。

---

# 5.5 多块移动

如果选择：

```text
Block A
Block B
Block C
```

移动时应作为一个整体：

```text
[A][B][C]
```

保留：

- 原始相对顺序
- 内部层级
- 内部源码

不得分别执行三个独立 Move。

---

# 6. Block Clipboard

v0.6.3 引入内部 Block Clipboard。

普通系统剪贴板只理解文本，但 TeXWeave 还需要保留：

- Block Tree
- Block Type
- 子节点结构
- Relations
- Asset references
- Source metadata

因此可以使用：

```ts
interface BlockClipboardPayload {
  version: 1;

  sourceProjectId: string;

  blocks: SerializedBlock[];

  rawLatex: string;

  relations?: RelationSnapshot[];

  assets?: AssetReference[];
}
```

---

# 6.1 系统剪贴板兼容

复制时同时写入：

```text
text/plain
```

以及：

```text
application/x-texweave-block
```

例如：

```text
TeXWeave → TeXWeave
```

可以恢复完整块结构。

而：

```text
TeXWeave → VS Code
```

则直接粘贴：

```latex
\begin{theorem}
...
\end{theorem}
```

保证标准剪贴板兼容。

---

# 7. Copy

Copy 过程：

```text
Selection
↓
normalizeSelection
↓
Serialize Block Tree
↓
Collect Source
↓
Collect Relations
↓
Collect Asset References
↓
Write Block Clipboard
↓
Write text/plain
```

复制不修改当前文档。

---

# 7.1 Relation 处理

复制块时应区分：

```text
内部关系
外部关系
```

例如：

```text
A → B
B → C
```

如果同时复制：

```text
A
B
```

则：

```text
A → B
```

属于内部关系，应保留。

而：

```text
B → C
```

如果 C 未被复制，则默认不复制该关系。

未来可在高级 Paste 选项中允许：

```text
Keep External Relations
```

---

# 8. Cut

Cut 基于 Copy 实现。

基本过程：

```text
Copy
↓
进入 Cut State
↓
Source Transaction 删除源块
```

---

## 8.1 Cut Visual State

执行：

```text
Ctrl + X
```

后，可短暂显示：

```text
┌──────────────────┐
│ Theorem 2.1      │
│ ✂ Cut            │
│ opacity: 40%     │
└──────────────────┘
```

用于提示用户当前剪贴板来源。

该 Ghost 状态仅为 UI 效果。

---

## 8.2 Cut State 结束条件

Cut 状态在以下情况结束：

```text
Paste 成功
新的 Copy
新的 Cut
Clipboard 被覆盖
进行其他明确源码编辑
```

---

# 9. Close / Disable Block

## 9.1 定义

UI 名称可以使用：

```text
Close
```

内部语义建议统一命名为：

```text
Disable Block
```

定义：

> 将某个块临时排除在 LaTeX 编译之外，同时保持操作可逆。

---

# 9.2 与 Collapse 的区别

| 操作 | 修改源码 | 影响编译 | UI 状态 |
|---|---:|---:|---:|
| Collapse | 否 | 否 | 是 |
| Close / Disable | 是 | 是 | 是 |
| Delete | 是 | 是 | 否 |

---

# 9.3 禁止虚拟 Disable

不得只通过：

```json
{
  "disabledBlocks": [...]
}
```

记录关闭状态。

否则：

```text
TeXWeave
```

与：

```text
其他 LaTeX 编辑器
```

编译结果不同。

因此 Disable 必须写入 `.tex`。

---

# 10. Disable 的源码实现

推荐采用：

> 可逆逐行注释

而不是依赖特殊 TeXWeave 编译流程。

---

## 10.1 示例

原始：

```latex
\begin{theorem}
Suppose that $X_t$ is stationary.
Then ...
\end{theorem}
```

关闭后：

```latex
%<texweave:disable>
%TW% \begin{theorem}
%TW% Suppose that $X_t$ is stationary.
%TW% Then ...
%TW% \end{theorem}
%</texweave:disable>
```

---

# 10.2 Marker

建议使用：

```latex
%<texweave:disable>
```

和：

```latex
%</texweave:disable>
```

作为边界标记。

内部每行增加：

```latex
%TW% 
```

前缀。

---

# 10.3 为什么需要专用前缀

不能简单改成：

```latex
% \begin{theorem}
% ...
```

因为重新启用时无法区分：

```latex
% 用户原始注释
```

与：

```latex
% TeXWeave 自动加入的注释
```

因此必须使用专用标识：

```latex
%TW%
```

---

# 10.4 Enable

重新启用时：

```text
查找 Disable Marker
↓
确认 marker 合法
↓
只删除 %TW% 前缀
↓
删除 outer markers
↓
恢复源码
```

不能删除普通：

```latex
%
```

否则可能破坏用户原本的注释。

---

# 11. 为什么不优先使用 comment package

另一种方案：

```latex
\usepackage{comment}

\begin{comment}
...
\end{comment}
```

虽然可行，但存在：

- 引入额外 dependency
- 需要修改 preamble
- 可能和已有 package / environment 冲突
- 改变用户工程依赖关系

因此不作为默认实现。

可作为未来高级模式：

```text
Disable Strategy:
- Line Comment
- comment environment
```

默认：

```text
Line Comment
```

---

# 12. 为什么不使用 \iffalse

例如：

```latex
\iffalse

...

\fi
```

虽然不依赖额外 package，但并非通用安全方案。

关闭区域中可能包含：

```latex
\if...
\else
\fi
```

TeX 在跳过 conditional 内容时仍然需要扫描条件结构。

因此可能出现：

- conditional 不平衡
- 奇怪的 nesting
- 编译错误

所以：

```latex
\iffalse ... \fi
```

不应用于通用 Block Disable。

---

# 13. Disable 的源码边界限制

逐行注释意味着 Disable 操作必须确保其源码区域可以安全映射为完整物理行。

例如：

```latex
Some text. \textbf{Important.} More text.
```

如果某个 inline block 只表示：

```latex
\textbf{Important.}
```

则不能直接注释整行。

否则会错误关闭：

```text
Some text.
More text.
```

---

## 13.1 Disableable Block

建议定义：

```ts
interface DisableCapability {
  supported: boolean;
  reason?: DisableUnsupportedReason;
}
```

只有满足以下条件时允许关闭：

```text
Source Range 可以安全扩展到完整行
```

或：

```text
Block 本身已经对应完整源码行范围
```

---

## 13.2 默认支持

以下块通常支持：

```text
section
subsection
paragraph
theorem
lemma
proof
equation environment
figure
table
itemize
enumerate
custom block
```

---

## 13.3 默认不支持

以下对象默认不提供 Close：

```text
inline math
\textbf{}
\emph{}
citation
reference
单行中的局部 command
```

---

# 14. Disable Preview 表现

关闭后的块仍然应该在 Preview 中保留位置，以便用户重新启用。

例如：

```text
┌───────────────────────────┐
│ ⏸ Theorem 3.1            │
│ Temporarily disabled      │
│                           │
│ [Enable]                  │
└───────────────────────────┘
```

视觉：

```text
opacity: 0.4 ~ 0.6
```

同时显示：

```text
Disabled
```

状态 Badge。

---

# 15. Batch Operations

现有选择方式：

```text
Ctrl Selection
Shift Selection
Box Selection
```

继续作为批量操作入口。

---

# 15.1 批量操作栏

当：

```text
selectedBlocks.length > 1
```

时显示浮动操作栏：

```text
┌─────────────────────────────────────┐
│ 14 selected                        │
│ ↑ ↓  ⧉  ✂  ⏸  ▶  🗑  ⋯          │
└─────────────────────────────────────┘
```

支持：

| 操作 | 批量支持 |
|---|---|
| Collapse | Yes |
| Expand | Yes |
| Move | Yes |
| Copy | Yes |
| Cut | Yes |
| Close / Disable | Yes |
| Enable | Yes |
| Delete | Yes |

---

# 15.2 Mixed State

如果当前选择同时包含：

```text
Enabled Block
Disabled Block
```

UI 应显示 Mixed State。

例如：

```text
Disable
Enable
```

可以放在：

```text
More
```

菜单中。

不要自动猜测用户希望全部 Enable 还是全部 Disable。

---

# 16. Operation Transaction

所有源码修改操作应通过统一事务系统完成。

例如移动：

```text
Block A
Block B
Block C
```

不能：

```text
Move A
Parse

Move B
Parse

Move C
Parse
```

应：

```text
Begin Transaction
↓
Remove A
Remove B
Remove C
↓
Insert A+B+C
↓
Commit
↓
Parse Once
```

---

# 16.1 Transaction API

可以设计：

```ts
interface BlockOperationTransaction {
  edits: SourceEdit[];
  affectedBlocks: BlockId[];
  description: string;
}
```

例如：

```ts
applyBlockTransaction({
  edits,
  affectedBlocks,
  description: "Move 3 blocks"
})
```

---

# 16.2 与 Preview Incremental Parser 联动

v0.6.3 应尽量复用现有：

```text
Incremental Preview
```

机制。

流程：

```text
Block Operation
↓
Generate Source Transaction
↓
Apply Source Edits
↓
Attempt Incremental AST Update
↓
Fallback Full Parse
↓
Reuse Existing Preview Nodes
↓
Update UI
```

---

# 17. Structural Validator

所有结构操作统一进入：

```ts
validateBlockOperation()
```

---

## 17.1 检查内容

包括：

```text
Source Range 是否重叠
Selection 是否存在父子重复
Target 是否为自身
Target 是否为后代
目标位置是否合法
Block Type 是否允许作为子节点
跨文件操作是否合法
Disable 是否满足完整行条件
```

---

# 18. Operation Preview

普通安全操作：

```text
Alt + ↑
Copy
Collapse
```

不显示确认框。

只有潜在高风险操作才显示 Operation Preview。

例如：

```text
Move 17 blocks

From:
Section 2

To:
Section 4
Experimental Results

[Cancel]          [Move]
```

适用于：

```text
大量 Move
大量 Disable
跨 Section Move
跨文件 Move
涉及 Assets 的 Cut
```

避免所有操作都弹出传统 Confirm Dialog。

---

# 19. Undo / Redo

所有源码级操作：

```text
Move
Cut
Paste
Disable
Enable
Delete
```

必须进入统一 Undo Stack。

例如：

```text
Undo Disable 3 Blocks
Undo Move 5 Blocks
Undo Paste
```

Collapse 不需要进入源码级 Undo Stack。

可以：

```text
Collapse → UI History
```

或者不保留历史。

---

# 20. Version System 集成

v0.6.3 应继续兼容 v0.5.5 Version System。

大量操作后可以触发自动 Snapshot。

例如：

```text
Delete > N blocks
Move > N blocks
Disable entire section
Cross-file move
```

默认不为每一个小操作创建正式版本。

---

# 21. 推荐架构

整体流程：

```text
User Action
    ↓
Selection Manager
    ↓
normalizeSelection()
    ↓
Block Operation Planner
    ↓
Structural Validator
    ↓
Operation Transaction
    ↓
Source Editor
    ↓
AST Update
    ↓
Preview Update
    ↓
Undo History
    ↓
Auto Snapshot
```

---

# 22. Block Operation 类型

建议：

```ts
type BlockOperation =
  | CollapseOperation
  | ExpandOperation
  | MoveOperation
  | CopyOperation
  | CutOperation
  | PasteOperation
  | DisableOperation
  | EnableOperation
  | DeleteOperation;
```

其中：

```text
Collapse / Expand
```

属于 UI Operation。

其他操作属于：

```text
Source Operation
```

---

# 23. 推荐核心模块

```text
src/
├── blockOperations/
│   ├── selection/
│   │   ├── normalizeSelection.ts
│   │   └── selectionManager.ts
│   │
│   ├── clipboard/
│   │   ├── blockClipboard.ts
│   │   ├── serializeBlocks.ts
│   │   └── pasteBlocks.ts
│   │
│   ├── operations/
│   │   ├── moveBlocks.ts
│   │   ├── copyBlocks.ts
│   │   ├── cutBlocks.ts
│   │   ├── disableBlocks.ts
│   │   ├── enableBlocks.ts
│   │   └── deleteBlocks.ts
│   │
│   ├── validation/
│   │   └── validateBlockOperation.ts
│   │
│   └── transaction/
│       └── blockOperationTransaction.ts
```

UI：

```text
components/
├── BlockActionMenu
├── BatchActionToolbar
├── MoveDropIndicator
├── DisabledBlockOverlay
└── OperationPreviewDialog
```

---

# 24. 本版本最终功能范围

v0.6.3：

```text
Block Manipulation System

├── Selection Normalization
│
├── Collapse / Expand
│
├── Move
│   ├── Reorder
│   ├── Reparent
│   ├── Drag & Drop
│   └── Keyboard Move
│
├── Block Clipboard
│   ├── Copy
│   ├── Cut
│   └── Paste
│
├── Close / Disable
│   ├── Source-level Commenting
│   ├── %TW% marker
│   ├── Enable
│   └── Disabled Preview State
│
├── Batch Operations
│
├── Structural Validation
│
├── Operation Transaction
│
├── Undo / Redo
│
└── Version Snapshot Integration
```

---

# 25. 核心设计结论

v0.6.3 的目标不是简单增加：

```text
Collapse
Move
Copy
Cut
Close
```

几个按钮。

真正目标是建立一套统一的：

> Block Manipulation Infrastructure

其核心包括：

```text
Selection
Clipboard
Validation
Transaction
Undo
```

在此基础上，未来可以自然继续扩展：

```text
Lock Block
Merge Blocks
Split Block
Duplicate
Move to File
Extract to File
Copy Block Link
Export Block
Group Blocks
```

而无需重新设计底层编辑逻辑。

同时，本版本继续坚持 TeXWeave 的兼容性原则：

> TeXWeave 可以增强 LaTeX 编辑体验，但不能让标准 LaTeX 文件依赖 TeXWeave 才能正确解释。

因此所有影响编译结果的操作最终都必须真实反映在 LaTeX 项目源码中。