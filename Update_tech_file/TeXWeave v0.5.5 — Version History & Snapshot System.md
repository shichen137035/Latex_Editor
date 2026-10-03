# TeXWeave v0.5.5

## Version History & Snapshot System

## 1. 更新目标

v0.5.5 为 TeXWeave 引入完整的本地版本历史系统，使用户能够：

- 主动创建正式版本；
- 自动保存短期恢复快照；
- 创建临时保存点；
- 查看项目历史；
- 删除历史记录；
- 将快照或临时保存转为正式版本；
- 回退整个项目；
- 回退单个文件；
- 在回退前自动保存当前状态；
- 控制 Snapshot 的数量、保存期限与生成频率；
- 在避免大量文件冗余的情况下保存多个项目状态。

本版本的核心目标不是重新实现 Git，而是提供：

> 面向 LaTeX 作者的、简单可靠、低维护成本的本地版本管理。

---

# 2. 核心历史类型

v0.5.5 将项目历史分为三种类型：

```ts
type HistoryEntryType =
  | "version"
  | "snapshot"
  | "temporary";
```

即：

```text
Project History
│
├─ Version
├─ Snapshot
└─ Temporary Save
```

三者底层可以共享完全相同的存储机制，仅在生命周期和 Metadata 上有所区别。

---

# 3. Formal Version

`Version` 是用户主动建立的正式版本。

特点：

```text
用户主动创建
具有版本号
具有标题
可以填写 Summary
长期保存
不会被自动清理
可以恢复
可以删除
可以比较
```

例如：

```text
Version 1.4

Rewrite of consistency section

Revised the assumptions and fixed-K consistency theorem.
```

---

# 4. Version Number

正式版本必须具有：

```ts
versionNumber: string;
```

注意必须使用：

```text
string
```

而不是：

```text
number / float
```

因为：

```text
1.10
```

和：

```text
1.1
```

是不同的版本号。

---

# 5. 自动版本号

创建新版本时，系统根据上一个正式版本自动建议下一个版本号。

例如：

```text
No previous version
→ 1.0
```

```text
1.0
→ 1.1
```

```text
1.4
→ 1.5
```

```text
2.3.1
→ 2.3.2
```

该行为只是：

```text
default suggestion
```

用户始终可以自行修改。

例如：

```text
Suggested:

1.9

User changes to:

2.0
```

系统不要求版本号必须严格递增。

因此允许：

```text
1.2
1.2.1
1.3
```

等用户自行组织版本历史。

---

# 6. 创建正式版本 UI

点击：

```text
Create Version
```

打开：

```text
┌─────────────────────────────────────┐
│ Create Version                      │
│                                     │
│ Version                             │
│ [ 1.4                            ]  │
│                                     │
│ Title                               │
│ [ Rewrite consistency section    ]  │
│                                     │
│ Summary                             │
│ ┌─────────────────────────────────┐ │
│ │ Revised assumptions and        │ │
│ │ fixed-K theorem.               │ │
│ └─────────────────────────────────┘ │
│                                     │
│                Cancel   Create      │
└─────────────────────────────────────┘
```

其中：

```text
Version
→ 必填

Title
→ 推荐填写

Summary
→ 可选
```

---

# 7. Version 数据结构

建议：

```ts
interface VersionEntry {
  id: string;

  type: "version";

  versionNumber: string;

  title: string;

  summary?: string;

  createdAt: string;

  manifestId: string;

  parentHistoryId?: string;
}
```

正式 Version 默认永久保留。

仅当用户主动删除时才移除。

---

# 8. Auto Snapshot

Snapshot 是系统自动产生的短期恢复点。

它主要解决：

```text
忘记建立正式版本
误操作
大量删除
程序异常
应用崩溃
错误回退
大型 AI 修改
```

等问题。

Snapshot 不属于正式版本历史，因此通常：

```text
没有正式版本号
没有用户标题
允许自动删除
```

---

# 9. Snapshot 的设计原则

Snapshot 的定位是：

> 短期保险，而不是永久档案。

因此：

```text
Snapshot
├─ 自动生成
├─ 数量有限
├─ 保存时间有限
├─ 超限自动清理
├─ 可以手动删除
├─ 可以恢复
└─ 可以转为正式 Version
```

---

# 10. Snapshot 默认配置

建议默认：

```text
Enable Auto Snapshot:
ON

Minimum Snapshot Interval:
10 minutes

Maximum Snapshots:
20

Retention:
7 days
```

实际默认值可以在测试后进一步调整。

---

