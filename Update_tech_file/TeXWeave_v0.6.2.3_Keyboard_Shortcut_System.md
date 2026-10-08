# TeXWeave v0.6.2.3 — Keyboard Shortcut System

## 1. 版本定位

v0.6.2.3 将现有的朴素快捷键列表升级为可长期扩展的 **Keyboard Control System**。

目标不是简单增加更多快捷键，而是让 TeXWeave 在拥有数百条命令后，仍能：

- 明确知道每个快捷键的作用；
- 允许不同场景安全复用同一按键；
- 自动识别真正冲突和上下文覆盖；
- 显示未绑定命令与仍可使用的键位；
- 支持 Chord；
- 为熟练用户建立接近无鼠标的工作流。

核心原则：

> **快捷键不需要全局唯一，但在任意具体运行状态下必须只有一个明确解释。**

---

## 2. 核心模型

快捷键系统拆为两个独立维度：

```text
Command
├─ Functional Group
│  └─ 这个命令是做什么的
│
└─ Activation Context
   └─ 这个命令什么时候有效
```

### Functional Group

用于：

- UI 分类；
- 搜索；
- 描述相关命令；
- 推荐成对快捷键；
- 判断命令之间的语义关系。

示例：

```text
Editing
├─ File
│  ├─ Save
│  ├─ Save All
│  └─ Revert
│
├─ Block
│  ├─ Selection
│  ├─ Navigation
│  ├─ Commit & Navigate
│  │  ├─ Save and Next
│  │  └─ Save and Previous
│  ├─ Move
│  └─ Delete
│
├─ Search
├─ Relation
└─ AI

Build
├─ Compile
├─ Compile Current File
├─ Clean
└─ Open PDF
```

建议使用稳定 ID：

```text
editing.file
editing.block.navigation
editing.block.commitNavigate
editing.block.move
editing.search
editing.relation
build.compile
ai.edit
```

### Activation Context

用于判断快捷键在什么状态下生效。

建议 Context Tree：

```text
global

workspace

editor
├─ source
│  ├─ text
│  ├─ math
│  └─ inline-block-editor
│
├─ preview
│  ├─ no-selection
│  ├─ block-selected
│  ├─ multi-selection
│  └─ block-edit
│
├─ relation
├─ file-tree
└─ search

dialog

manager
├─ shortcut-manager
├─ block-manager
├─ theme-manager
├─ style-resource-manager
└─ ai-skill-manager
```

Context 由 TeXWeave 内部维护，用户不直接编辑。

---

## 3. Context 继承

父 Context 中定义的快捷键，在子 Context 中仍然有效。

例如：

```text
editor
└─ preview
   └─ block-edit
```

若：

```text
Ctrl+S → Save
Context: editor
```

则在 `editor.preview.block-edit` 中也有效。

如果子 Context 定义：

```text
Ctrl+S → Save Block
Context: editor.preview.block-edit
```

则采用：

```text
child context
>
parent context
>
workspace
>
global
```

即更具体的 Context 优先。

---

## 4. 条件式 Context

有些命令不能只靠固定 Context 判断。

例如 Preview 中：

```text
Delete
```

在不同状态可能代表：

```text
block selected
→ Delete Block

inline source editing
→ Delete Character
```

底层因此需要预留：

```ts
when?: string;
```

例如：

```ts
when: "preview.blockSelected && !preview.inlineEditing"
```

v0.6.2.3 不需要让用户直接编辑 `when` 表达式。

---

# 5. 冲突模型

快捷键冲突分为四类。

## 5.1 Direct Conflict

```text
🔴 Direct Conflict
```

条件：

- 相同快捷键；
- Context 同级或运行状态重叠；
- 没有明确优先级可以决定执行哪个命令。

例如：

```text
Save Block and Next
Ctrl+Enter
Context: Block Edit

Save Block and Previous
Ctrl+Enter
Context: Block Edit
```

默认不允许静默保存。

UI：

```text
🔴 Direct conflict

Ctrl+Enter is already assigned to:

Save Block and Previous
Block Editing

[ Replace Existing ]
[ Choose Another ]
[ Cancel ]
```

---

## 5.2 Shadow Conflict / Context Overlap

```text
🟠 Context Overlap
```

条件：

- 相同快捷键；
- Context 存在父子关系；
- 子 Context 可以明确覆盖父 Context。

例如：

```text
Compile
Ctrl+Enter
Context: editor
```

以及：

```text
Save Block and Next
Ctrl+Enter
Context: editor.preview.block-edit
```

