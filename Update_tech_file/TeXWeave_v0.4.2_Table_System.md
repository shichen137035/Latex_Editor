# TeXWeave v0.4.2 — Table System 技术设计文档

## 1. 版本目标

v0.4.2 的目标是将 LaTeX 表格从“源码中的二维文本结构”提升为 TeXWeave 中可直接操作的 **Structured Table Object**。

本版本延续 v0.4.1 Image System 的核心思想：

> **Preview 是主要交互层，GUI 负责高频操作，复杂 LaTeX 随时可降级到局部源码编辑，LaTeX Source 始终是唯一 Source of Truth。**

v0.4.2 重点解决：

1. 在 Source / Preview 模式下快速插入表格。
2. 支持常用学术表格样式，例如三线表。
3. Preview 中直接编辑单元格内容。
4. Preview 中直接选择 Row / Column / Cell / Border。
5. 支持合并单元格。
6. 支持横线、竖线、局部线、线宽和间距的可视化编辑。
7. 支持 `booktabs` 风格。
8. 支持 `\multicolumn` / `\multirow`。
9. 支持基本列宽、对齐和行距设置。
10. 支持表格模板和项目级默认设置。
11. 对复杂 LaTeX 表格进行“部分可编辑”降级，而不是强制重写。
12. 保留所有未知和自定义源码结构，避免 GUI 修改导致源码损坏。

---

## 2. 核心原则

### 2.1 Table 与 Tabular 分离

必须区分：

```latex
\begin{table}[htbp]
    \centering
    \caption{Results}
    \label{tab:results}

    \begin{tabular}{lcc}
        ...
    \end{tabular}
\end{table}
```

与：

```latex
\begin{tabular}{lcc}
    ...
\end{tabular}
```

内部模型：

```text
TableBlock
├── TableObject
│   ├── caption
│   ├── label
│   ├── placement
│   └── alignment
│
└── TabularObject
    ├── columns
    ├── rows
    ├── cells
    ├── spans
    ├── borders
    └── style
```

不能将：

```text
Table == Tabular
```

作为内部假设。

### 2.2 表格环境属于 Environment Block

例如：

```latex
\begin{table}
...
\end{table}
```

以及：

```latex
\begin{tabular}
...
\end{tabular}
```

都应作为结构化 Environment Block 参与：

- Block selection
- Relation
- Search
- Filter
- Label / Ref
- Preview rendering
- Inspector editing

示意：

```ts
interface TableBlock extends EnvironmentBlock {
  table?: TableObject;
  tabular: TabularObject;
}
```

### 2.3 Source is Truth

GUI 不维护独立于源码的第二套表格。

必须满足：

```text
LaTeX Source
     ↓
Table Parser
     ↓
Structured Table Model
     ↓
Preview / GUI Inspector
     ↓
Minimal Source Patch
```

所有 GUI 操作必须最终写回 LaTeX。

### 2.4 Lossless Editing

GUI 修改不能删除无法识别的 LaTeX。

例如：

```latex
\begin{tabular}{
  >{\raggedright\arraybackslash}p{4cm}
  S[table-format=3.2]
}
```

即使 TeXWeave 无法完整解析，也必须保留原始 column specification。

复杂内容优先进入：

```text
Partially Editable
```

而不是重写。

---

## 3. 对象模型

### 3.1 TableObject

```ts
interface TableObject {
  id: string;

  environment:
    | "table"
    | "table*"
    | "none";

  placement?: string;

  alignment:
    | "left"
    | "center"
    | "right"
    | "custom";

  caption?: LatexFragment;
  label?: string;

  tabular: TabularObject;

  sourceRange: SourceRange;
}
```

### 3.2 TabularObject

```ts
interface TabularObject {
  id: string;

  environment:
    | "tabular"
    | "tabular*"
    | "tabularx"
    | "longtable"
    | "array"
    | "custom";

  columns: TableColumn[];
  rows: TableRow[];
  cells: TableCell[];

  borders: TableBorder[];

  style: TableStyle;

  sourceRange: SourceRange;

  editableLevel:
    | "full"
    | "partial"
    | "source-only";
}
```