# 11. Snapshot Settings

Settings 中增加：

```text
Settings
└─ Version History
   └─ Automatic Snapshots
```

包含：

```text
Enable Automatic Snapshots

Snapshot Interval

Maximum Snapshot Count

Retention Days

Create Snapshot Before Restore

Create Snapshot Before Large Delete

Create Snapshot Before AI ChangeSet

Create Snapshot Before Risky Operations
```

用户可以根据需要修改。

---

# 12. Snapshot 清理规则

Snapshot 同时受：

```text
Maximum Count
```

和：

```text
Retention Time
```

约束。

例如：

```text
Maximum = 20
Retention = 7 days
```

如果：

```text
Snapshot 数量 > 20
```

则优先删除最旧 Snapshot。

如果：

```text
Snapshot age > 7 days
```

则进入自动清理范围。

---

# 13. Snapshot 不等于 Autosave

必须明确区分：

```text
Autosave
```

和：

```text
Snapshot
```

Autosave：

```text
保存当前项目状态
防止 Editor Buffer 丢失
```

Snapshot：

```text
保存过去的历史状态
允许用户恢复
```

因此：

```text
Autosave
≠
Version History
```

---

# 14. 风险操作前 Snapshot

以下操作建议默认自动建立 Snapshot：

```text
Restore Version
Restore Snapshot

Large Block Delete

Batch Delete

Large Replace

Accept Large AI ChangeSet

Major Project Refactor
```

例如：

```text
Current Project
↓
Snapshot:
Before restoring Version 1.4
↓
Restore Version 1.4
```

这样即使用户回退错误，也可以恢复。

---

# 15. Snapshot Metadata

自动 Snapshot 可以拥有：

```ts
interface SnapshotEntry {
  id: string;

  type: "snapshot";

  createdAt: string;

  reason:
    | "interval"
    | "project-close"
    | "pre-restore"
    | "pre-delete"
    | "pre-ai-change"
    | "recovery"
    | "manual";

  description?: string;

  manifestId: string;
}
```

UI 可以显示：

```text
Automatic snapshot

Before restoring Version 1.4

Before deleting 12 blocks

Before applying AI changes
```

而不是全部只显示：

```text
Snapshot
```

---

# 16. Temporary Save

除了 Version 和 Snapshot，增加：

```text
Temporary Save
```

用于：

> 用户主动希望留一个恢复点，但又不认为它值得成为正式版本。

例如：

```text
Before testing new theorem structure
```

或者：

```text
Temporary backup before simulation rewrite
```

---

# 17. Temporary Save 特性

Temporary Save：

```text
由用户主动创建
不要求 Version Number
可以填写标题
可以恢复
可以删除
可以 Promote
```

它处于：

```text
Version
```

和：

```text
Snapshot
```

之间。

---

# 18. Temporary Save 数据结构

```ts
interface TemporaryHistoryEntry {
  id: string;

  type: "temporary";

  title?: string;

  summary?: string;

  createdAt: string;

  manifestId: string;
}
```

未来可以允许用户选择：

```text
Keep indefinitely

Delete after N days
```

但第一版不是必须。

---

# 19. Promote to Version

Snapshot 和 Temporary Save 都可以：

```text
Promote to Version
```

例如：

```text
Snapshot
2026-10-02 14:30
Before theorem rewrite
```

右键：

```text
Restore
Promote to Version
Delete
```

点击：

```text
Promote to Version
```

打开：

```text
Version
[ 1.5 ]

Title
[ Before theorem rewrite ]

Summary
[ ... ]
```

然后创建正式 Version。

---

# 20. Promote 不复制实际文件

Promote 时：

```text
Snapshot
↓
Version
```

不应该重新复制项目文件。

推荐：

```text
Snapshot Entry
      │
      ▼
Manifest 17
```

升级以后：

```text
Snapshot Entry ───┐
                  ├── Manifest 17
Version 1.5 ──────┘
```

两个历史 Entry 可以指向同一个 Manifest。

因此 Promote 操作几乎只增加 Metadata。

---

# 21. History UI

建议增加独立：

```text
History
```

侧栏。

UI 采用时间轴 + 卡片形式：

```text
TODAY

● Current

│
● Version 1.5
  Rewrite consistency section
  MANUAL VERSION
  15:41

│
● Automatic snapshot
  Before applying AI changes
  SNAPSHOT
  14:37

│
● Before simulation rewrite
  TEMPORARY
  13:02


YESTERDAY

│
● Version 1.4
  First complete theory draft
```

---

# 22. History Filters