进入 Block Edit 后执行后者；离开 Block Edit 后恢复前者。

逻辑允许，但必须警告：

```text
🟠 Context overlap

Ctrl+Enter is already used by:

Compile
Editor

This binding will override it while
Block Editing is active.

[ Assign Anyway ]
[ Choose Another ]
```

---

## 5.3 Prefix Conflict

```text
🟡 Prefix Conflict
```

用于 Chord。

例如：

```text
Ctrl+K → Delete Line
Ctrl+K, T → Insert Table
```

此时 `Ctrl+K` 同时是完整命令和 Chord 前缀。

v0.6.2.3 默认规则：

> 一个序列不能同时作为完整快捷键和 Chord 前缀。

未来如果需要 timeout-based chord，再单独设计。

---

## 5.4 Safe Reuse

```text
🟢 Safe Reuse
```

如果两个 Context 不可能同时激活，则允许复用同一快捷键。

例如：

```text
Ctrl+J
Source Editor
→ Join Lines

Ctrl+J
Relation Graph
→ Jump to Related Block
```

如果 Context 互斥，则不产生冲突警告。

---

## 5.5 OS / Platform Reserved

这不是 TeXWeave 内部冲突，但属于风险。

例如：

```text
Windows:
Alt+F4
Win+L
Ctrl+Alt+Delete

macOS:
Cmd+Q
Cmd+Space
```

UI 显示：

```text
⚠ Reserved by operating system
```

或：

```text
⚠ This shortcut may be intercepted by the operating system.
```

---

# 6. Functional Group 与冲突

Functional Group 不决定运行时冲突。

它只描述语义关系。

例如：

```text
Save Block and Next
Save Block and Previous
```

属于同一 Functional Group：

```text
editing.block.commitNavigate
```

如果绑定相同按键，可在错误信息中强调：

```text
🔴 Direct conflict
Related commands require different shortcuts.
```

而：

```text
Save
Compile
```

即使属于不同 Group，只要 Context 重叠，仍然可能是 Direct Conflict。

因此：

```text
Functional Group
→ 它是什么

Activation Context
→ 它什么时候有效
```

---

# 7. Shortcut Manager

Shortcut Manager 为独立 Manager。

入口：

```text
Settings
→ Editor
→ Keyboard shortcuts
→ Manage
```

必须具有：

```text
← Back to Settings
```

并恢复进入 Manager 前的 Settings：

- category；
- Basic / Advanced；
- Global / Project scope。

---

# 8. Shortcut Manager 总体布局

```text
┌───────────────────────────────────────────────────────────────┐
│ ← Settings   Keyboard Shortcuts                         ×     │
├───────────────────────────────────────────────────────────────┤
│ 🔍 Search commands or shortcuts...                           │
│                                                               │
│ [ Commands ] [ Keyboard Map ] [ Conflicts ]                  │
│                                              Scope: Global ▾  │
└───────────────────────────────────────────────────────────────┘
```

核心视图：

1. Commands
2. Keyboard Map
3. Conflicts

---

# 9. Commands View

从“功能”出发。

回答：

> 这个命令绑定了什么？

建议：

```text
┌──────────────────┬────────────────────────────────────────────┐
│ Categories       │ Command                       Shortcut     │
│                  │                                            │
│ General          │ Save                          Ctrl+S       │
│ Navigation       │ Save All                      Ctrl+Shift+S │
│ Editor           │                                            │
│ Preview          │ Next Block                    Alt+Down     │
│ Blocks           │ Previous Block                Alt+Up       │
│ Relations        │                                            │
│ Search           │ Save Block and Next           Ctrl+Enter  │
│ Build            │ Save Block and Previous       Unassigned  │
│ AI               │                                            │
└──────────────────┴────────────────────────────────────────────┘
```

支持过滤：

```text
All
Modified
Conflicts
Unassigned
User-defined
Default
```

搜索支持：

- command name；
- description；
- shortcut；
- functional group；
- context。

---

# 10. Keyboard Map

从“按键”出发。

回答：

> 这个键现在做什么？

以及：

> 哪些按键还没有被使用？

顶部提供 Modifier Selector：

```text
[ None ]
[ Ctrl ]
[ Shift ]
[ Alt ]
[ Ctrl+Shift ]
[ Ctrl+Alt ]
[ Alt+Shift ]
[ Ctrl+Alt+Shift ]
```

macOS 使用对应：

```text
Command
Option
Control
Shift
```

虚拟键盘状态：

```text
Unused
Assigned
Multiple Contexts
Conflict
Chord Prefix
OS Reserved
```

示意：

