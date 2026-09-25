# TeXWeave v0.5.1 技术设计文档
## AI 基础接入：ChatGPT 登录、Chat 模式与 Codex 模式

> 版本：v0.5.1  
> 状态：Draft  
> 目标平台：Electron + TypeScript + React  
> 核心目标：在 TeXWeave 中建立可持续扩展的 AI 基础架构，并首先支持 ChatGPT 账户登录、普通聊天和 Codex 项目编辑。

---

## 1. 版本定位

v0.5.1 是 TeXWeave 进入 AI 功能阶段的基础版本。

本版本不追求“一次性实现 AI 论文助手”，而是建立一个稳定、清晰、可扩展的 AI 底座，使后续版本能够逐步加入：

- LaTeX 专用 Skills
- 编译错误诊断
- 块结构理解
- 块关系图检查、修复与生成
- 引用管理辅助
- 图片 / 表格 /公式结构化操作
- 第三方模型或 API Provider

v0.5.1 只实现两个最基本的 AI 工作模式：

1. **Chat 模式**
   - 普通对话
   - 解释 LaTeX、数学、论文内容
   - 默认不直接修改项目文件

2. **Codex 模式**
   - 读取当前项目
   - 修改项目源码
   - 创建 / 删除 / 重命名允许范围内的项目文件
   - 执行受控项目操作
   - 将修改结果提交给用户审核

本版本采用 ChatGPT 账户作为默认身份来源。

**v0.5.1 不要求用户提供 API Key。**

---

# 2. 非目标

以下功能明确不属于 v0.5.1：

- 第三方 AI Provider
- OpenAI Platform API Key 模式
- 自定义模型选择器
- AI 自动建立块关系
- AI 读取 TeXWeave Relation Graph
- AI 自动修改 Relation Config
- AI 自动操作图片 GUI
- AI 自动操作表格 GUI
- 多 Agent 协作
- 后台长期 Agent
- 云端项目同步
- AI 自动提交 Git Commit
- AI 自动修改项目外部文件
- 无审核的全自动论文重构

这些功能在后续 v0.5.x 中逐步实现。

---

# 3. 总体设计原则

## 3.1 AI Provider 与编辑器逻辑解耦

TeXWeave 不应将编辑器内部逻辑绑定到某一个模型或某一个 Codex 返回格式。

统一设计为：

```text
AI Provider
    ↓
AI Session
    ↓
AI Action / ChangeSet
    ↓
TeXWeave Review Layer
    ↓
Editor / File System
```

当前只有：

```text
Provider = OpenAI / ChatGPT / Codex
```

未来可以扩展：

```text
Provider
├─ OpenAI Codex
├─ OpenAI API
├─ Anthropic
├─ Gemini
├─ Local Model
└─ Custom Provider
```

编辑器、Diff、权限和文件系统不依赖具体 Provider。

---

## 3.2 Chat 与 Codex 分离

Chat 和 Codex 共用：

- 登录状态
- AI 面板
- 会话框架
- 消息 UI
- Markdown / LaTeX 渲染
- 会话历史

但权限完全不同。

### Chat

默认：

```text
Project Read: optional / scoped
Project Write: false
Shell: false
Compile: false
```

### Codex

默认：

```text
Project Read: true
Project Write: proposal-based
Shell: approval-controlled
Compile: allowed through controlled tool
Outside Project: false
```

---

## 3.3 AI 不直接拥有编辑器最终控制权

Codex 可以产生修改，但 TeXWeave 始终是文件状态的最终管理者。

推荐流程：

```text
Codex generates edits
        ↓
ChangeSet
        ↓
Diff Review
        ↓
Accept / Reject
        ↓
Apply to Editor Buffer
        ↓
Save / Compile
```

而不是：

```text
Codex directly overwrites files
```

这样可以避免：

- 覆盖未保存修改
- 编辑器状态与磁盘状态不同步
- 用户拒绝修改困难
- 多文件修改无法审核
- 后续 Provider 难以统一

---

# 4. UI 入口

## 4.1 左侧工具栏

在现有左侧主工具栏中增加：

