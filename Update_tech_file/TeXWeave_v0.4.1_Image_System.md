# TeXWeave v0.4.1 — Image System 技术设计文档

## 1. 版本目标

v0.4.1 的目标不是单纯“让 Preview 能显示图片”，而是建立一套完整的 **LaTeX 图片对象系统**。

本版本需要解决以下问题：

1. 在 Source / Preview 两种模式下快速插入图片。
2. 支持工具栏插入、文件选择、拖拽导入等常用操作。
3. 图片插入时自动生成合理但不过度复杂的 LaTeX 模板。
4. 允许用户在 Project Settings 中调整默认插入模板。
5. Preview 模式默认显示实际图片，而不是直接显示源码。
6. 点击图片环境后进入软件原生 GUI 属性编辑，而不是立刻切换到源码。
7. 支持一键进入高级 Source 编辑模式。
8. 允许设置图片块默认打开 GUI 或 Source。
9. 正确处理图片缺失、路径错误、格式不支持等异常。
10. 引入图片 Preview Cache，避免重复加载和重复转换。
11. 支持多图 / 子图布局，例如 1×2、2×2、2×3，并允许调节整体和单个子图参数。
12. 保证所有 GUI 操作最终仍然安全、可逆地映射回 LaTeX 源码。

核心原则：

> **LaTeX Source 始终是唯一 Source of Truth。**

GUI 只是一种结构化编辑方式，不维护与源码独立的第二份文档状态。

---

# 2. 设计原则

## 2.1 Image 与 Figure 分离

必须区分：

```latex
\includegraphics[width=0.8\textwidth]{figure.png}
```

与：

```latex
\begin{figure}[htbp]
    \centering
    \includegraphics[width=0.8\textwidth]{figure.png}
    \caption{Example}
    \label{fig:example}
\end{figure}
```

前者是：

```text
ImageObject
```

后者是：

```text
FigureObject
└── ImageObject
```

这样才能正确支持：

- 单独的 `\includegraphics`
- `figure`
- `figure*`
- `subfigure`
- 多图布局
- 未来的 `minipage`
- 未来的复杂 Figure 环境

不能将：

```text
Figure == includegraphics
```

作为内部模型。

---

## 2.2 图片环境本身属于 Environment Block

在 TeXWeave 当前 Block 系统中：

```latex
\begin{figure}
...
\end{figure}
```

应被识别为：

```text
EnvironmentBlock
type = figure
```

而不是普通文本块。

其 Block 内部拥有结构化 Figure 数据。

示意：

```ts
interface FigureBlock extends EnvironmentBlock {
  figure: FigureObject;
}
```

这样它仍然可以：

- 被 Relation 系统引用
- 拥有 Block ID
- 被筛选
- 被搜索
- 被高亮
- 与 label / ref 系统连接

---

## 2.3 Lossless Editing

GUI 不应擅自“规范化”用户源码。

例如：

```latex
width=0.75\textwidth
```

GUI 不能简单转换成：

```latex
width=12.4cm
```

建议内部始终保存：

```ts
interface LatexValue {
  raw: string;
  parsed?: unknown;
}
```

例如：

```ts
width: {
  raw: "0.75\\textwidth",
  parsed: {
    value: 0.75,
    unit: "\\textwidth"
  }
}
```

如果表达式无法安全解析：

```latex
width=\dimexpr\linewidth-2cm\relax
```

GUI 可以显示原始值，但不应该强行重构。

---

# 3. 基本对象模型

## 3.1 ImageObject

```ts
interface ImageObject {
  id: string;

  sourcePath: string;
  resolvedPath?: string;

  width?: LatexValue;
  height?: LatexValue;
  scale?: LatexValue;
  angle?: LatexValue;

  keepAspectRatio?: boolean;

  trim?: LatexValue;
  viewport?: LatexValue;
  clip?: boolean;

  rawOptions?: string[];

  sourceRange: SourceRange;
}
```

---

## 3.2 FigureObject

```ts
interface FigureObject {
  id: string;

  environment:
    | "figure"
    | "figure*"
    | "none";

  placement?: string;

  alignment:
    | "left"
    | "center"
    | "right"
    | "custom";

  caption?: LatexFragment;
  label?: string;

  images: ImageObject[];

  subfigures?: SubfigureObject[];

  sourceRange: SourceRange;
}
```

---

## 3.3 SubfigureObject