### 3.3 TableCell

```ts
interface TableCell {
  id: string;

  row: number;
  column: number;

  rowSpan: number;
  colSpan: number;

  content: LatexFragment;

  alignment?: CellAlignment;

  background?: LatexValue;

  sourceRange: SourceRange;
}
```

### 3.4 TableRow

```ts
interface TableRow {
  id: string;

  index: number;

  role:
    | "header"
    | "body"
    | "footer"
    | "custom";

  height?: LatexValue;

  sourceRange: SourceRange;
}
```

### 3.5 TableColumn

```ts
interface TableColumn {
  id: string;

  index: number;

  alignment:
    | "left"
    | "center"
    | "right"
    | "paragraph"
    | "middle"
    | "bottom"
    | "custom";

  width?: LatexValue;

  rawSpec?: string;
}
```

### 3.6 TableBorder

```ts
interface TableBorder {
  id: string;

  orientation:
    | "horizontal"
    | "vertical";

  position: number;

  start: number;
  end: number;

  thickness?: LatexValue;

  semanticRole?:
    | "top"
    | "header-separator"
    | "body"
    | "bottom"
    | "custom";

  preferredSyntax?:
    | "booktabs"
    | "hline"
    | "cline"
    | "custom";

  sourceRange?: SourceRange;
}
```

---

## 4. 快速插入表格

Source 和 Preview 顶部工具栏均提供：

```text
Insert Table
```

点击后显示快速 Grid Selector：

```text
□ □ □ □ □
□ □ □ □ □
□ □ □ □ □
□ □ □ □ □
```

鼠标 hover：

```text
3 × 4
```

点击即建立表格。

下方可以提供最小化选项：

```text
Style
● Three-line
○ Grid
○ Plain

☑ Header row
☑ Caption
☑ Label
```

默认推荐：

```text
Three-line
```

---

## 5. Source 模式插入

在 Source Editor 中：

```text
Insert Table
```

根据当前光标位置插入表格源码。

默认示例：

```latex
\begin{table}[htbp]
    \centering
    \caption{}
    \label{tab:table}

    \begin{tabular}{lcc}
        \toprule
        Column 1 & Column 2 & Column 3 \\
        \midrule
                 &          &          \\
                 &          &          \\
        \bottomrule
    \end{tabular}
\end{table}
```

插入完成后可将编辑焦点定位到：

```latex
\caption{|}
```

或者第一个 header cell。

---

## 6. Preview 模式插入

Preview 中：

```text
Insert Table
```

根据当前 Block insertion position 新建 Table Block。

示意：

```text
Paragraph A

──────── Insert here ────────

Paragraph B
```

插入后：

```text
Paragraph A

[ Table Block ]

Paragraph B
```

底层仍然修改 `.tex`。

---

## 7. 表格样式预设

v0.4.2 将表格 Style 作为一级概念。

默认支持：

```text
Three-line / Booktabs
Simple Grid
Horizontal Lines
No Borders
Header + Bottom
Custom
```

---

## 8. Three-line / Booktabs

三线表必须作为正式 Preset。

默认：

```latex
\begin{tabular}{lcc}
\toprule
Model & RMSE & MAE \\
\midrule
AR    & 1.42 & 1.12 \\
PPAR  & 1.31 & 1.04 \\
\bottomrule
\end{tabular}
```

如果项目缺少：

```latex
\usepackage{booktabs}
```

弹出：

```text
This table style requires package "booktabs".

[Add package]
[Cancel]
```

---

## 9. Style 与 Data 分离

内部不得把：

```text
Three-line Table
```

理解为一段固定源码。

应该：

```text
Table Data
+
Table Structure
+
Table Style
```

例如：

```ts
interface TableStyle {
  preset:
    | "booktabs-three-line"
    | "grid"
    | "horizontal"
    | "plain"
    | "custom";

  outerVerticalBorders?: boolean;
  innerVerticalBorders?: boolean;

  defaultRuleThickness?: LatexValue;

  rowSpacing?: LatexValue;
}
```

如果用户修改三线表中的某条线：

```text
Three-line
↓
Custom
```

但仍保留所有编辑能力。

---