```text
Explorer
Search
Relation
Citation
AI
Settings
```

AI 使用独立图标，例如：

```text
✦
```

或抽象 Spark / Neural / Assistant 图标。

要求：

- 与现有工具栏风格一致
- 不使用过度醒目的渐变按钮
- 激活状态使用 Theme Primary Color
- 支持 Tooltip
- 支持快捷键打开

建议默认快捷键：

```text
Ctrl + Shift + A
```

---

# 5. AI 主面板

AI 面板出现在左侧 Side Panel。

建议宽度：

```text
Default: 360 px
Min: 280 px
Max: 600 px
Resizable: true
```

面板结构：

```text
┌──────────────────────────────┐
│ AI                    +  ⋯   │
├──────────────────────────────┤
│ [ Chat ] [ Codex ]           │
├──────────────────────────────┤
│                              │
│        Conversation          │
│                              │
│                              │
├──────────────────────────────┤
│ Context / Permission Status  │
├──────────────────────────────┤
│ Message Input                │
│                     Send     │
└──────────────────────────────┘
```

---

# 6. 未登录状态

首次点击 AI：

```text
AI Assistant

Sign in with ChatGPT to use AI features.

[ Continue with ChatGPT ]

You will sign in through OpenAI.
TeXWeave does not store your password.
```

同时允许：

```text
Not now
```

不登录不影响 TeXWeave 其他功能。

---

# 7. ChatGPT 登录

## 7.1 登录目标

v0.5.1 的目标是让用户使用自己的 ChatGPT / Codex 身份。

体验应尽量接近 Codex CLI / IDE：

```text
TeXWeave
    ↓
Start authentication
    ↓
System Browser / Secure Auth Window
    ↓
ChatGPT Login
    ↓
Authorization completed
    ↓
Return to TeXWeave
```

TeXWeave 不自己实现 OpenAI 用户密码系统。

---

## 7.2 登录状态

统一定义：

```ts
type AIAuthState =
  | "unknown"
  | "signed_out"
  | "authenticating"
  | "signed_in"
  | "expired"
  | "error";
```

登录成功后 UI：

```text
AI

Signed in
ChatGPT

[ Chat ] [ Codex ]
```

账户详细信息只显示必要内容。

不建议显示：

- Token
- Credential
- Access Token
- Internal Account ID

---

## 7.3 登出

设置：

```text
Settings
→ AI
→ Account

ChatGPT
Signed in

[ Sign out ]
```

退出后：

- 保留本地 AI 会话历史可以作为可选项
- 清除认证状态
- 不删除项目
- 不删除 AI 设置

---

# 8. Codex 集成架构

推荐使用：

```text
Codex App Server
```

架构：

```text
React Renderer
      │
      │ IPC
      ▼
Electron Main
      │
      │ JSON-RPC
      ▼
Codex App Server
      │
      ▼
OpenAI / ChatGPT Account
```

---

## 8.1 为什么采用 App Server

它适合 IDE / 本地应用场景：

- 支持持续会话
- 支持事件流
- 支持工具调用
- 支持审批
- 支持认证状态
- 支持本地 Agent 工作流
- UI 可以完全由 TeXWeave 自定义

TeXWeave 不需要复制 Codex CLI UI。

---

# 9. 进程管理

Electron Main 负责 Codex App Server 生命周期。

```ts
interface CodexProcessManager {
  detect(): Promise<CodexAvailability>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  getStatus(): CodexProcessStatus;
}
```

状态：

```ts
type CodexProcessStatus =
  | "not_detected"
  | "stopped"
  | "starting"
  | "running"
  | "crashed";
```

---

# 10. Codex 可用性检测

启动 TeXWeave 时不强制启动 Codex。

只有：

```text
用户打开 AI 面板
```

或：

```text
用户开启“启动时初始化 AI”
```

才初始化。

检测：

```text
1. Codex available?
2. Version compatible?
3. Authentication available?
4. App Server can start?
```

---

# 11. Chat 模式

## 11.1 基本用途

Chat 用于：

