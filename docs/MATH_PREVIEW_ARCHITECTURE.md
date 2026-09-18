# v0.3.1 数学预览与 Preview 编辑

## 统一数学管线

三个入口共用 `MathRenderService`：

```text
项目 .tex/.sty 宏定义
        ↓
MathMacroRegistry
        ↓
MathContext
        ↓
MathRenderService
   ├── 结构化 Preview
   ├── Source 光标/悬浮预览
   └── Preview 公式草稿预览
```

相关代码位于 `apps/desktop/src/renderer/math`。渲染器只解析受支持的声明式宏，不执行 TeX 或 shell。

`MathMacroRegistry` 按主文件依赖顺序扫描项目内的 `\input`、`\include` 和本地 `\usepackage` 文件，支持：

- `\newcommand`
- `\renewcommand`
- `\providecommand`
- `\DeclareMathOperator`

打开的 `.tex`、`.sty` 编辑缓冲区会覆盖磁盘快照，因此公式预览不要求先保存文件。

## Source 公式预览

`MathNodeIndex` 在 Monaco model 版本变化时解析公式区间。光标移动和鼠标悬浮只进行区间查询，不在每次 mousemove 时重新扫描全文。当前公式通过 75ms debounce 更新，暂时无效的公式使用 KaTeX 的红色错误输出显示当前输入。

支持 `$…$`、`$$…$$`、`\(…\)`、`\[…\]`，以及 equation、align、aligned、gather、multline、split、cases 等集中注册的数学环境。

## Preview 草稿和结构边界

局部编辑器维护未提交草稿；Apply 前不会修改编辑器文档，Cancel/Escape 直接丢弃。叶公式块编辑时，浮动预览从草稿而非已提交源码渲染。

普通 Enter 始终是草稿内换行。选中结构块标题后可以调用：

- `block.insertBefore`：在整个块的 `sourceStart` 前打开空草稿；默认 `Ctrl/Cmd + Enter`。
- `block.insertAfter`：在整个块的 `sourceEnd` 后打开空草稿；默认 `Shift + Enter`。

标题按钮与快捷键调用相同操作。插入点使用完整块范围，因此嵌套块的前后插入仍位于其原父级环境内。所有新增快捷键可在 Settings → Shortcuts 中修改，并按 Source、块标题和 Preview 草稿上下文区分冲突。