```text
K     Used
F     3 bindings
J     Conflict
P     Unused
```

---

# 11. Keyboard Map Context Preview

用户可选择模拟 Context：

```text
Context:
Editor ▾
```

例如选中：

```text
Block Editing
```

虚拟键盘按：

```text
global
+
workspace
+
editor
+
preview
+
block-edit
```

计算当前真正可用的快捷键。

如果某个子 Context 覆盖父 Context，可用橙色角标表示。

---

# 12. Available Keys

Keyboard Map 提供：

```text
Show:
○ All
○ Assigned
● Available
○ Conflicts
```

Available 模式只突出当前 Context 中仍可安全使用的组合。

例如：

```text
Available combinations

Ctrl
Ctrl+;
Ctrl+'
Ctrl+[
Ctrl+]

Ctrl+Shift
Ctrl+Shift+J
Ctrl+Shift+L
Ctrl+Shift+;
```

---

# 13. Unassigned Commands

Commands View 支持：

```text
Unassigned
```

用于查找尚未设置快捷键的命令。

例如：

```text
Save Block and Previous
Open Relation Graph
Toggle Block Outline
AI Review Changes
```

这与 Available Keys 形成两个方向：

```text
Available Keys
→ 哪些键还能用

Unassigned Commands
→ 哪些功能还没有键
```

---

# 14. Conflicts View

专门显示问题：

```text
Conflicts

Direct conflicts                  2
Context overlaps                  4
Prefix conflicts                  1
OS warnings                       3
```

例如：

```text
Ctrl+Shift+F
────────────────────────────────────
Format Document
Search Project

🔴 Direct conflict

                                Fix ›
```

点击 `Fix` 后：

```text
Ctrl+Shift+F

Format Document
Editor

Search Project
Editor

Choose action:

○ Change Format Document
○ Change Search Project
○ Remove one binding
○ Restore defaults
```

---

# 15. Shortcut Recorder

快捷键修改不通过自由文本输入。

点击：

```text
Change shortcut
```

进入：

```text
Press desired shortcut...
```

实时捕获真实按键。

例如：

```text
Ctrl + Shift + K

✓ Available
```

或：

```text
Ctrl + K

🟠 Context overlap

Already assigned:
Open Block Commands
Editor

[ Assign Anyway ]
[ Try Another ]
```

---

# 16. Chord

v0.6.2.3 支持两段 Chord：

```text
Ctrl+K, T
Ctrl+R, G
```

第一版最大长度：

```text
2 stages
```

暂不支持：

```text
Ctrl+K, T, F
```

推荐保留有规律的 Chord namespace，例如：

```text
Ctrl+K → Block
Ctrl+R → Relation
Ctrl+L → LaTeX
Ctrl+A → AI
```

示例：

```text
Ctrl+K, T    Insert theorem
Ctrl+K, E    Insert equation
Ctrl+K, F    Insert figure
Ctrl+K, B    Insert bibliography

Ctrl+R, P    Show prerequisites
Ctrl+R, C    Show consequences
Ctrl+R, G    Open relation graph

Ctrl+A, A    Ask AI
Ctrl+A, E    Edit with AI
Ctrl+A, R    Review AI changes
```

这些只是推荐默认方案，不限制用户自定义。

---

# 17. Related Command Suggestions

Functional Group 可用于推荐成对快捷键。

例如用户设置：

```text
Save Block and Next
Alt+Down
```

系统识别 sibling：

```text
Save Block and Previous
```

可以提示：

```text
Related command

Save Block and Previous
Currently unassigned

Suggested:
Alt+Up

[ Assign ]
```

这样可以帮助用户建立有规律的 keymap。

---

# 18. Command Registry

所有可绑定命令必须来自统一 Registry。

建议：

```text
ShortcutCommandRegistry
```

职责：

- 注册命令；
- 注册默认快捷键；
- 注册 Functional Group；
- 注册 Activation Context；
- 为 Shortcut Manager 提供数据；
- 为 Conflict Engine 提供上下文信息；
- 为 runtime dispatcher 提供命令执行信息。

禁止 Shortcut Manager 自己维护另一套硬编码列表。

---

# 19. Command Definition

建议：

```ts
interface CommandDefinition {
  id: string;
  title: string;
  description?: string;

  group: string;

  context: string;
  when?: string;

  defaultBindings?: KeySequence[];

  allowMultipleBindings?: boolean;
}
```

示例：

```ts
{
  id: "block.commitNext",
  title: "Save Block and Open Next",
  group: "editing.block.commitNavigate",
  context: "editor.preview.blockEdit"
}
```