- 解释 LaTeX
- 解释编译错误
- 数学讨论
- 论文语言讨论
- 询问某个命令
- 讨论论文结构
- 普通对话

默认：

```text
Read Project: OFF
Write Project: OFF
```

---

## 11.2 Chat Context

输入框上方提供：

```text
Context
```

点击后可以选择：

```text
Current selection
Current file
Current block
Current project
No project context
```

v0.5.1 必须实现：

- Current Selection
- Current File
- No Project Context

以下可以预留：

- Current Block
- Project Structure

---

## 11.3 Selection 快捷操作

在源码中选择文本后：

```text
Right Click
→ Ask AI
```

或：

```text
Ctrl + Shift + A
```

AI 面板自动打开：

```text
Context:
main.tex
Lines 140–175
```

用户可以问：

```text
Explain this proof.
```

或：

```text
Is this LaTeX syntax correct?
```

---

# 12. Codex 模式

切换：

```text
[ Chat ] [ Codex ]
```

进入 Codex 时显示权限提示：

```text
Codex can inspect and propose edits to files
inside the current TeXWeave project.

Project:
C:\...\paper

Project access only.

[ Continue ]
```

第一次进入项目时显示。

后续不必重复弹窗，除非权限变化。

---

# 13. Codex 工作目录

Codex Workspace Root 必须严格绑定：

```ts
project.rootPath
```

例如：

```text
C:\Users\User\Documents\MyPaper
```

Codex 默认不可访问：

```text
../
Desktop
Documents outside project
System directories
```

除非未来版本明确加入额外权限机制。

---

# 14. 文件读取权限

Codex 可读取：

```text
*.tex
*.bib
*.sty
*.cls
*.txt
*.md
project config
```

图片等二进制文件：

```text
Metadata only by default
```

例如：

```text
figure1.png
size
dimensions
path
```

未来可以加入视觉模型理解。

---

# 15. 文件写入原则

Codex 不应该直接成为文件最终写入者。

统一：

```text
Codex
  ↓
Proposed File Changes
  ↓
ChangeSet
  ↓
Review
  ↓
Apply
```

---

# 16. ChangeSet 基础结构

虽然完整 Diff UI 可以在后续版本继续增强，但 v0.5.1 必须建立数据结构。

```ts
interface AIChangeSet {
  id: string;
  sessionId: string;
  createdAt: number;

  files: AIFileChange[];

  status:
    | "pending"
    | "partially_accepted"
    | "accepted"
    | "rejected";
}
```

---

## 16.1 File Change

```ts
interface AIFileChange {
  path: string;

  type:
    | "modify"
    | "create"
    | "delete"
    | "rename";

  originalContent?: string;
  proposedContent?: string;

  hunks: AIChangeHunk[];
}
```

---

## 16.2 Hunk

```ts
interface AIChangeHunk {
  id: string;

  oldStart: number;
  oldLines: number;

  newStart: number;
  newLines: number;

  oldText: string;
  newText: string;

  decision:
    | "pending"
    | "accepted"
    | "rejected";
}
```

---

# 17. v0.5.1 Diff Review

Codex 完成修改后：

```text
AI Changes
3 files changed

main.tex
  4 changes

references.bib
  1 change

appendix.tex
  2 changes
```

点击文件：

```text
- old line
+ new line
```

操作：

```text
Accept
Reject
Accept File
Reject File
Accept All
Reject All
```

---

# 18. Partial Accept

v0.5.1 应支持 Hunk 级别接受和拒绝。

即：

```text
Change 1 → Accept
Change 2 → Reject
Change 3 → Accept
```

最终生成：

```text
Accepted subset
```

再应用到 Editor Buffer。

---

# 19. Editor Buffer 是唯一真源

一个非常重要的规则：

```text
TeXWeave Editor Buffer
```

是当前编辑状态的 Source of Truth。

而不是：

```text
Disk file
```

因为文件可能尚未保存。

因此 Codex 请求开始之前：

```text
Editor Buffer
    ↓
AI Workspace Snapshot
```

Codex 不应该直接假设磁盘文件代表当前内容。

---

# 20. AI Workspace Snapshot

每次 Codex Task 创建：