```ts
interface SubfigureObject {
  id: string;

  width?: LatexValue;

  alignment?:
    | "top"
    | "center"
    | "bottom";

  caption?: LatexFragment;
  label?: string;

  images: ImageObject[];

  sourceRange: SourceRange;
}
```

---

# 4. 快速插入图片

---

## 4.1 工具栏入口

Source 和 Preview 模式顶部工具栏均提供：

```text
Insert Image
```

建议图标：

```text
🖼
```

点击后打开快速插入菜单，而不是直接弹出复杂配置窗口。

菜单：

```text
Insert Image

[ Select Image... ]

Recent
────────────────
plot.png
simulation.pdf
result.svg

Insert as
● Figure
○ Inline Image
```

其中：

- 默认选中 `Figure`
- 最近图片列表属于增强功能
- 第一版可以只实现 `Select Image...`

---

# 5. Source 模式插入

在 Source 模式中，插入行为根据当前光标位置执行。

例如用户选择：

```text
simulation.png
```

默认插入：

```latex
\begin{figure}[htbp]
    \centering
    \includegraphics[width=0.8\textwidth]{figures/simulation.png}
    \caption{}
    \label{fig:simulation}
\end{figure}
```

光标插入完成后，可自动放在：

```latex
\caption{|}
```

位置。

如果用户选择：

```text
Inline Image
```

则插入：

```latex
\includegraphics[width=0.8\textwidth]{figures/simulation.png}
```

---

# 6. Preview 模式插入

Preview 中图片插入不能依赖用户寻找源码位置。

需要基于当前 Block selection。

例如当前 Preview：

```text
Paragraph A

[ selected insertion position ]

Paragraph B
```

点击：

```text
Insert Image
```

插入一个新的 Figure Block：

```text
Paragraph A

Figure

Paragraph B
```

底层仍然修改对应的 `.tex` source。

如果当前光标位于某个 Paragraph Block 内，则默认：

```text
insert after current block
```

而不是尝试把整个 Figure 塞进段落中央。

如果用户明确选择 Inline Image，则允许插入当前文本位置。

---

# 7. 文件拖拽

用户可以从系统文件管理器拖动图片进入：

```text
Source Editor
Preview Editor
Project Sidebar
```

三者行为需要区分。

---

## 7.1 拖入 Source

如果拖入 Source Editor：

- 根据鼠标落点确定 source cursor
- 打开简易插入确认
- 生成 Figure 或 Inline Image

---

## 7.2 拖入 Preview

如果拖入 Preview：

- 根据鼠标落点确定 Block insertion position
- 显示插入指示线：

```text
──────────── Insert here ────────────
```

释放后生成 Figure Block。

---

## 7.3 拖入 Project Sidebar

如果只拖入 Project Sidebar：

默认行为是：

```text
Copy image into project
```

但不自动插入 LaTeX。

复制完成后图片出现在项目资源中。

---

# 8. 图片文件复制策略

对于项目外图片，例如：

```text
C:\Users\User\Desktop\plot.png
```

默认不应该直接生成：

```latex
\includegraphics{C:/Users/User/Desktop/plot.png}
```

默认行为：

```text
External Image
      ↓
Copy into project
      ↓
figures/plot.png
      ↓
Insert relative LaTeX path
```

默认目标文件夹由 Project Settings 决定。

例如：

```json
{
  "images": {
    "defaultDirectory": "figures"
  }
}
```

---

## 8.1 文件冲突

如果：

```text
figures/result.png
```

已经存在，而用户再次导入同名文件：

```text
result.png already exists

● Rename imported file
  result_2.png

○ Use existing file

○ Replace existing file

[Cancel] [Continue]
```

默认：

```text
Rename imported file
```

不得静默覆盖。

---

# 9. 默认图片插入模板

默认模板必须可配置。

Project Settings：

```text
Project Settings
└── Images
```

---

## 9.1 Default Insert Template

设置界面：

```text
Default Image Insertion

Insert type
[ Figure ▼ ]

Default width
[ 0.8 ] [ \textwidth ▼ ]

Alignment
[ Center ▼ ]

Float placement
[ h ] [ t ] [ b ] [ p ]

☑ Add caption
☑ Add label

Label prefix
[ fig ]

Image directory
[ figures/ ]

Default editor
● GUI
○ Source
```

---

## 9.2 默认值建议

