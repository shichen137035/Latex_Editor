# AI 源码编辑与差异审阅

AI 在项目工作副本中修改源文件或调用共享块接口。请求结束后比较工作副本与请求开始时的源文本，产生可应用、接受、撤销或拒绝的变更片段。原始项目的未保存文本由工作文档快照提供。

## 精细块编辑

对局部修改，优先调用 `get_block_source`，然后调用 `replace_block_range`：

```json
{
  "blockId": "从查询结果取得的块 ID",
  "expectedRevision": 7,
  "start": 12,
  "end": 17,
  "expectedText": "被替换原文",
  "content": "新的文字"
}
```

`start/end` 为返回的 `content` 内的 UTF-16 偏移，起点包含、终点不包含。相同起止位置表示插入，空 `content` 表示删除该范围。版本或原文不匹配时必须重新读取。编辑仍检查块类型和 LaTeX 外壳；结构块通过内容子块编辑。

接口同时用于桌面 IPC、Codex 和 Copilot。小范围操作沿用源码写入、结构索引刷新和变更审阅流程。整块替换接口继续保留，变更统计由最终文本决定，与写入操作的范围无关。

## 行级差异

共享差异实现采用 Myers，并在较大编辑距离下使用唯一未变行作为 patience 锚点。保留附近的上下文供审阅与安全应用；增删行数不包含未变上下文。算法有工作量上限，无法找到安全锚点的极端重写会保留完整范围，以保证修改内容可审阅和完整应用。

这是与 [Git 差异算法](https://git-scm.com/docs/diff-algorithm-option.html) 相同的设计思路，不要求用户项目建立 Git 仓库。实现与 Git/VS Code 的具体启发式不保证逐项相同。

文本源码使用原文件一致的 LF 或 CRLF 风格；只改变换行编码不会产生内容修改报告。混合换行文件保留实际差异，不自动推断格式。

验证位于 `ai-edit-review.test.ts`、`document-structure.test.ts`、`ai-composer.test.ts` 和 `ai-change-controller.test.ts`，覆盖长文章分散编辑、较密集编辑、重复行、范围/版本冲突、换行格式以及应用和撤销。