---

# 20. Shortcut Binding

```ts
interface ShortcutBinding {
  id: string;

  commandId: string;

  sequence: KeySequence;

  context?: string;
  when?: string;

  source:
    | "default"
    | "user"
    | "project";

  layoutMode:
    | "logical"
    | "physical";
}
```

---

# 21. Key Sequence

```ts
interface KeyStroke {
  key: string;

  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

type KeySequence = KeyStroke[];
```

例如：

```text
Ctrl+K, T
```

表示：

```ts
[
  {
    key: "K",
    ctrl: true
  },
  {
    key: "T"
  }
]
```

---

# 22. Physical / Logical Key

为不同键盘布局预留：

```text
logical
physical
```

Logical：

```text
"Z"
```

Physical：

```text
KeyZ
```

v0.6.2.3 可先默认 `logical`，但底层必须保留 `layoutMode`。

---

# 23. Context Definition

```ts
interface ShortcutContextDefinition {
  id: string;
  parent?: string;
  title: string;
  mutuallyExclusiveWith?: string[];
}
```

示例：

```ts
{
  id: "editor.preview.blockEdit",
  parent: "editor.preview",
  title: "Block Editing"
}
```

---

# 24. Functional Group Definition

```ts
interface ShortcutGroupDefinition {
  id: string;
  parent?: string;
  title: string;
  description?: string;
}
```

---

# 25. Conflict Engine

快捷键保存前统一经过 Conflict Engine。

基本步骤：

```text
1. Normalize key sequence
2. Find bindings using same sequence
3. Compare activation contexts
4. Check parent/child relation
5. Check when-condition overlap
6. Check chord prefix relation
7. Check OS reservation
8. Return conflict classification
```

伪代码：

```ts
function classifyConflict(
  next: ShortcutBinding,
  existing: ShortcutBinding
): ConflictType {
  if (sameSequence(next, existing)) {
    if (contextsAreMutuallyExclusive(next, existing)) {
      return "safe-reuse";
    }

    if (sameEffectiveContext(next, existing)) {
      return "direct";
    }

    if (isParentChildContext(next, existing)) {
      return "shadow";
    }

    return "direct";
  }

  if (isPrefixConflict(next.sequence, existing.sequence)) {
    return "prefix";
  }

  return "none";
}
```

---

# 26. Runtime Context Resolver

执行快捷键时：

```text
1. Capture current key sequence
2. Get active Context chain
3. Get matching bindings
4. Filter by when conditions
5. Rank by Context specificity
6. Execute highest-priority binding
```

例如：

```text
active:

global
workspace
editor
preview
block-edit
```

存在：

```text
Ctrl+Enter → Compile
editor

Ctrl+Enter → Save Block
block-edit
```

最终执行：

```text
Save Block
```

---

# 27. Default / User / Project 继承

快捷键配置采用：

```text
Default
   ↓
User
   ↓
Project
```

优先级：

```text
Project
>
User
>
Default
```

Reset 单个命令时：

```text
Project binding
→ restore User binding

User binding
→ restore Default binding
```

不是一律恢复 Built-in Default。

---

# 28. Multiple Bindings

部分命令允许多个快捷键。

例如：

```text
Open Command Palette

Ctrl+Shift+P
F1
```

使用：

```ts
allowMultipleBindings: true
```

UI 可显示来源：

```text
Default
User
Project
```

---

# 29. Shortcut Test Mode

Shortcut Manager 提供：

```text
Test Keys
```

用户按任意快捷键：

```text
Ctrl+Shift+P

Command:
Open Command Palette

Context:
Global

Source:
Default
```

未绑定：

```text
Ctrl+Shift+;

Unassigned
```

发生 Context 覆盖：

```text
Ctrl+Enter

Effective:
Save Block and Next

Shadowed:
Compile Current File
```

---

# 30. 旧快捷键页面迁移

当前已有：

- Undo；
- Redo；
- Save；
- Save All；
- Find；
- Replace；
- Go Back；
- Reference modifier；
- 其他现有快捷键；

全部迁移至 Command Registry。

Shortcut Manager 不再通过页面组件硬编码命令。

未来新增命令时：

```text
registerCommand(...)
```

即可自动进入：

- Commands View；
- Search；
- Keyboard Map；
- Conflict Engine；
- Unassigned Commands。

---

# 31. 推荐注册 API

```ts
registerCommand({
  id: "block.commitNext",

  title: "Save Block and Open Next",

  group: "editing.block.commitNavigate",

  context: "editor.preview.blockEdit",

  defaultBindings: [
    key("Ctrl+Enter")
  ],

  execute: () => {
    // ...
  }
});
```