默认：

```text
Type:
Figure

Width:
0.8\textwidth

Alignment:
Center

Placement:
htbp

Caption:
Enabled

Label:
Enabled

Image Directory:
figures/

Editor:
GUI
```

因此默认模板：

```latex
\begin{figure}[htbp]
    \centering
    \includegraphics[width=0.8\textwidth]{figures/example.png}
    \caption{}
    \label{fig:example}
\end{figure}
```

---

# 10. 高级自定义模板

后续可以允许 Advanced 设置：

```text
Custom Template
```

例如：

```latex
\begin{figure}[{{placement}}]
    {{alignment}}
    \includegraphics[width={{width}}]{ {{path}} }
    \caption{ {{caption}} }
    \label{ {{label}} }
\end{figure}
```

但 v0.4.1 不应要求用户编写模板语言。

第一阶段使用结构化设置即可。

---

# 11. Preview 中图片默认显示

在正常 Preview 模式：

```latex
\begin{figure}
...
\end{figure}
```

应该显示为实际 Figure。

例如：

```text
┌─────────────────────────────┐
│                             │
│        rendered image       │
│                             │
└─────────────────────────────┘

Figure 3. Simulation results
```

默认不显示：

```latex
\begin{figure}
...
```

源码。

---

# 12. 点击 Figure 后的行为

点击 Figure Block：

```text
Figure
```

进入 Figure Selection 状态。

不自动进入 Source 编辑。

右侧 Inspector 切换为：

```text
FIGURE
──────────────────────

Image
simulation.png

Size
Width
[ 0.8 ][\textwidth ▼]

Height
[ auto ]

Scale
[ 1.0 ]

Rotation
[ 0° ]

Layout
Alignment
[ Center ▼ ]

Float
[ h ][ t ][ b ][ p ]

Caption
[ Simulation results ]

Label
[ fig:simulation ]

──────────────────────
[ Advanced ]
```

---

# 13. Inspector 的基本参数

默认 Inspector 只显示高频参数。

必须包含：

### Image

```text
Source Path
Width
Height
Scale
Rotation
```

### Figure

```text
Alignment
Float Placement
Caption
Label
```

不应默认显示：

```text
viewport
trim
clip
origin
复杂长度表达式
raw graphicx options
```

避免 GUI 变得过重。

---

# 14. Advanced Source

Inspector 中：

```text
[ Advanced ]
```

点击后进入该 Figure Block 的 Source 编辑。

例如：

```text
┌──────── Figure Source ────────────┐

\begin{figure}[htbp]
    \centering
    \includegraphics[
        width=0.8\textwidth
    ]{figures/example.png}
    \caption{Example}
    \label{fig:example}
\end{figure}

└───────────────────────────────────┘
```

这里不是整个 `.tex` 文件，而是：

```text
当前 Figure Block 局部源码
```

建议提供：

```text
[Back to GUI]
```

---

# 15. 默认编辑模式可配置

Settings：

```text
Image / Figure Editor

When selecting image blocks:

● Open GUI inspector
○ Open source editor
```

默认：

```text
GUI Inspector
```

如果用户选择 Source：

点击 Figure 后直接进入局部源码编辑状态。

这适合高级 LaTeX 用户。

---

# 16. GUI → Source Patch

任何 GUI 修改都必须映射回源码。

例如：

```text
Width:
0.8\textwidth
→
0.6\textwidth
```

源码：

```latex
\includegraphics[width=0.8\textwidth]{a.png}
```

更新为：

```latex
\includegraphics[width=0.6\textwidth]{a.png}
```

不能重新生成整个 Figure 环境，除非确实无法进行局部 patch。

优先策略：

```text
AST property patch
↓
minimal source edit
```

避免：

```text
formatting loss
comment loss
custom option loss
```

---

# 17. 未识别参数处理

例如：

```latex
\includegraphics[
  width=0.8\linewidth,
  foo=bar
]{a.png}
```

其中：

```text
foo=bar
```

TeXWeave 不认识。

GUI 修改 width 时必须保留：

```latex
foo=bar
```

结果：

```latex
\includegraphics[
  width=0.6\linewidth,
  foo=bar
]{a.png}
```

不能删除未知参数。

内部可保存：

```ts
rawOptions: [
  "foo=bar"
]
```

---

# 18. 图片路径解析

建立统一服务：

```ts
resolveGraphicPath()
```