提供：

```text
All

Versions

Snapshots

Temporary
```

并允许搜索：

```text
Version Number

Title

Summary
```

---

# 23. History Entry 操作

每条记录允许根据类型显示：

```text
Open Details

Compare

Restore

Restore Files

Delete
```

对于 Snapshot / Temporary：

```text
Promote to Version
```

对于 Version：

```text
Edit Metadata
```

可以允许修改：

```text
Title
Summary
```

但版本对应的项目内容保持不可变。

---

# 24. Version Preview

选中历史记录后显示：

```text
Version 1.4

Rewrite of consistency section

Created:
Oct 2, 2026 13:42

Summary:
Revised assumptions and theorem statements.

Changes:
3 files modified
1 file added

main.tex             Modified
references.bib       Modified
figure2.png          Added

[Compare]

[Restore...]

[Delete]
```

---

# 25. Restore

用户可以选择：

```text
Restore Entire Project
```

或者：

```text
Restore Selected Files
```

例如：

```text
Version 1.2

Restore:
☑ main.tex
☐ references.bib
☐ figures/result.png
```

这样可以避免为了恢复一个 `.tex` 文件而回退整个项目。

---

# 26. Pre-Restore Snapshot

任何 Restore 操作之前，建议自动创建：

```text
Pre-Restore Snapshot
```

例如：

```text
Current State

↓

Snapshot:
Before restoring Version 1.3

↓

Restore Version 1.3
```

这样用户可以自然：

```text
Undo Restore
```

或者从 History 恢复刚才的状态。

---

# 27. Delete

删除历史记录时：

```text
Delete Entry
```

只表示：

```text
删除 History Metadata
删除对应 Manifest Reference
```

不意味着：

```text
立即删除所有关联文件数据
```

实际文件对象是否可以删除，由后续 Garbage Collection 决定。

---

# 28. 正式 Version 删除

正式版本不会自动删除。

只有用户主动：

```text
Delete Version
```

才移除。

由于该操作可能导致长期历史丢失，建议显示确认：

```text
Delete Version 1.4?

This removes the version from project history.

Files that are also used by other versions
will not be deleted.
```

---

# 29. Snapshot 自动删除

Snapshot 可以无需逐条确认。

当超过：

```text
Retention Time
```

或者：

```text
Maximum Count
```

时自动清理。

但如果 Snapshot 已被 Promote：

```text
Version
```

则对应 Version 不受 Snapshot 清理影响。

---

# 30. Storage 核心问题

不采用：

```text
Version 1
→ copy entire project

Version 2
→ copy entire project

Version 3
→ copy entire project
```

这种方案。

否则：

```text
500 MB project
×
10 versions

≈ 5 GB
```

即使只有一个 `.tex` 文件发生变化。

---

# 31. Content-Addressed Object Store

推荐采用：

```text
Manifest
+
Content Hash
+
Object Store
```

作为底层历史存储机制。

每个文件内容根据：

```text
SHA-256
```

或等价内容 Hash 生成唯一 ID。

例如：

```text
main.tex
→ AAA

references.bib
→ BBB

figure1.png
→ CCC
```

Object Store：

```text
objects/
├─ AAA
├─ BBB
└─ CCC
```

---

# 32. Manifest

每一个历史状态拥有一个 Manifest。

例如：

```json
{
  "main.tex": "AAA",
  "references.bib": "BBB",
  "figures/result.png": "CCC"
}
```

Manifest 表示：

> 在这个历史状态下，每个项目文件对应哪个内容 Object。

---

# 33. 文件去重

假设 Version 1：

```text
main.tex            AAA
references.bib      BBB
figure.png          CCC
```

Version 2 只修改：

```text
main.tex
```

产生：

```text
DDD
```

Version 2 Manifest：

```text
main.tex            DDD
references.bib      BBB
figure.png          CCC
```

实际 Object Store：

```text
AAA
BBB
CCC
DDD
```

而不是：

```text
完整项目 A
完整项目 B
```

因此：

```text
references.bib
figure.png
```

只存一份。

---

# 34. LaTeX 项目非常适合该方案

LaTeX 项目中大量文件通常长期不变：

```text
images

sty

cls

bib

templates
```

频繁变化的主要是：

```text
tex
```

因此几十个历史版本通常不会产生几十倍存储。

---

# 35. 不建议使用 Diff Chain 作为底层存储

不建议：

```text
Version 1 = Full

Version 2 = Patch from V1

Version 3 = Patch from V2

Version 4 = Patch from V3
```