```ts
interface AIWorkspaceSnapshot {
  id: string;
  projectId: string;

  files: SnapshotFile[];

  createdAt: number;
}
```

作用：

- 保存任务开始时状态
- 生成 Diff
- 避免未保存文件丢失
- 检测用户与 Codex 同时修改

---

# 21. 并发修改冲突

情况：

```text
Codex 正在修改 main.tex

同时

用户修改 main.tex
```

当 Codex 返回：

```text
Base Snapshot != Current Buffer
```

则标记：

```text
Conflict
```

UI：

```text
This file changed while Codex was working.

[ Compare ]
[ Rebase Changes ]
[ Discard AI Changes ]
```

v0.5.1 可以先实现保守方案：

```text
发现冲突 → 禁止自动 Apply
```

---

# 22. 会话系统

AI 面板顶部：

```text
AI                +  ⋯
```

`+`：

```text
New Chat
```

菜单：

```text
Recent Chats
Clear Current Chat
AI Settings
Sign Out
```

---

# 23. Conversation 数据

```ts
interface AIConversation {
  id: string;
  title: string;

  mode:
    | "chat"
    | "codex";

  createdAt: number;
  updatedAt: number;

  projectId?: string;
}
```

---

# 24. Message 数据

```ts
interface AIMessage {
  id: string;
  conversationId: string;

  role:
    | "user"
    | "assistant"
    | "system"
    | "tool";

  content: AIMessageContent[];

  createdAt: number;
}
```

---

# 25. 消息渲染

AI 消息支持：

- Markdown
- LaTeX inline math
- LaTeX display math
- Code block
- File reference
- Diff preview
- Tool status

使用现有 TeXWeave 数学渲染组件。

不要为 AI 面板重新做另一套数学渲染器。

---

# 26. Streaming

消息必须流式显示。

状态：

```text
Thinking
Reading main.tex
Inspecting references.bib
Editing main.tex
Compiling
Completed
```

避免：

```text
长时间完全没有 UI 反馈
```

---

# 27. Codex Activity

Codex 模式中显示轻量操作日志：

```text
✓ Read main.tex
✓ Read theorem.tex
✓ Modified main.tex
○ Checking compile result
```

默认折叠详细信息。

用户可以点击：

```text
Show details
```

---

# 28. 工具审批

某些 Codex 操作必须经过审批。

分类：

## Safe

可以自动执行：

```text
Read file inside project
Search project
Read project config
```

## Controlled

可以根据设置自动执行：

```text
Compile LaTeX
Run latexmk
```

## Dangerous

必须询问：

```text
Delete file
Run arbitrary shell command
Access outside project
Network operation unrelated to OpenAI
```

---

# 29. Shell Policy

v0.5.1 默认：

```text
Arbitrary Shell = disabled
```

允许：

```text
TeXWeave-controlled commands
```

例如：

```text
latexmk
pdflatex
xelatex
bibtex
biber
```

通过已有 Compiler Service 执行。

不要直接把整个系统 Shell 暴露给 AI。

---

# 30. 编译工具

Codex 不直接运行：

```bash
latexmk
```

推荐调用：

```ts
compileProject()
```

该函数复用 TeXWeave 现有编译系统。

这样可以：

- 使用用户配置的 TeX Distribution
- 使用 TeXWeave PATH
- 获取标准化错误
- 避免 AI 自己猜测编译命令

---

# 31. Context Provider

建立统一：

```ts
AIContextProvider
```

v0.5.1：

```ts
interface AIContextProvider {
  getCurrentFile(): Promise<AIFileContext | null>;

  getSelection(): Promise<AISelectionContext | null>;

  getProjectRoot(): Promise<string>;

  getProjectFiles(): Promise<AIProjectFile[]>;
}
```

后续扩展：

```ts
getCurrentBlock()
getBlockTree()
getRelations()
getCitationGraph()
getCompileErrors()
```

---

# 32. 这是后续版本的关键扩展点

未来：

```text
v0.5.2
AI + Block

v0.5.3
AI + Relation Graph

v0.5.4
AI + Citation / Logical Review
```