需要支持：

```latex
\includegraphics{image}
\includegraphics{image.png}
```

以及：

```latex
\graphicspath{{figures/}{images/}}
```

候选格式：

```text
.png
.jpg
.jpeg
.webp
.svg
.pdf
```

路径查找至少考虑：

```text
current tex directory
project root
graphicspath
```

返回：

```ts
interface ResolvedGraphic {
  requestedPath: string;
  resolvedPath?: string;

  exists: boolean;

  format?: string;

  resolutionSource?:
    | "direct"
    | "graphicspath"
    | "extension-search";
}
```

---

# 19. 图片缺失

例如：

```latex
\includegraphics{missing.png}
```

Preview 不能失败。

显示：

```text
┌─────────────────────────────┐
│                             │
│       IMAGE NOT FOUND       │
│                             │
│       missing.png           │
│                             │
│ [Locate] [Replace] [Source] │
└─────────────────────────────┘
```

---

# 20. Locate

点击：

```text
Locate
```

允许用户指定已有文件。

如果找到：

```text
figures/missing.png
```

则修改 source path。

---

# 21. Replace

点击：

```text
Replace
```

选择新图片。

默认：

```text
replace image file reference
```

但保留：

```text
width
height
caption
label
placement
```

即：

```latex
\includegraphics[width=0.8\textwidth]{old.png}
```

变成：

```latex
\includegraphics[width=0.8\textwidth]{new.png}
```

---

# 22. 其他图片异常

至少区分：

```text
FILE_NOT_FOUND
UNSUPPORTED_FORMAT
FAILED_TO_DECODE
PDF_RENDER_FAILED
PERMISSION_DENIED
PATH_OUTSIDE_PROJECT
```

Preview 中使用统一 Placeholder。

单张图片失败不得导致：

```text
Preview crash
Preview blank
React tree failure
```

原则：

> Media failure must remain local.

---

# 23. 支持图片格式

v0.4.1 推荐：

```text
PNG
JPG
JPEG
WEBP
SVG
PDF
```

其中：

```text
PNG/JPEG/WEBP
→ direct browser rendering

SVG
→ direct rendering when safe

PDF
→ preview conversion/cache
```

---

# 24. PDF 图片 Preview

科研项目经常使用：

```latex
\includegraphics{figure.pdf}
```

因此 PDF 必须作为一级支持格式。

处理：

```text
figure.pdf
    ↓
PDF renderer
    ↓
first page rasterization
    ↓
preview bitmap
    ↓
cache
```

LaTeX 编译时仍然使用原始 PDF。

Preview conversion 不得修改项目原文件。

---

# 25. Image Cache

缓存目录建议：

```text
.texweave/
└── cache/
    └── images/
```

例如：

```text
.texweave/cache/images/
    171ef86.webp
    65a99d2.webp
```

---

# 26. Cache Key

建议 Cache Key 至少包含：

```text
absolute resolved path
file modification time
file size
preview renderer version
render settings
```

例如：

```text
hash(
  path +
  mtime +
  size +
  rendererVersion
)
```

如果未来需要更严格，可以使用 file hash。

---

# 27. Cache Invalidation

以下情况重新生成：

```text
source image modified
source image replaced
renderer version changed
preview settings changed
cache file missing
```

否则直接使用缓存。

---

# 28. Cache 不应阻塞主线程

图片处理尤其 PDF rasterization 应避免运行在 React 主线程。

结构：

```text
React UI
   ↓
ImageService
   ↓
Background Worker / Backend
   ↓
Cache
```

UI 可以先显示：

```text
Loading image...
```

生成完成后局部刷新。

---

# 29. Preview 生命周期

建议：

```text
FigureComponent mounted
        ↓
resolveGraphicPath()
        ↓
check cache
      /     \
    hit     miss
     ↓        ↓
 display    background render
               ↓
             cache
               ↓
         update component
```

---

# 30. 避免整个 Preview 重渲染

图片参数改变：

```text
width changed
```

不应导致：

```text
re-render whole document
```

应该尽量：

```text
patch source
↓
update Figure node
↓
re-render FigureComponent
```

至少 React 层需要：

```text
stable block ID
memoized block component
```

---

# 31. 多图 / Subfigure 支持

v0.4.1 必须支持常见的多图 Preview。

例如：

```text
A | B
-----
C | D
```

即：

```text
2 × 2
```