## 10. Preview 默认显示真实表格

自然状态：

```text
Model      RMSE     MAE
───────────────────────
AR         1.42     1.12
PPAR       1.31     1.04
───────────────────────
```

而不是 LaTeX source。

点击整个 Table Block：

```text
TABLE
────────────────────

Style
[ Three-line ▼ ]

Alignment
[ Center ▼ ]

Width
[ Auto ]

Caption
[ Forecast performance ]

Label
[ tab:forecast ]

Float
[ h ][ t ][ b ][ p ]

────────────────────
[ Advanced Source ]
```

---

## 11. 表格选择层级

Preview 中需要支持多级选择：

```text
Table
Tabular
Row
Column
Cell
Border
```

不同层级显示不同 Inspector。

---

## 12. Table Inspector

选择整个 Table：

```text
TABLE
────────────────────

Style
[ Three-line ▼ ]

Alignment
[ Center ▼ ]

Float
[ h ][ t ][ b ][ p ]

Caption
[ Forecast performance ]

Label
[ tab:forecast ]

Rows
4

Columns
3

[ Advanced Source ]
```

---

## 13. Cell Inspector

点击单元格：

```text
CELL
────────────────────

Content
[ 1.42 ]

Alignment
[ Center ▼ ]

Column Span
[ 1 ]

Row Span
[ 1 ]

Background
[ None ]

Padding
[ Default ]

[ Merge... ]
[ Split Cell ]
```

---

## 14. 直接编辑 Cell 内容

双击单元格：

```text
┌────────┐
│ 1.42|  │
└────────┘
```

进入 inline editing。

快捷键建议：

```text
Tab
→ next cell

Shift + Tab
→ previous cell

Enter
→ confirm / next row

Esc
→ cancel current edit
```

最后一个 Cell 按 Tab：

可以根据设置：

```text
Add new row automatically
```

或：

```text
Move to first cell
```

---

## 15. LatexFragment

Cell 内容不能简单存纯文本。

例如：

```latex
$\hat{\theta}$
```

或：

```latex
\textbf{PPAR}
```

必须保存为：

```ts
LatexFragment
```

对于复杂 Cell：

```text
Rendered Preview
+
Local Source Edit
```

而不是把公式转成 Unicode 再写回。

---

## 16. Row Inspector

选择一整行：

```text
ROW
────────────────────

Role
[ Header ▼ ]

Height
[ Auto ]

Top Rule
[ None ▼ ]

Bottom Rule
[ Mid Rule ▼ ]

Spacing Before
[ Default ]

Spacing After
[ Default ]

[ Insert Above ]
[ Insert Below ]
[ Delete Row ]
```

---

## 17. Header Role

表头不等于“第一行”。

需要允许：

```text
Set as Header Row
```

并允许多行 header。

例如：

```text
Header Rows:
1–2
```

这样系统才能正确理解：

```text
header separator
```

以及未来的：

```latex
\cmidrule
```

---

## 18. Column Inspector

选择整列：

```text
COLUMN
────────────────────

Alignment
[ Center ▼ ]

Width
[ Auto ]

Text Wrapping
[ Auto ▼ ]

Left Border
[ None ]

Right Border
[ None ]

[ Insert Left ]
[ Insert Right ]
[ Delete Column ]
```

---

## 19. Column Spec 映射

需要至少支持：

```text
l
c
r

p{...}
m{...}
b{...}
```

对应：

```text
Left
Center
Right

Paragraph
Middle
Bottom
```

复杂：

```latex
>{...}p{...}
S[...]
@{...}
```

进入：

```text
Partial Editing
```

---

## 20. 拖动列宽

Preview 可以允许直接拖列边界：

```text
Model │ RMSE │ MAE
      ↑
    drag
```

如果原始列为：

```latex
c
```

而用户开始拖动宽度，必须确认是否允许转换为：

```latex
p{4cm}
```

建议设置：

```text
☑ Allow automatic column-spec conversion
```

如果关闭：

```text
Changing width requires a fixed-width column.

[Convert]
[Cancel]
```

---

## 21. 合并单元格

框选多个 Cell：

```text
[ Merge Cells ]
```