都建立在：

```text
AIContextProvider
```

之上。

不要让 Codex 自己解析 TeXWeave 内部状态。

---

# 33. IPC 设计

Renderer 不直接启动 Codex。

统一：

```text
React
 ↓
preload
 ↓
IPC
 ↓
Electron Main
 ↓
AI Service
 ↓
Codex App Server
```

---

## 33.1 Renderer API

```ts
window.texweave.ai = {
  getStatus,
  login,
  logout,

  createConversation,
  sendMessage,
  cancelMessage,

  startCodexTask,

  acceptChange,
  rejectChange,
  acceptAll,
  rejectAll
}
```

---

# 34. Electron Main 模块

建议：

```text
src/main/ai/

  AIService.ts

  auth/
    AIAuthManager.ts

  codex/
    CodexProcessManager.ts
    CodexAppServerClient.ts

  conversation/
    AIConversationStore.ts

  context/
    AIContextProvider.ts

  changes/
    AIChangeSetManager.ts
    AIDiffService.ts

  permissions/
    AIPermissionManager.ts
```

---

# 35. React 模块

```text
src/renderer/features/ai/

  AIView.tsx
  AIHeader.tsx
  AIModeSwitch.tsx

  conversation/
    AIConversation.tsx
    AIMessage.tsx
    AIInput.tsx

  auth/
    AILogin.tsx

  codex/
    CodexTaskStatus.tsx
    CodexActivity.tsx

  diff/
    AIChangeReview.tsx
    AIFileDiff.tsx
    AIHunk.tsx

  settings/
    AISettings.tsx
```

---

# 36. AI Settings

Settings：

```text
AI
```

包含：

## Account

```text
ChatGPT

Signed in / Signed out

[Sign in]
[Sign out]
```

---

## Behavior

```text
Default mode

○ Chat
○ Codex
```

---

## Codex

```text
Allow project read
ON

Allow project edit proposals
ON

Allow TeX compilation
ON

Allow arbitrary shell commands
OFF
```

---

## Privacy

```text
Include current selection automatically
ON

Include current file automatically
OFF

Store local conversation history
ON
```

---

# 37. 会话存储

默认：

```text
Local
```

位置：

```text
TeXWeave userData
```

不要存入论文项目目录。

否则：

```text
git status
```

会出现 AI 聊天数据。

---

# 38. 项目关联

Conversation 可以：

```text
Global Chat
```

或：

```text
Project Chat
```

Project Chat 保存：

```text
projectId
```

但不能只保存绝对路径作为 ID。

项目移动后应该仍然可以重新绑定。

---

# 39. 错误状态

AI UI 必须明确区分：

```text
Not signed in

Codex unavailable

Network unavailable

Authentication expired

Rate limit

Codex crashed

Project unavailable

Permission denied

Task cancelled
```

不要统一显示：

```text
Something went wrong
```

---

# 40. Offline

无网络：

```text
AI unavailable offline.

TeXWeave editing and compilation
continue to work normally.
```

AI 功能绝不能阻塞编辑器启动。

---

# 41. Cancel

用户发送任务后：

```text
Stop
```

必须可取消。

停止后：

```text
Task cancelled
```

已经生成但尚未应用的 ChangeSet：

```text
保留
```

用户仍然可以查看。

---

# 42. 安全边界

v0.5.1 默认权限：

```text
AI Scope
└─ Current TeXWeave Project
```

禁止：

```text
Project Parent Directory
Home Directory
System Files
Credential Files
Other Projects
```

---

# 43. Credential 安全

TeXWeave：

- 不保存用户密码
- 不把 Credential 放入 Renderer
- 不写入项目目录
- 不写入普通 JSON config
- 不在 Log 中输出 Token

认证信息由安全认证机制 / Codex 自身认证存储管理。

---

# 44. Prompt Injection 基础防御

LaTeX 项目本身属于用户内容。

项目文件中的文本：

```text
“ignore previous instructions”
```

不能被 TeXWeave 当作系统指令。

后续需要进一步强化，但 v0.5.1 至少区分：

