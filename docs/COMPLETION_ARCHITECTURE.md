# TeXWeave v0.2.5 联想架构

v0.2.5 的联想功能使用 Monaco Completion API 和项目级轻量索引实现。当前版本不要求用户额外安装 TexLab、LSP 服务或下载命令数据库，因此在其他机器上不会因为缺少外部组件而失效。

## 数据流

```text
Monaco 编辑器
    │
    ▼
CompletionController
    ├─ CompletionContextAnalyzer：识别命令、环境、引用、文献和文件路径上下文
    ├─ ProjectIndex：扫描项目中的 tex/sty/cls/bib 文件和项目文件树
    └─ resources/commands/latex-commands.json：常用内置命令资源
```

`CompletionController` 负责把 Monaco 的光标位置转换为建议列表，并把项目树、当前编辑器内容和已保存的项目文件交给 `ProjectIndex`。`ProjectIndex` 只识别联想所需的有限声明形式，不承担完整 TeX 解析器的职责。

## 当前支持

- 常用 LaTeX 命令：前缀匹配、基本模糊匹配和参数 snippet
- `\\begin{}` 环境：内置环境、项目中的 `\\newenvironment` 和 `\\newtheorem`
- `\\newcommand`、`\\renewcommand`、`\\providecommand`，包括 `.sty` 文件中的声明
- `\\ref{}`、`\\eqref{}`、`\\autoref{}` 的跨文件 label 联想
- `.bib` 文件中的 BibTeX/BibLaTeX key 及作者、年份、标题摘要
- `\\input{}`、`\\include{}`、`\\includegraphics{}`、`\\bibliography{}`、`\\addbibresource{}` 的项目相对路径联想
- 正文单词联想：默认开启，可在 Settings → Editor → Document Word Completion 中关闭

## 文档单词联想

文档单词联想与 LaTeX 语义联想使用不同的上下文模式。它只在 `.tex` 文件的自然语言光标位置提取单词；命令、环境、引用、文献和文件路径上下文仍由语义联想独立处理。普通单词使用 Monaco 的 Text completion 类型（通常显示为 `Aa`），不会覆盖其他语义建议。

当前实现保持轻量：使用 Unicode 单词正则扫描已加载的 `.tex` 文档，并用大小写不敏感的 `Map` 去重；没有建立词树，也没有引入外部词库或网络服务。保存后沿用现有项目索引失效机制重新扫描。这个规模足以支持当前项目级建议，未来如果文档规模显著增大，再考虑增量词频索引或 trie。

项目文件变化后，保存操作会使索引失效；下一次请求联想时会重新读取文本文件。当前编辑器内尚未保存的文件会直接使用 Monaco 中的最新内容。

## 外部语言服务的扩展

TexLab/LSP 可以在未来作为额外 provider 接入，用于更完整的包语义、诊断和工作区信息。它不是 v0.2.5 的运行时依赖，也不应被静默下载。若未来启用该 provider，应在设置中提供：

1. 是否启用外部 LaTeX 语言服务；
2. 可执行文件路径或自动检测；
3. 工作区、日志和失败原因；
4. TeXWeave 项目索引作为不可用时的回退。

这样才能保证在没有 TexLab 的机器上仍保留当前的确定性联想功能。