---

# 32. Keyboard Map 数据来源

Keyboard Map 不保存独立快捷键数据。

它应根据：

```text
Command Registry
+
Effective Bindings
+
Selected Context
```

实时计算。

从而保证：

> Commands View、Keyboard Map、Conflict View 永远使用同一套数据。

---

# 33. Manager 布局

Shortcut Manager 使用大型 Manager 通用布局原则：

- 顶部 Header 固定；
- 左侧分类独立滚动；
- 右侧内容独立滚动；
- `Back to Settings` 始终可见；
- 不把整个页面做成一个超长滚动网页。

---

# 34. 性能要求

系统未来应支持：

```text
300–1000 commands
```

因此：

- Commands View 使用虚拟列表；
- 搜索结果允许缓存；
- Keyboard Map 只计算当前 Modifier / Context；
- 冲突检测不得在每次 render 时完整 O(n²) 扫描。

建议建立：

```ts
Map<NormalizedSequence, ShortcutBinding[]>
```

索引。

---

# 35. Accessibility

Shortcut Manager 本身必须可以通过键盘完成主要操作。

至少支持：

```text
Tab
Shift+Tab
Arrow Keys
Enter
Escape
```

快捷键管理器不能反过来强迫用户依赖鼠标。

---

# 36. v0.6.2.3 必须完成

- [ ] Command Registry
- [ ] Functional Group
- [ ] Activation Context
- [ ] Context Tree
- [ ] Context 父子优先级
- [ ] Direct Conflict
- [ ] Shadow Conflict
- [ ] Prefix Conflict
- [ ] Safe Reuse
- [ ] OS Reserved Warning
- [ ] Commands View
- [ ] Keyboard Map
- [ ] Conflicts View
- [ ] Shortcut Recorder
- [ ] 两段 Chord
- [ ] Unassigned Commands
- [ ] Available Keys
- [ ] Test Keys
- [ ] Default / User / Project 继承
- [ ] Back to Settings

---

# 37. 暂不要求

以下内容留待后续：

- 完整 Vim Mode；
- 完整 Emacs Mode；
- 用户自定义 Context；
- 用户编辑 Context Tree；
- 用户手写复杂 `when` 表达式；
- 三段以上 Chord；
- 云端 keymap 同步；
- 社区 keymap marketplace；
- 自动学习用户习惯；
- 自定义键盘 SVG 布局编辑器。

---

# 38. Acceptance Criteria

v0.6.2.3 完成条件：

- [ ] 所有可绑定命令来自统一 Command Registry。
- [ ] 每个命令具有稳定 ID。
- [ ] 每个命令具有 Functional Group。
- [ ] 每个命令具有 Activation Context。
- [ ] Context 支持父子关系。
- [ ] 子 Context 可以覆盖父 Context。
- [ ] Direct Conflict 可以检测且不能静默保存。
- [ ] Shadow Conflict 可以检测并警告。
- [ ] Prefix Conflict 可以检测。
- [ ] Safe Reuse 不产生错误警告。
- [ ] OS reserved shortcut 可以提示。
- [ ] Shortcut Manager 支持 Commands View。
- [ ] Shortcut Manager 支持 Keyboard Map。
- [ ] Shortcut Manager 支持 Conflicts View。
- [ ] 可以查看 Unassigned Commands。
- [ ] 可以查看 Available Keys。
- [ ] 可以录制快捷键。
- [ ] 可以录制两段 Chord。
- [ ] 可以 Reset 单个快捷键。
- [ ] Global / Project scope 继承正确。
- [ ] Manager 提供 Back to Settings。
- [ ] Keyboard Map 与 Commands View 使用同一数据源。
- [ ] Shortcut Manager 的主要操作可完全通过键盘完成。

---

# 39. 最终架构

```text
                    Keyboard Control System

                           Command
                              │
             ┌────────────────┴────────────────┐
             │                                 │
      Functional Group                 Activation Context
             │                                 │
       “它是什么”                      “什么时候有效”
             │                                 │
             └────────────────┬────────────────┘
                              │
                         Key Binding
                              │
                      Conflict Engine
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
      Commands View      Keyboard Map       Conflicts View
```

最终目标：

> **TeXWeave 可以拥有大量快捷键，同时允许不同 Context 安全复用按键，并始终保证当前运行状态下每一个快捷键具有明确、可解释的行为。**

这套系统将成为未来 Keyboard-first TeXWeave 工作流的基础。