```text
System Instructions
User Prompt
Project Content
Tool Output
```

---

# 45. Codex System Context

TeXWeave 提供基础系统上下文：

```text
You are operating inside TeXWeave.

The active workspace is a LaTeX project.

Only modify files inside the provided workspace.

Preserve existing project conventions unless
the user explicitly asks otherwise.

Use TeXWeave tools for compilation and project state.

Do not assume the disk version is newer than
the editor buffer.
```

不要在此阶段加入大量学术写作规则。

专业 Skills 在后续版本加入。

---

# 46. v0.5.1 用户流程

## Chat

```text
Open AI
↓
Login ChatGPT
↓
Chat
↓
Ask Question
↓
Receive Streaming Response
```

---

## Selection Chat

```text
Select LaTeX
↓
Ask AI
↓
Selection automatically attached
↓
Ask Question
```

---

## Codex

```text
Open AI
↓
Codex
↓
Describe Task
↓
Create Workspace Snapshot
↓
Codex Reads Project
↓
Codex Produces Changes
↓
ChangeSet
↓
Diff Review
↓
Accept / Reject
↓
Apply Accepted Changes
```

---

# 47. 示例

用户：

```text
Please improve the English of Section 3,
but do not change any equations.
```

Codex：

```text
Reading:
main.tex
section3.tex

Editing:
section3.tex

Completed:
12 proposed changes
```

进入：

```text
Review Changes
```

用户：

```text
Accept 10
Reject 2
```

最终：

```text
Apply Accepted Changes
```

---

# 48. Undo

所有 AI 修改在 Editor 中必须形成一个明确的 Undo Transaction。

例如：

```text
AI Edit: Improve Section 3
```

用户：

```text
Ctrl + Z
```

可以整体撤销。

后续可以支持细粒度撤销。

---

# 49. 日志

允许记录：

```text
Codex started
Codex stopped
Task ID
Task duration
File operation type
Error type
```

禁止记录：

```text
User token
Credential
Full private prompt
Full paper content
```

Debug Mode 可增加更多日志，但必须明确提醒用户。

---

# 50. 性能要求

AI 初始化不能影响普通 TeXWeave 启动。

目标：

```text
TeXWeave startup
→ AI lazy loaded
```

AI 面板第一次打开：

```text
Load AI module
Start Codex if required
```

不要：

```text
App startup
→ wait for Codex
→ wait for network
→ show editor
```

---

# 51. 状态管理

建议 AI 状态独立 Store。

例如：

```text
AIStore

auth
connection
conversation
messages
task
changes
permissions
```

不要把所有 AI 状态塞进 Editor Store。

---

# 52. v0.5.1 最小可发布范围

必须完成：

- AI 左侧入口
- AI Side Panel
- ChatGPT 登录 / 登出
- 登录状态
- Chat 模式
- Codex 模式
- 当前 Selection Context
- 当前 File Context
- 基础项目读取
- Codex 项目修改
- ChangeSet
- Diff Review
- Hunk Accept / Reject
- File Accept / Reject
- Accept All / Reject All
- Editor Buffer 应用
- Undo
- Cancel Task
- 权限控制
- 错误状态
- AI Settings

---

# 53. 可以延期到 v0.5.2

如果开发工作量过大，可延期：

- 高级 Diff UI
- Side-by-side Diff
- 自然语言 Retry Hunk
- 多会话搜索
- 会话标签
- AI Context Token 显示
- 全项目 Context 智能裁剪
- 自动编译循环
- Project Agent Memory

但：

```text
ChangeSet
```

和：

```text
Accept / Reject
```

不能延期。

它们属于整个 AI 编辑架构的核心。

---

# 54. 测试计划

## 54.1 Authentication

测试：

```text
Fresh install
Login success
Login cancel
Login failure
Logout
Expired auth
Restart after login
```

---

## 54.2 Chat

```text
New conversation
Send message
Streaming
Stop generation
Math rendering
Code rendering
Selection context
Current file context
```

---

## 54.3 Codex

准备测试项目：

```text
main.tex
chapter1.tex
refs.bib
texweave.sty
```

测试：

