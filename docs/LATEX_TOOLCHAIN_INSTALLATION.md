# LaTeX 环境装配 / LaTeX environment assembly

设置中的环境管理器和首次启动向导使用相同安装界面。默认推荐 **MiKTeX 轻量方案**；也可以选择 **TeX Live（TinyTeX 便携方案）**。

用户可以独立勾选数学、表格与标题、中文、参考文献、绘图组件，或输入额外宏包标识。默认勾选数学和表格组件；完整宏包集默认关闭。基础编译工具始终包含 pdfLaTeX、XeLaTeX、LuaLaTeX、latexmk、BibTeX、Biber、MakeIndex。

| 组件 | 宏包 |
| --- | --- |
| 数学 | amsmath, amsfonts, mathtools |
| 表格与标题 | caption（含 subcaption）, booktabs, multirow |
| 中文 | ctex, xeCJK, fontspec, fandol |
| 参考文献 | biblatex, csquotes, natbib |
| 绘图 | pgf（TikZ）, pgfplots, xcolor |

新建 MiKTeX 使用官方 Setup Utility 下载 basic 集合并创建独立 portable 树，不写系统 PATH 或注册表。默认路径为 `%APPDATA%\TeXWeave\tools\MiKTeX`。MiKTeX 不提供 Perl，因此从经过 SHA-256 校验的官方 TinyTeX-0 包中提取独立 Perl 运行时供 latexmk 使用。随后用 MiKTeX 的包管理器安装所选组件。完整集通过 `packages upgrade complete` 安装。MiKTeX 自动补包有独立开关，作用于所选环境。

新建 TeX Live 沿用已存在的 TinyTeX-1 下载、校验和安装接口；默认路径仍为 `%APPDATA%\TeXWeave\tools\TinyTeX`。所选组件通过 tlmgr 安装；完整集使用 `scheme-full`。TinyTeX-1 自带的基础宏包会保留，取消勾选表示不主动补装对应组件，不会删除已有宏包。

检测到兼容的现有发行版时，可勾选“为当前环境补充组件”。主进程从当前设置解析实际环境路径，不采用客户端传入的外部环境位置；不会重新安装发行版，也不会将外部环境标记为软件自有。现有环境的包管理权限、版本仓库兼容性及网络要求仍由发行版决定；错误显示在安装日志中。

安装任务由主进程管理，支持进度、日志、取消和重试，关闭设置后继续执行。验证所选组件的代表性 `.sty` 文件可被该环境的 kpsewhich 找到，并验证所有基础工具属于该环境且可执行，再保存并启用新环境。取消或失败不会切换当前环境；已下载并安装的部分组件可能保留，重试会继续补齐。

默认轻量方案不会锁定旧版二进制版本：已有 MiKTeX 环境继续使用；新安装下载官方仓库当前提供的基础发行版。环境摘要中的版本来自工具检测，并不等于 MiKTeX 安装包版本。完整宏包集只覆盖发行版仓库提供的内容，仍可能需要外部程序或系统字体。

## 接口

`settings.installToolchain(directory, selection?)`：selection 包含 `distribution: miktex|tinytex`、组件列表、额外包列表、完整集开关、MiKTeX 自动补包开关、现有环境开关。省略 selection 的旧调用继续安装原 TinyTeX 工具集。服务端验证所有选项；额外包名只允许包标识字符，不接受选项或命令。`toolchainInstallStatus` 返回当前选择和两个默认目录。现有取消接口保持一致。

测试位于 `tests/unit/settings-toolchain-install.test.ts`，界面测试为 `first-run-setup`。隔离测试覆盖组件映射、定制与完整集、外部环境保护、摘要失败、文件检查、已有接口、取消以及 Perl 路径。

官方说明：[MiKTeX Setup Utility](https://docs.miktex.org/manual/miktexsetup.html)、[MiKTeX 下载及 SHA-256](https://miktex.org/download)、[TinyTeX 发布](https://github.com/rstudio/tinytex-releases)、[TeX Live 包管理](https://tug.org/texlive/tlmgr.html)。

检测始终从同一环境目录解析引擎和辅助工具，缺少工具时显示缺失，不从其他发行版拼接。存在可用发行版时，界面默认选中该发行版并补装组件；空白系统才默认推荐 MiKTeX。MiKTeX 先查询已安装包，只补装差集；tlmgr 会跳过已安装包。用户主动取消“为当前环境补充组件”后才能创建同类新环境，完成并验证后才切换当前配置。

Windows 编译进程还会从自己的 PATH 中移除其他 TeX 发行版的工具目录，保留系统工具和独立 Perl，防止 latexmk 间接调用另一环境中的引擎或 Biber。此处理只作用于子进程，不改系统 PATH。

## TeX Live 编译时自动补包

默认开启，可在环境管理器中切换“编译时自动安装缺少的 TeX Live 宏包”。该全局开关持久化为 `texLiveAutoInstall`，对已有 TeX Live 和 TinyTeX 都生效；MiKTeX 继续使用自己的自动补包配置。

桌面编译、PDF 导出、AI 工作副本和多文档编译共用编译服务。编译失败且诊断明确指出缺少宏包文件时，在当前环境执行 kpsewhich 检查，再通过其 tlmgr 的 `search --global --file` 精确查找运行文件对应的包（例如 subcaption.sty 属于 caption）。去重后安装所需包及依赖，检查文件可用，再使用 latexmk `-g` 重编译。不会自动安装同名猜测包、下载缺失的本地 .tex/图片文件、切换发行版或跨 TeX Live 年度升级。

所有自动补包任务共用现有安装任务队列，跨项目串行执行；先前任务已装好的文件会跳过查询和安装。已有包由 tlmgr 跳过。支持取消，安装输出保存在编译日志和环境安装日志中。找不到唯一所属包、网络/权限错误或安装后文件仍不可用时，保留原始编译诊断并追加安装失败原因。单次编译最多修复 20 轮，同一文件只尝试一次，防止重试循环。

CLI 编译服务不默认开启网络操作；桌面通过 `repairMissingPackages` 依赖注入启用自动补包。专项测试：`settings-texlive-auto-install.test.ts`、`compile-package-repair.test.ts`。