---

# 32. 多图对象层级

内部：

```text
FigureObject
├── SubfigureObject A
│   └── ImageObject
├── SubfigureObject B
│   └── ImageObject
├── SubfigureObject C
│   └── ImageObject
├── SubfigureObject D
│   └── ImageObject
├── Caption
└── Label
```

注意：

```text
Figure Caption
```

和：

```text
Subfigure Caption
```

必须分离。

---

# 33. Subfigure Preview

例如：

```latex
\begin{figure}
    \centering

    \begin{subfigure}{0.48\textwidth}
        \includegraphics[width=\linewidth]{a.png}
        \caption{Method A}
    \end{subfigure}
    \begin{subfigure}{0.48\textwidth}
        \includegraphics[width=\linewidth]{b.png}
        \caption{Method B}
    \end{subfigure}

    \caption{Comparison}
\end{figure}
```

Preview：

```text
┌────────────┐ ┌────────────┐
│     A      │ │     B      │
│            │ │            │
└────────────┘ └────────────┘
   (a) Method A    (b) Method B

        Figure 4. Comparison
```

---

# 34. 多图整体编辑

点击整个 Figure：

Inspector：

```text
MULTI-FIGURE
────────────────────

Layout
[ 2 columns ▼ ]

Gap
[ normal ▼ ]

Alignment
[ Center ▼ ]

Figure Width
[ 100% ]

Float
[ h ][t][b][p]

Main Caption
[ Comparison ]

Main Label
[ fig:comparison ]

Subfigures
4

[ Edit Layout ]
```

---

# 35. Layout Editor

点击：

```text
Edit Layout
```

打开：

```text
Layout

Columns
[ 2 ]

Rows
[ Auto ]

Horizontal Gap
[ 0.02\textwidth ]

Vertical Gap
[ 1em ]

Equal Width
☑

Auto Fit
☑
```

第一版不需要实现复杂自由拖拽布局。

优先支持：

```text
1×2
1×3
2×2
2×3
3×2
```

以及：

```text
auto-wrap
```

---

# 36. 点击单个 Subfigure

点击某个子图：

```text
┌────────────┐
│ selected A │
└────────────┘
```

Inspector：

```text
SUBFIGURE
────────────────────

Image
a.png

Width
[ 0.48 ][\textwidth]

Image Width
[ \linewidth ]

Caption
[ Method A ]

Label
[ fig:method-a ]

Alignment
[ Center ▼ ]

[ Replace Image ]

[ Advanced ]
```

这样：

```text
整体 Figure
```

与：

```text
单个 Subfigure
```

拥有不同 Inspector。

---

# 37. 多图布局修改原则

如果原源码可以安全理解，例如：

```latex
\begin{subfigure}{0.48\textwidth}
```

GUI 可以修改宽度。

但如果遇到复杂布局：

```latex
\begin{minipage}{\dimexpr...}
```

或者：

```latex
\hfill
\raisebox
custom macro
```

则应进入：

```text
Partially Editable
```

模式。

显示：

```text
This figure uses custom layout code.

Basic properties can still be edited.
For full control, open Source.
```

不能强行把复杂源码转换成 TeXWeave 标准模板。

---

# 38. 新建多图 Figure

Insert Image 菜单增加：

```text
Insert
├── Image
└── Multi-image Figure
```

Multi-image：

```text
Choose images
[ Add files... ]

Layout
● 1 × 2
○ 2 × 2
○ 1 × 3
○ Auto

Width
[ Auto ]

☑ Sub-captions
☑ Main caption
☑ Labels

[ Insert ]
```

选择四张图片时：

```text
2 × 2
```

可自动成为默认推荐。

---

# 39. 自动生成多图源码

例如 2×2：

```latex
\begin{figure}[htbp]
    \centering

    \begin{subfigure}{0.48\textwidth}
        \centering
        \includegraphics[width=\linewidth]{figures/a.png}
        \caption{}
        \label{fig:a}
    \end{subfigure}
    \hfill
    \begin{subfigure}{0.48\textwidth}
        \centering
        \includegraphics[width=\linewidth]{figures/b.png}
        \caption{}
        \label{fig:b}
    \end{subfigure}

    \begin{subfigure}{0.48\textwidth}
        \centering
        \includegraphics[width=\linewidth]{figures/c.png}
        \caption{}
        \label{fig:c}
    \end{subfigure}
    \hfill
    \begin{subfigure}{0.48\textwidth}
        \centering
        \includegraphics[width=\linewidth]{figures/d.png}
        \caption{}
        \label{fig:d}
    \end{subfigure}

    \caption{}
    \label{fig:figure}
\end{figure}
```

