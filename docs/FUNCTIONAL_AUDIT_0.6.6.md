# TeXWeave 0.6.6 功能清单与体检

检查日期：2026-10-11。范围为桌面端、CLI、共享服务、资源、设置和现有自动化检查目录。本文是代码与接口层面的审查，不是完整渗透测试、长时间压力测试或所有 LaTeX 发行版的实机兼容报告。

## 功能地图

| 功能域 | 当前能力 | 主要实现位置 |
| --- | --- | --- |
| 项目与文件 | 创建/注册/打开项目，文件树、搜索、导入、重命名、复制、删除、设置主文件、恢复最近项目；项目数据与用户数据分开保存 | `apps/desktop/src/renderer/directory`、`apps/desktop/src/main/index.ts`、`packages/application` |
| 源码编辑 | Monaco 源码编辑、多个打开文件、保存与未保存保护、撤销/重做、快捷键、补全、拼写检查、源码位置记忆 | `apps/desktop/src/renderer/editor`、`completion`、`spellcheck`、`workbench` |
| 结构化预览 | 章节、环境、特殊命令、数学、引用、列表、图片和表格的预览与局部源码编辑；块筛选、选择、移动和关系操作 | `apps/desktop/src/renderer/preview`、`figure`、`table`、`packages/editor-core` |
| 编译与 PDF | latexmk、多 TeX/PDF 目标、编译日志与诊断、PDF 阅读位置记忆、SyncTeX 正反向定位、AI 工作副本编译预览 | `packages/compiler-latexmk`、`apps/desktop/src/renderer/pdf`、`apps/desktop/src/main/project-pdfs.ts` |
| 文献与关系 | 本地 BibTeX 库、项目文献关联、引用插入与跨文件导航、条目标签、块关系图及关系提案 | `apps/desktop/src/renderer/references`、`relations`、`apps/desktop/src/main/references.ts` |
| AI | Codex/Copilot 对话、跨项目继续请求、附件、项目资源读取、块级和源码编辑、变更审查与应用/撤销、编辑后重发 | `apps/desktop/src/main/ai`、`apps/desktop/src/renderer/ai` |
| 历史与导出 | 自动/手动快照、比较、恢复、正式版本、PDF 导出、全部源码或主文件依赖源码归档 | `apps/desktop/src/main/project-history.ts`、`project-export.ts`、`apps/desktop/src/renderer/history` |
| 设置与资源 | 全局/项目设置、快捷键、设置及管理器预设、主题、环境和特殊命令配置、拼写词典、AI skills、样式资源 | `apps/desktop/src/renderer/settings`、`preview`、`apps/desktop/src/main/settings.ts` |
| 本地化 | 英语、法语、日语、哈萨克语、韩语、简体中文、繁体中文；UI 键和占位变量可静态审计 | `apps/desktop/src/renderer/i18n` |
| CLI | 项目、文件、主文件、编译、资源搜索和工具链诊断的命令行入口 | `apps/cli` |

## 当前检查结果

- 本地化静态审计：7 种语言均为 1954/1954 个键，缺失键、占位变量不匹配、未定义键和硬编码 UI 候选均为 0。README 的语言列表此前漏列哈萨克语，已更正。
- 安全边界具备 Electron sandbox、context isolation、关闭 nodeIntegration、内容安全策略、外部链接协议限制，以及项目文件路径/真实路径校验。AI 的完全访问模式仍可造成项目历史无法撤销的外部命令或文件副作用；这是明确的权限模式，使用前应由用户选择。
- 发现并修复 PDF 错误分类：读取接口原先把所有失败都返回为“文件不存在”，现在只有 `ENOENT` 返回缺失状态，权限或路径安全错误会传递给调用方显示。
- 样式资源管理器负责资源的添加、导入和管理；它没有可配置的偏好，因此管理器预设入口保持禁用，属于当前设计约束，不是失效按钮。

## 需要继续关注的缺口

| 优先级 | 发现 | 影响与建议 |
| --- | --- | --- |
| 已修复 | **环境配置的嵌套校验曾经偏浅。** 共享 contracts 现在统一校验匹配联合、颜色值、数值范围、行为字段、重复 ID 和正则模式；设置存储、预设/XML 导入、内置目录及 renderer 加载共同使用该规则。 | 错误配置会在进入预览解析之前被拒绝或回退；超范围尺寸和明显有灾难性回溯风险的自定义正则也会被拒绝。 |
| 中 | **发行检查没有包含最终安装包检查。** `verify:release` 会跑静态检查、Vitest、桌面构建和 Electron 回归；`desktop:verify:package` 是单独入口。 | 构建可通过但安装包缺文件/资源时，release gate 不一定发现。打包流程重新定位后，应把生成包的资源/启动检查接回发布门槛。 |
| 低 | **自定义 JS/TS 块处理器仍是规划项。** 当前只支持随软件提供的处理器，不会执行用户提供的脚本。 | 自定义块目前限于现有配置和内置 handler；插件权限、隔离、安装及卸载尚未实现。文档应继续把它标成未交付能力。 |
| 低 | **可视预览不是 TeX 排版引擎。** 用户宏、复杂宏包和非标准表格可能与最终排版不同。 | 这是产品边界而非编译故障；源码和真实 PDF 仍是最终依据。可继续扩充配置化 handler，但不应把预览等同于编译器。 |
| 低 | **没有做持续运行的内存曲线、真实 AI 服务与多发行版兼容矩阵。** | 相关生命周期已有针对性代码检查和自动化场景，但不能由快速静态体检推断出长期稳定性或所有机器环境均无问题。 |

## 当前已有的回归覆盖

测试目录按 AI、编辑器、预览、项目、文献、编译和设置分区；此外有项目文件/历史/导出的服务集成测试、真实编译器测试、CLI 流程和 Electron 用户交互回归。当前 Electron 清单覆盖多 PDF、SyncTeX、长预览、搜索筛选、引用、图片、表格、AI 审查、退出保存和资源设置等主要流程。完整入口见 [测试说明](TESTING.md) 与 `apps/desktop/scripts/electron-check-catalog.mjs`。

原始审计仅运行了本地化静态审计，没有运行真实 LaTeX 编译器、AI 服务、安装器或内存压力检查。后续环境配置修复通过 contracts 构建、桌面端类型检查和内置环境目录校验；定向 Vitest 启动时被 Windows `EPERM: realpath` 错误阻断，测试本身未执行。