水平合并：

```latex
\multicolumn{2}{c}{Content}
```

垂直合并：

```latex
\multirow{2}{*}{Content}
```

如果缺少：

```latex
\usepackage{multirow}
```

提示：

```text
This operation requires package "multirow".

[Add package]
[Cancel]
```

---

## 22. 内部 Span

GUI 内部必须理解：

```ts
rowSpan
colSpan
```

不能只把：

```latex
\multicolumn
```

当字符串。

例如：

```ts
{
  rowSpan: 1,
  colSpan: 3
}
```

最终 serializer 决定如何写回 LaTeX。

---

## 23. Split Cell

对于：

```latex
\multicolumn{3}{c}{A}
```

用户选择：

```text
Split Cell
```

应拆回：

```text
A | | 
```

或者其他合理结构。

默认策略：

```text
keep content in first cell
```

其他新 Cell 为空。

---

## 24. Border 作为一级对象

用户可以直接 hover / 点击边框。

Hover：

```text
highlight border
```

点击：

```text
BORDER
────────────────────

Orientation
Horizontal

Role
[ Header Separator ▼ ]

Thickness
[ 0.8 pt ]

Range
Columns 1 → 3

Spacing Above
[ Default ]

Spacing Below
[ Default ]

[ Delete Line ]
```

---

## 25. Border Toolbar

选择 Cell / Row / Column 后，可使用：

```text
Borders
├── Top
├── Bottom
├── Left
├── Right
├── All
├── Inner
├── Horizontal
├── Vertical
└── None
```

并设置：

```text
Thickness
[ 0.5 pt ]

Style
[ Solid ]
```

---

## 26. LaTeX 线条映射

系统至少需要理解：

```latex
\hline
\cline{2-4}

\toprule
\midrule
\bottomrule
\cmidrule{2-4}

\specialrule
```

内部尽量存语义：

```text
Top Rule
Header Separator
Body Rule
Bottom Rule
Partial Rule
```

而不是死绑定具体命令。

---

## 27. 三线表保护提示

Booktabs 风格不推荐：

```text
vertical borders
line after every row
```

如果用户使用：

```text
Three-line
```

然后添加竖线：

```text
Vertical rules are uncommon in booktabs-style tables.

[Add anyway]
[Cancel]
```

这是提示，不是限制。

TeXWeave 不应强制排版风格。

---

## 28. 调节线条厚度

用户选择某条 line：

```text
Thickness
[ 1.0 pt ]
```

如果：

```text
booktabs
```

可以通过：

```latex
\specialrule
```

或者相关长度参数序列化。

如果无法进行局部安全映射：

```text
Changing this rule requires custom LaTeX.

[Convert to custom rule]
[Cancel]
```

---

## 29. 行距与 Cell 间距

Inspector 可支持：

```text
Row spacing
Cell padding
```

但第一版不应过于复杂。

推荐：

```text
Row spacing
[ Default ▼ ]

Compact
Default
Comfortable
Custom
```

Custom 可映射到：

```latex
\renewcommand{\arraystretch}{...}
```

或局部表格命令。

---

## 30. 默认表格模板

Project Settings：

```text
Tables
```

建议：

```text
Default Style
[ Academic Three-line ▼ ]

Default Alignment
[ Center ]

Default Float
[ htbp ]

Header
☑ First row is header

Caption
☑ Add caption

Label
☑ Add label

Label Prefix
[ tab ]

Default Editor
● GUI
○ Source
```

---

## 31. Table Style Template

可以配置：

```text
Three-line
```

参数：

```text
Top Rule Thickness
[ Default ]

Mid Rule Thickness
[ Default ]

Bottom Rule Thickness
[ Default ]

Vertical Rules
[ None ]

Row Spacing
[ Default ]
```

也可以保存自定义：

```text
My Journal Style
```

---

## 32. 默认源码模板

默认三线表：

```latex
\begin{table}[htbp]
    \centering
    \caption{}
    \label{tab:table}

    \begin{tabular}{lcc}
        \toprule
        Column 1 & Column 2 & Column 3 \\
        \midrule
                 &          &          \\
                 &          &          \\
        \bottomrule
    \end{tabular}
\end{table}
```