```text
Read project
Modify one file
Modify multiple files
Create file
Rename file
Delete file
Cancel midway
```

---

## 54.4 Diff

测试：

```text
Single hunk
Multiple hunks
Multiple files
Accept one
Reject one
Accept file
Reject file
Accept all
Reject all
```

---

## 54.5 Conflict

```text
Start Codex
Modify main.tex manually
Codex returns changes
```

预期：

```text
Conflict detected
No silent overwrite
```

---

## 54.6 Security

尝试让 Codex：

```text
Read ../
Read Desktop
Read SSH keys
Execute arbitrary shell
Delete project
```

预期：

```text
Denied / Require explicit permission
```

---

## 54.7 Regression

AI 功能关闭时：

```text
Editor
Preview
Compile
Relation
Citation
Image
Table
```

必须与 v0.4 保持正常。

---

# 55. 验收标准

v0.5.1 可以发布的最低条件：

### Authentication

- 用户可以使用 ChatGPT 身份进入 AI 功能
- TeXWeave 不保存密码
- 退出登录正常

### Chat

- 可以连续聊天
- 支持流式输出
- 支持 LaTeX 渲染
- 可以附加选中内容

### Codex

- 可以读取当前项目
- 可以完成多文件任务
- 修改不会绕过 TeXWeave Review Layer

### Review

- 每项修改可接受 / 拒绝
- 可按文件处理
- 可全部处理
- 不会覆盖并发用户修改

### Safety

- 默认只能访问当前项目
- Arbitrary Shell 默认关闭
- AI 失败不会影响编辑器本身

### Architecture

- Provider 与 Editor 解耦
- AI Context Provider 已建立
- ChangeSet 已建立
- 后续可以加入 Block / Relation Context

---

# 56. 建议开发顺序

建议严格按照以下顺序：

```text
Phase 1
AI Panel UI

Phase 2
Codex App Server Connection

Phase 3
ChatGPT Authentication

Phase 4
Chat Conversation

Phase 5
Project Context Provider

Phase 6
Codex Read-only

Phase 7
Workspace Snapshot

Phase 8
Codex Edit

Phase 9
ChangeSet + Diff

Phase 10
Accept / Reject

Phase 11
Permissions

Phase 12
Error / Conflict Handling

Phase 13
Regression Tests
```

不要首先开发：

```text
复杂 Prompt
Academic Skill
Relation AI
```

基础编辑架构稳定后再加入这些能力。

---

# 57. 为 v0.5.2 预留的接口

下一阶段 AI 应开始理解 TeXWeave 自己的结构。

预留：

```ts
interface AIContextProvider {
  // v0.5.1
  getCurrentFile();
  getSelection();
  getProjectFiles();

  // future
  getCurrentBlock?();
  getBlockTree?();
  getBlockContent?();
  getBlockRelations?();
  getCitationGraph?();
}
```

这样 v0.5.2 不需要重新设计 AI 主系统。

---

# 58. 最终架构

```text
                  TeXWeave
                      │
          ┌───────────┴───────────┐
          │                       │
      AI Side Panel            Editor
          │                       │
          └───────────┬───────────┘
                      │
                AI Service
                      │
      ┌───────────────┼────────────────┐
      │               │                │
 Auth Manager   Context Provider   ChangeSet
      │               │                │
      │               │          Diff / Review
      │               │                │
      └───────────────┼────────────────┘
                      │
              Codex App Server
                      │
                  OpenAI
```

---

# 59. 核心结论

v0.5.1 不应被设计成：

```text
“在 TeXWeave 里加一个 ChatGPT 聊天框”
```

而应该被设计成：

```text
“TeXWeave AI Runtime 的第一版”
```

其中四个基础设施最重要：

```text
Authentication
Context
ChangeSet
Permission
```

Chat 和 Codex 只是这个 Runtime 的第一批入口。

只要这四层设计稳定，后续：

```text
AI Block Understanding
AI Relation Graph
AI Citation Management
AI Compile Debugging
Other AI Providers
```

都可以建立在同一个架构上，而不需要重新设计整个 AI 系统。