具体默认间距可以由 Project Settings 控制。

---

# 40. 多图模板设置

Project Settings：

```text
Images
└── Multi-image Defaults
```

例如：

```text
Default columns
[ Auto ]

Subfigure width
[ Auto ]

Horizontal gap
[ \hfill ]

Vertical gap
[ 1em ]

Image width inside subfigure
[ \linewidth ]

☑ Center subfigures
☑ Add subcaptions
☑ Add labels
```

---

# 41. Preview 中的选择层级

多图存在层级点击问题。

建议：

第一次点击子图：

```text
select Subfigure
```

点击空白 / 外框：

```text
select Figure
```

Selection Outline 可以区分：

```text
Figure selection
Subfigure selection
Image selection
```

但不要用过多颜色。

可以通过边框层级和 Inspector 标题区分。

---

# 42. 双击行为

建议：

```text
Single click
→ select object

Double click
→ open primary editor
```

如果设置：

```text
Default Editor = GUI
```

双击仍停留 GUI，但将焦点放入 Inspector。

如果：

```text
Default Editor = Source
```

双击直接进入 local source。

---

# 43. Source / Preview 同步

当 Source 中修改：

```latex
\caption{New caption}
```

Preview Figure 应自动更新。

当 GUI 中修改 Caption：

```text
New caption
```

Source 对应位置同步更新。

两种编辑方式必须操作同一 AST / source model。

不能存在：

```text
GUI Figure State
```

和：

```text
Source Figure State
```

两套独立状态。

---

# 44. Figure Parser

建议新增：

```text
FigureParser
```

负责：

```ts
parseFigureEnvironment()
parseIncludeGraphics()
parseCaption()
parseLabel()
parsePlacement()
parseAlignment()
parseSubfigure()
```

解析结果不负责文件加载。

---

# 45. Image Service

新增：

```text
ImageService
```

职责：

```text
resolve path
detect format
read metadata
generate preview
manage cache
watch source file
```

不负责 Figure LaTeX AST。

---

# 46. Figure Inspector

```text
FigureInspector
```

职责：

```text
render basic GUI
modify AST properties
open advanced source
switch figure/subfigure context
```

---

# 47. 推荐模块结构

```text
src/
├── figure/
│   ├── parser/
│   │   ├── figureParser.ts
│   │   ├── imageParser.ts
│   │   └── subfigureParser.ts
│   │
│   ├── model/
│   │   ├── FigureObject.ts
│   │   ├── ImageObject.ts
│   │   └── SubfigureObject.ts
│   │
│   ├── preview/
│   │   ├── FigurePreview.tsx
│   │   ├── ImagePreview.tsx
│   │   ├── MultiFigurePreview.tsx
│   │   └── MissingImage.tsx
│   │
│   ├── inspector/
│   │   ├── FigureInspector.tsx
│   │   ├── ImageInspector.tsx
│   │   ├── SubfigureInspector.tsx
│   │   └── FigureSourceEditor.tsx
│   │
│   ├── insert/
│   │   ├── insertImage.ts
│   │   ├── importImage.ts
│   │   └── insertMultiFigure.ts
│   │
│   └── services/
│       ├── imageResolver.ts
│       ├── imageCache.ts
│       └── imagePreviewRenderer.ts
```

---

# 48. v0.4.1 Settings

建议项目级配置：

```json
{
  "images": {
    "defaultDirectory": "figures",

    "defaultInsert": {
      "type": "figure",
      "width": "0.8\\textwidth",
      "alignment": "center",
      "placement": "htbp",
      "addCaption": true,
      "addLabel": true
    },

    "editor": {
      "defaultMode": "gui"
    },

    "multiFigure": {
      "defaultColumns": "auto",
      "subfigureWidth": "auto",
      "imageWidth": "\\linewidth",
      "horizontalGap": "\\hfill",
      "verticalGap": "1em"
    }
  }
}
```

---

# 49. Label 建议

v0.4.1 可以提供简单 deterministic label suggestion。

例如：

```text
simulation_power.png
```

建议：

```text
fig:simulation-power
```