因为会产生：

```text
恢复链过长

中间 Patch 损坏影响后续版本

删除中间版本困难

实现和维护复杂
```

推荐始终：

```text
Manifest
→ Content Hash
→ Complete File Object
```

每个版本都可以独立恢复。

---

# 36. Diff 仍然用于显示

虽然底层不使用 Diff Chain，但 UI 可以正常计算：

```text
Version A
↔
Version B
```

的 Diff。

Diff 用于：

```text
Compare UI
Change Preview
Version Summary
```

而不是作为底层历史存储格式。

---

# 37. Object Compression

文本类文件可以进一步压缩：

```text
.tex
.bib
.sty
.cls
.json
```

推荐未来可使用：

```text
zstd
```

等快速压缩方式。

而：

```text
png
jpg
zip
pdf
```

等已经压缩的文件通常无需再次压缩。

第一阶段可以：

```text
先实现去重
```

之后再增加压缩。

---

# 38. Snapshot / Version / Temporary 共享 Store

三种历史类型全部使用：

```text
Shared Object Store
```

而不是：

```text
versions/
snapshots/
temporary/
```

分别保存完整文件。

统一架构：

```text
History Entry
      │
      ▼
Manifest
      │
      ▼
Content Addressed Store
```

其中：

```text
Version
Snapshot
Temporary
```

都只是不同的 History Entry 类型。

---

# 39. 推荐项目目录

项目目录：

```text
MyPaper/
├─ main.tex
├─ references.bib
├─ figures/
│
└─ .texweave/
   ├─ history/
   │  ├─ objects/
   │  ├─ manifests/
   │  └─ history.db
   │
   ├─ structure/
   └─ cache/
```

---

# 40. history.db

推荐使用：

```text
SQLite
```

管理历史 Metadata。

例如：

```text
HistoryEntry

id
type
versionNumber
title
summary
createdAt
reason
manifestId
parentHistoryId
```

SQLite 很适合这种：

```text
本地
结构化
规模较小
高可靠性
```

的数据。

---

# 41. 不应该保存进历史的内容

默认排除：

```text
*.aux

*.log

*.toc

*.out

*.synctex.gz

*.fls

*.fdb_latexmk
```

以及：

```text
PDF compile output

Preview cache

structured-preview cache

temporary files

node_modules

build outputs
```

History 应主要保存：

```text
Source

Project Assets

Project Metadata
```

---

# 42. Version Ignore Rules

建议维护内部：

```text
Version Ignore Rules
```

概念类似：

```text
.gitignore
```

但用户不需要理解 Git。

未来可以允许用户：

```text
Exclude from Version History
```

例如：

```text
large-data/

temporary-results/

generated-images/
```

---

# 43. 大文件处理

如果项目包含：

```text
500 MB dataset

200 MB image

large PDF
```

且内容未变化：

```text
不同版本共享同一个 Object
```

不会重复占用空间。

如果大文件本身真的发生变化，则需要保存新的 Object。

因此建议：

```text
Large File Warning
```

例如：

```text
Files larger than 100 MB
```

提示：

> This file will be included in version history and may significantly increase storage usage.

并允许：

```text
Exclude from Version History
```

---

# 44. History 创建性能

创建 Version / Snapshot 时不应该无条件：

```text
重新读取整个项目
重新 Hash 所有大型文件
```

推荐维护：

```ts
interface FileHistoryIndex {
  path: string;

  size: number;

  modifiedTime: number;

  lastHash: string;
}
```

如果：

```text
size unchanged
AND
modifiedTime unchanged
```

则可以直接复用：

```text
lastHash
```

只对变化文件重新计算 Hash。

---

# 45. 一般保存复杂度

假设项目：

```text
100 files
```

但从上一次 Snapshot 到现在只有：

```text
main.tex
chapter2.tex
```

发生变化。

则新 Snapshot 主要只需要：

```text
Hash main.tex

Hash chapter2.tex

Store changed objects

Create new Manifest
```

其余文件直接复用旧 Hash。

因此普通 Snapshot 创建成本应非常低。

---

# 46. Garbage Collection

删除 History Entry 后，不立即删除 Object。

后台执行：

```text
Garbage Collection
```

检查：

```text
所有 Manifest
↓
仍然被引用的 Objects
↓
未被任何 Manifest 引用的 Objects
```

只有：

```text
unreachable objects
```

才真正删除。

---

# 47. Garbage Collection 示例

假设：

```text
Snapshot A ─┐
            │
Snapshot B ─┼── Object X
            │
Version 1 ──┘
```