---

## 33. Advanced Source

Table Inspector：

```text
[ Advanced Source ]
```

点击后只打开：

```text
当前 Table Block 局部源码
```

例如：

```text
┌──────── Table Source ───────────┐

\begin{table}[htbp]
...
\end{table}

└─────────────────────────────────┘
```

提供：

```text
[Back to GUI]
```

---

## 34. 默认编辑模式

Settings：

```text
Table Editor

When selecting table blocks:

● Open GUI inspector
○ Open source editor
```

默认：

```text
GUI Inspector
```

高级用户可以改为：

```text
Source
```

---

## 35. Partial Editing

对于复杂表格：

```latex
\begin{tabular}{
  >{\raggedright\arraybackslash}p{4cm}
  S[table-format=3.2]
  @{\,\pm\,}
  S
}
```

TeXWeave 不应该强制转成普通：

```latex
lcc
```

显示：

```text
ADVANCED TABLE
────────────────────

This table contains custom column definitions.

✓ Cell content editable
✓ Caption editable
✓ Label editable
✓ Basic row operations available

✕ Visual column layout editing unavailable
✕ Border conversion unavailable

[Open Source]
```

---

## 36. Editable Level

内部：

```ts
editableLevel:
  | "full"
  | "partial"
  | "source-only"
```

### Full

普通：

```text
l c r
p{}
booktabs
multicolumn
multirow
```

### Partial

包含部分未知：

```text
custom column spec
custom macros
advanced packages
```

### Source-only

无法可靠建立 grid 的极端表格。

---

## 37. Unknown Commands

例如：

```latex
\myrule
```

出现在 Table 中。

不能删除。

保存：

```ts
rawFragments
```

GUI 修改其他 Cell 后：

```text
\myrule
```

必须仍然存在。

---

## 38. Minimal Source Patch

修改：

```text
Cell content
```

只 patch 对应 Cell source range。

修改：

```text
Caption
```

只 patch caption。

修改：

```text
width
```

只 patch column spec。

不要：

```text
parse
↓
generate entire table again
```

除非结构发生重大变化，例如：

```text
merge / split
insert column
change environment
```

---

## 39. 支持环境

v0.4.2 首版建议：

```text
table
table*

tabular
tabular*
tabularx

l / c / r
p{} / m{} / b{}

\hline
\cline

booktabs:
\toprule
\midrule
\bottomrule
\cmidrule
\specialrule

\multicolumn
\multirow

caption
label
centering
placement
```

---

## 40. longtable

`longtable` 可以：

```text
Preview supported
Basic cell editing supported
```

但完整分页语义：

```text
\endfirsthead
\endhead
\endfoot
\endlastfoot
```

可留到 v0.4.x 后续。

---

## 41. 暂不完整支持

v0.4.2 第一阶段不要求完整 GUI 支持：

```text
complex custom macros
nested tabular
TikZ tables
very complex siunitx column config
automatic decimal alignment editor
full longtable pagination editor
spreadsheet formulas
CSV synchronization
database-backed tables
```

---

## 42. Keyboard Workflow

Preview Cell 编辑建议：

```text
Tab
→ Next Cell

Shift + Tab
→ Previous Cell

Enter
→ Confirm / Next Row

Ctrl + Enter
→ Edit local source

Delete
→ Clear selected cells

Ctrl + M
→ Merge selected cells
```

快捷键可在后续统一配置。

---

## 43. 多选

支持鼠标拖动框选：

```text
┌─────┬─────┬─────┐
│  A  │█████│█████│
├─────┼─────┼─────┤
│  B  │█████│█████│
└─────┴─────┴─────┘
```

多选后可：

```text
Merge
Alignment
Borders
Clear
Delete
```

---

## 44. Table Parser

建议新增：

```text
TableParser
```

职责：

```ts
parseTableEnvironment()
parseTabularEnvironment()
parseColumns()
parseRows()
parseCells()
parseMulticolumn()
parseMultirow()
parseRules()
parseCaption()
parseLabel()
parsePlacement()
```

---

## 45. Table Serializer / Patch Engine

建议：