如果冲突：

```text
fig:simulation-power-2
```

但完整 Label Intelligence 留到 v0.4.x 后续版本。

---

# 50. 不属于 v0.4.1 的内容

为控制 Scope，本版本暂不完整实现：

```text
TikZ GUI editor
PGFPlots GUI editor
PSTricks
SVG path editor
image annotation
freeform canvas layout
complex crop GUI
full visual minipage editor
custom macro visual editor
```

对于：

```latex
\begin{tikzpicture}
```

仍然通过正常 LaTeX compile / PDF Preview 处理。

---

# 51. 关键异常测试

必须覆盖：

### 单图

```latex
\includegraphics{a.png}
```

### Figure

```latex
\begin{figure}
\includegraphics{a.png}
\end{figure}
```

### 带参数

```latex
\includegraphics[
    width=0.8\textwidth,
    angle=90
]{a.png}
```

### graphicspath

```latex
\graphicspath{{figures/}}
\includegraphics{a}
```

### Missing

```latex
\includegraphics{not-exist.png}
```

### PDF

```latex
\includegraphics{plot.pdf}
```

### Unknown option

```latex
\includegraphics[foo=bar,width=5cm]{a.png}
```

### Complex width

```latex
\includegraphics[
    width=\dimexpr\linewidth-2cm\relax
]{a.png}
```

### Subfigure

```latex
\begin{subfigure}{0.48\textwidth}
...
\end{subfigure}
```

### 2×2

四个 subfigure。

---

# 52. 性能测试

至少准备：

```text
10 images
50 images
100 images
```

测试：

```text
Preview first load
cached reload
scroll performance
single image edit
PDF image conversion
multi-image figure rendering
```

重点确认：

```text
单张图片修改
```

不会引发所有图片重新 rasterize。

---

# 53. Acceptance Criteria

v0.4.1 完成标准：

## Insertion

- Source 模式可以通过工具栏插入图片。
- Preview 模式可以通过工具栏插入 Figure Block。
- 可以从系统拖入图片。
- 外部图片默认复制进项目。
- 文件冲突不会静默覆盖。

## Configuration

- 用户可以配置默认图片目录。
- 用户可以配置默认 width。
- 用户可以配置 Figure / Inline 默认类型。
- 用户可以配置 caption / label。
- 用户可以配置 GUI / Source 默认编辑模式。

## Preview

- Preview 正常显示 PNG/JPEG/WEBP/SVG。
- PDF 图片可以正确 Preview。
- Figure 是独立 Environment Block。
- 点击 Figure 默认进入 GUI Inspector。
- 可以进入 Advanced Source。
- Source 改动与 GUI 改动双向同步。

## Errors

- 图片缺失不会导致 Preview 崩溃。
- Missing Image 有明确 Placeholder。
- 支持 Locate / Replace。
- Unsupported image 不影响其他 Blocks。

## Cache

- 图片 Preview 有项目级 Cache。
- Cache 命中时不重复转换。
- 源图片改变后 Cache 自动失效。
- PDF rasterization 不阻塞 React 主线程。

## Multi-image

- 可以 Preview 常见 Subfigure。
- 支持至少 1×2、1×3、2×2、2×3。
- 可以编辑整体 Caption / Label。
- 可以编辑整体布局。
- 可以单独选择 Subfigure。
- 可以修改单个 Subfigure 的 Image / Caption / Label / Width。
- 复杂无法安全解释的布局自动降级到 Source 编辑。

---

# 54. 最终架构原则

v0.4.1 最重要的并不是一个新的 `<img>` Component，而是正式引入：

```text
LaTeX Source
      ↓
Figure Parser
      ↓
Figure / Subfigure / Image Model
      ↓
────────────────────────────
↓             ↓             ↓
Preview       GUI           Source
Renderer      Inspector     Editor
────────────────────────────
      ↓
Minimal Source Patch
```

整个系统必须始终满足：

```text
Source is truth.
GUI is structured editing.
Preview is representation.
Cache is disposable.
```

Figure / Image 系统完成后，后续 v0.4.2 Table System 应尽可能复用相同模式：

```text
Environment Block
+
Structured Object
+
GUI Inspector
+
Advanced Source
+
Lossless Patch
```

这样 v0.4 不会变成一组彼此独立的功能补丁，而会逐渐形成统一的“Structured LaTeX Object”编辑架构。