删除：

```text
Snapshot A
Snapshot B
```

以后：

```text
Object X
```

仍然不能删除。

因为：

```text
Version 1
```

仍然引用它。

只有所有引用消失以后才能释放。

---

# 48. History Storage UI

Settings 中增加：

```text
Version History Storage
```

显示：

```text
Storage Used
284 MB

Formal Versions
18

Snapshots
12

Temporary Saves
3
```

并提供：

```text
Clean Expired Snapshots

Optimize Storage
```

未来可以进一步显示：

```text
Source History
14 MB

Images
248 MB

Other Assets
22 MB
```

---

# 49. Optimize Storage

`Optimize Storage` 可以执行：

```text
删除过期 Snapshot

删除已标记删除的 History Entry

Garbage Collection

清理孤立 Manifest

清理未引用 Object

重建 History Index
```

但不能修改任何正式 Version 内容。

---

# 50. Block System 与 History 的关系

History 的底层恢复逻辑必须以：

```text
Project Files
```

为核心。

不能要求：

```text
Block ID
```

保持不变才能恢复。

因为：

```text
Block Structure
```

可以重新生成。

因此：

```text
File History
→ authoritative
```

而：

```text
Block History
→ optional enhancement
```

---

# 51. Future Block-aware Diff

未来可以利用 Block 系统，将普通：

```text
main.tex
+35
-22
```

增强为：

```text
Section 3
├─ Theorem 3.2       Modified
├─ Proof 3.2         Modified
└─ Equation (17)     Unchanged
```

但该功能不是 v0.5.5 Version Store 的必要依赖。

---

# 52. Branch 暂不加入

v0.5.5 不实现：

```text
Branches

Merge

Conflict Resolution

Parallel Workspaces
```

History UI 暂时采用：

```text
Linear History
```

内部可以保留：

```ts
parentHistoryId?: string;
```

为未来 Branch 功能留下空间。

但不向用户暴露复杂 Branch 模型。

---

# 53. 推荐 History Entry 总结构

```ts
interface HistoryEntry {
  id: string;

  type:
    | "version"
    | "snapshot"
    | "temporary";

  createdAt: string;

  manifestId: string;

  title?: string;
  summary?: string;

  versionNumber?: string;

  reason?: SnapshotReason;

  parentHistoryId?: string;
}
```

---

# 54. 整体架构

```text
                   Project
                      │
                      ▼
              Current Project State
                      │
        ┌─────────────┼──────────────┐
        │             │              │
        ▼             ▼              ▼
     Version       Snapshot       Temporary
        │             │              │
        └─────────────┼──────────────┘
                      ▼
                   Manifest
                      │
                      ▼
             Content Hash Mapping
                      │
                      ▼
            Content Addressed Store
                      │
              ┌───────┴────────┐
              ▼                ▼
            Compare          Restore
                               │
                               ▼
                    Pre-Restore Snapshot
```

---

# 55. 用户核心工作流

## Create

```text
Current Project

↓

Create Version

↓

Version Number
Title
Summary

↓

Save
```

---

## Automatic Recovery

```text
Working

↓

Auto Snapshot

↓

Unexpected problem

↓

History

↓

Restore Snapshot
```

---

## Temporary Save

```text
Before large experiment

↓

Save Temporary

↓

Continue editing

↓

Delete / Restore / Promote
```

---

## Restore

```text
Select History Entry

↓

Compare

↓

Restore

↓

Create Pre-Restore Snapshot

↓

Restore files
```

---

## Promote

```text
Snapshot / Temporary

↓

Promote to Version

↓

Version Number
Title
Summary

↓

Formal Version
```

---

# 56. v0.5.5 核心原则

整个版本系统应遵循：

```text
Versions are permanent user milestones.

Snapshots are temporary recovery points.

Temporary saves are lightweight user checkpoints.

Restore should always be reversible.

Identical files should never be stored repeatedly.

History metadata and file contents should be separated.

Project files remain the source of truth.
```

底层存储原则：

```text
History Entry
→ Manifest
→ Content Hash
→ Deduplicated Object
```

而不是：

```text
History Entry
→ Full Project Copy
```

也不是：

```text
History Entry
→ Long Patch Chain
```

最终使 TeXWeave 的版本管理同时满足：

```text
简单
安全
快速
节省空间
容易恢复
容易理解
可继续扩展
```

并为未来的：

```text
Block-aware Diff

AI Version Summary

Branch

Cloud History

Collaborative Versioning
```

保留扩展空间。