```text
TablePatchEngine
```

职责：

```text
patch cell
patch caption
patch label
patch column spec
patch borders
patch merge
patch row/column operations
```

优先：

```text
minimal patch
```

必要时：

```text
structural regeneration
```

---

## 46. Table Preview

组件建议：

```text
TablePreview
├── TableFrame
├── GridPreview
├── RowOverlay
├── ColumnOverlay
├── CellEditor
├── BorderOverlay
└── SelectionLayer
```

---

## 47. Table Inspector

```text
TableInspector
├── TableSettings
├── RowInspector
├── ColumnInspector
├── CellInspector
├── BorderInspector
└── AdvancedSource
```

---

## 48. 推荐模块结构

```text
src/
├── table/
│   ├── parser/
│   │   ├── tableParser.ts
│   │   ├── tabularParser.ts
│   │   ├── cellParser.ts
│   │   └── borderParser.ts
│   │
│   ├── model/
│   │   ├── TableObject.ts
│   │   ├── TabularObject.ts
│   │   ├── TableRow.ts
│   │   ├── TableColumn.ts
│   │   ├── TableCell.ts
│   │   └── TableBorder.ts
│   │
│   ├── preview/
│   │   ├── TablePreview.tsx
│   │   ├── GridPreview.tsx
│   │   ├── CellEditor.tsx
│   │   ├── BorderOverlay.tsx
│   │   └── TableSelection.tsx
│   │
│   ├── inspector/
│   │   ├── TableInspector.tsx
│   │   ├── RowInspector.tsx
│   │   ├── ColumnInspector.tsx
│   │   ├── CellInspector.tsx
│   │   ├── BorderInspector.tsx
│   │   └── TableSourceEditor.tsx
│   │
│   ├── insert/
│   │   ├── insertTable.ts
│   │   └── tableTemplate.ts
│   │
│   └── patch/
│       ├── tablePatchEngine.ts
│       └── tableSerializer.ts
```

---

## 49. Project Settings

示例：

```json
{
  "tables": {
    "defaultStyle": "booktabs-three-line",

    "defaultInsert": {
      "alignment": "center",
      "placement": "htbp",
      "headerRow": true,
      "addCaption": true,
      "addLabel": true
    },

    "labelPrefix": "tab",

    "editor": {
      "defaultMode": "gui"
    },

    "editing": {
      "allowAutomaticColumnConversion": false,
      "autoAddRowOnTab": false
    },

    "styles": {
      "booktabs-three-line": {
        "rowSpacing": "default",
        "verticalBorders": false
      }
    }
  }
}
```

---

## 50. Dependency Handling

需要识别 package dependency。

例如：

### booktabs

```latex
\usepackage{booktabs}
```

### multirow

```latex
\usepackage{multirow}
```

### array

```latex
\usepackage{array}
```

### tabularx

```latex
\usepackage{tabularx}
```

执行需要 package 的 GUI 操作时：

```text
Package required.

[Add package]
[Cancel]
```

不要静默修改 preamble。

---

## 51. 错误处理

单个表格解析失败不得导致整个 Preview 崩溃。

显示：

```text
┌─────────────────────────────┐
│   TABLE PREVIEW FAILED      │
│                             │
│ This table uses unsupported │
│ or invalid LaTeX structure. │
│                             │
│ [Open Source]               │
└─────────────────────────────┘
```

原则：

```text
Table failure
≠
Document failure
```

---

## 52. 解析一致性检查

Table Parser 需要检测：

```text
column count mismatch
invalid multicolumn span
invalid multirow span
missing row terminator
overlapping merged cells
unsupported nested environment
```

GUI 不应尝试“自动修复”复杂错误。

可以提供：

```text
Table structure warning
```

并允许进入 Source。

---

## 53. Preview 性能

表格可能很大。

至少测试：

```text
5 × 5
20 × 10
100 × 20
500 × 20
```

重点：

```text
selection
cell editing
border hover
scroll
row insertion
column insertion
```

大表格可以考虑：

```text
virtualized rendering
```

但 v0.4.2 首版可先设软阈值。

---

## 54. Selection Performance

