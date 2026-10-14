# Automatic LaTeX installation / 自动安装 LaTeX 环境

## User workflow / 使用方法

Open **Settings → Project build → Advanced → Local LaTeX toolchain**. If any required tool is unavailable, the installation section opens automatically. Choose an empty installation folder or accept the default `%APPDATA%\TeXWeave\tools\TinyTeX`, then click **Install / repair tools**. Windows x64 and an Internet connection are required. Source builds additionally require their normal development dependencies; the packaged app does not need Node.js or npm for this installation.

进入 **设置 → 项目构建 → 高级 → 本地 LaTeX 工具链**。如果缺少所需工具，安装区会自动展开。选择空的安装文件夹，或采用默认的 `%APPDATA%\TeXWeave\tools\TinyTeX`，然后点击 **安装 / 修复工具**。目前支持 Windows x64，需要联网。源码启动仍需要开发依赖；发布版执行此安装不需要 Node.js 或 npm。

The installer uses the official TinyTeX-1 Windows release, verifies its published SHA-256 digest, extracts it, and uses its TeX Live package manager to install pdfLaTeX, XeLaTeX, LuaLaTeX, latexmk, BibTeX, Biber and MakeIndex with their dependencies. Perl is included in the distribution. Missing packages in the managed installation can be installed by running the same action again. Existing unrelated directories are rejected, and existing MiKTeX/TeX Live installations are not deleted or changed.

安装器下载官方 TinyTeX-1 Windows 发布包，校验公布的 SHA-256 摘要，解压后通过 TeX Live 包管理器安装 pdfLaTeX、XeLaTeX、LuaLaTeX、latexmk、BibTeX、Biber、MakeIndex 及其依赖。Perl 随发行版提供。在已由 TeXWeave 安装的目录再次执行相同操作，可以补充缺失工具。安装器拒绝修改已有的无关非空目录，不会删除或改动已有 MiKTeX / TeX Live。

Progress, cancellation and a bounded installation log are available in the panel. The main process owns the job, so closing Settings does not stop it; closing the application cancels it. All tools are checked before the app saves and activates the new toolchain. Custom folders and the bundled Perl path are used immediately and after restarting the app. The installer does not modify the system PATH. Folder names containing shell control characters such as `%`, `&`, or `!` are rejected.

安装区提供进度、取消操作和安装日志。任务由主进程管理，关闭设置窗口后仍继续，退出软件时取消。所有工具通过检测后，软件才保存并启用新工具链。自定义目录及内置 Perl 路径会立即生效，并在重启后继续使用。安装器不修改系统 PATH。文件夹名不能包含 `%`、`&`、`!` 等命令控制字符。

TinyTeX-1 includes a starter set of LaTeX packages, not every CTAN package. Document-specific fonts, packages and external programs may still be required. Third-party tools retain their own licenses. A failed or cancelled installation may leave its managed folder so it can be repaired; temporary download/extraction folders are removed.

TinyTeX-1 包含一组基础宏包，并非所有 CTAN 宏包。特定文章使用的字体、宏包和外部程序仍可能需要补充。第三方工具保留其各自许可证。失败或取消安装后可能保留受管理的安装目录以供修复；下载和解压临时目录会被清理。

## Developer interfaces / 开发接口

`LatexToolchainInstaller` in `apps/desktop/src/main/toolchain-installer.ts` owns one background job. Typed requests `settings.toolchainInstallStatus`, `settings.installToolchain(directory)` and `settings.cancelToolchainInstall` are declared in `packages/contracts/src/desktop-ipc.cts` and exposed by the shared preload bridge. The UI polls only while a job is running. Successful installation persists global toolchain paths and an `installed-by-texweave` component record.

`apps/desktop/src/main/toolchain-installer.ts` 中的 `LatexToolchainInstaller` 管理一个后台任务。类型化请求 `settings.toolchainInstallStatus`、`settings.installToolchain(directory)` 和 `settings.cancelToolchainInstall` 在 `packages/contracts/src/desktop-ipc.cts` 声明，并由共享 preload 桥接暴露。界面仅在任务运行时轮询。安装成功后保存全局工具链路径及 `installed-by-texweave` 组件记录。

Focused tests: `tests/unit/settings-toolchain-install.test.ts` covers download provenance/checksums, selected folders, protected pre-existing files, incomplete installations, repair and cancellation. No network or external installations are used by those unit tests.

专项测试：`tests/unit/settings-toolchain-install.test.ts` 覆盖下载来源与校验、目录选择、已有文件保护、不完整安装、修复和取消。单元测试不联网，也不执行外部安装。

Official references / 官方参考：

- [TinyTeX](https://yihui.org/tinytex/)
- [TinyTeX release repository](https://github.com/rstudio/tinytex-releases)
- [Official Windows installation flow](https://github.com/rstudio/tinytex/blob/master/tools/install-bin-windows.ps1)