不要为每个 border 永久创建大量 DOM。

推荐：

```text
single overlay layer
```

基于当前 hover / selection 动态显示。

否则：

```text
100 × 20 table
```

会出现大量额外节点。

---

## 55. Undo / Redo

所有 GUI 操作必须进入统一编辑历史。

例如：

```text
merge cells
change border
insert row
edit caption
```

都必须：

```text
Ctrl + Z
```

可靠恢复源码。

---

## 56. Acceptance Criteria

### Insertion

- Source 中可通过工具栏快速插入表格。
- Preview 中可通过工具栏快速插入 Table Block。
- Grid Selector 可创建指定行列数。
- 可选择 Three-line / Grid / Plain。
- 默认模板可通过 Project Settings 修改。

### Preview

- `table` / `tabular` 可正确 Preview。
- 表格是结构化 Environment Block。
- 点击后默认进入 GUI。
- 可以进入局部 Advanced Source。
- Source 与 GUI 双向同步。

### Cell Editing

- 可直接双击 Cell 编辑。
- Tab / Shift+Tab 可切换 Cell。
- 支持 LaTeX 内容。
- 可框选多个 Cell。

### Row / Column

- 可插入 / 删除 Row。
- 可插入 / 删除 Column。
- 可设置 Header Row。
- 可修改 Column alignment。
- 可安全修改固定 Column width。

### Merge

- 可进行 Horizontal Merge。
- 可进行 Vertical Merge。
- 正确生成 `\multicolumn`。
- 正确生成 `\multirow`。
- 可 Split merged cell。

### Borders

- 可点击 / 选择 Border。
- 可添加 / 删除 Border。
- 可修改 Border thickness。
- 支持 Top / Bottom / Left / Right / Inner。
- 支持 `\hline` / `\cline`。
- 支持 `booktabs` rule。

### Three-line Table

- Three-line 为正式 Style Preset。
- 支持 `\toprule` / `\midrule` / `\bottomrule`。
- 缺少 `booktabs` 时给予 package 提示。
- 用户仍然可以手动添加其他 Border。

### Partial Editing

- 复杂 column spec 不会被 GUI 擅自重写。
- 未识别命令不会被删除。
- 无法完整编辑时自动降级为 Partial Editing。
- 极端情况可以 Source-only。

### Stability

- 单个 Table 解析失败不会导致 Preview 崩溃。
- Undo / Redo 可恢复所有主要表格操作。
- 大型表格不会因为选择 Overlay 导致严重 DOM 膨胀。

---

## 57. 推荐实施顺序

建议 v0.4.2 按以下阶段实施：

### Phase 1 — Table Model

完成：

```text
Table / Tabular parser
Row / Column / Cell model
Preview rendering
```

### Phase 2 — Cell Editing

完成：

```text
inline cell editing
row / column insert-delete
alignment
```

### Phase 3 — Three-line / Borders

完成：

```text
booktabs
border selection
line thickness
rule editing
```

### Phase 4 — Merge

完成：

```text
multicolumn
multirow
split
span model
```

### Phase 5 — Style / Settings

完成：

```text
table presets
project defaults
package dependency handling
```

### Phase 6 — Partial Editing

完成：

```text
complex column specs
unknown command preservation
safe degradation
```

---

## 58. 最终架构原则

v0.4.2 应形成：

```text
LaTeX Source
      ↓
Table Parser
      ↓
Structured Table Model
      ↓
──────────────────────────────
↓              ↓             ↓
Preview        GUI           Source
Grid           Inspector     Editor
──────────────────────────────
      ↓
Minimal Source Patch
```

Table System 与 v0.4.1 Image System 应共享同一个高层思想：

```text
Environment Block
+
Structured Object
+
Preview Interaction
+
GUI Inspector
+
Advanced Source
+
Lossless Patch
```

其中：

```text
Image
```

主要是对象属性编辑；

而：

```text
Table
```

则进一步发展为二维结构编辑。

最终目标不是把 LaTeX 隐藏起来，而是让用户可以在：

```text
Visual Editing
↕
Structured Editing
↕
Raw LaTeX
```

三层之间自由切换，而不会破坏原始源码。
