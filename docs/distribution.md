# Windows distribution / Windows 分发

## Build commands / 构建命令

TeXWeave 0.6.7 produces an unsigned Windows x64 portable executable. Use Node.js
22 or newer on Windows and install the locked dependencies first:

TeXWeave 0.6.7 生成未签名的 Windows x64 便携版。请在 Windows 上使用 Node.js
22 或更新版本，并先安装锁定版本的依赖：

```powershell
npm ci
npm run desktop:package:win
```

Alternatively, double-click `Build.bat` next to `Start.bat` at the repository
root. It checks Node.js, installs locked dependencies if needed, runs the same
packaging command, and keeps the window open to display success or errors.

也可以双击仓库根目录中与 `Start.bat` 同目录的 `Build.bat`。它会检查 Node.js，
在缺少依赖时安装锁定版本的依赖，调用相同的打包命令，并保留窗口显示结果或错误。

This command always rebuilds the current source, packages the application,
checks its runtime dependencies and isolated startup, and then creates the
portable executable. It does not run the full regression suite.

此命令始终重新构建当前源码，打包应用，检查运行时依赖和隔离启动，再生成便携版。
它不会运行完整回归测试。

For a release candidate, run the full release verification before packaging:

对于候选发布版，请先运行完整发行校验：

```powershell
npm run desktop:dist:win
```

That command reuses the build produced by release verification. To recheck the
latest successful package without rebuilding it:

该命令复用发行校验生成的构建。仅重新检查最近一次成功的安装包时，可以使用：

```powershell
npm run desktop:verify:package
```

## Packaging flow / 打包流程

1. Rebuild workspace packages, renderer, main process and bundled sandbox preload.
   重新构建内部包、渲染进程、主进程和沙箱预加载脚本。
2. `distribution-config.cjs` discovers runtime packages under `packages/` and maps
   each package to `node_modules/<package-name>` inside ASAR. It excludes
   `test-support`, declaration files and source maps. This handles both CommonJS
   requires and dynamic ESM imports without relying on development junctions.
   配置脚本自动发现 `packages/` 中的运行时包，并将它们映射到 ASAR 内的
   `node_modules/<包名>`；排除测试支持包、类型声明和源码映射。CommonJS 和动态
   ESM 导入均使用打包内的包路径，不依赖开发目录中的链接。
3. Build `win-unpacked/`, then check workspace exports, production dependencies,
   resources, themes, entry points and version consistency.
   先构建解包应用，检查内部包导出、生产依赖、资源、主题、入口和版本一致性。
4. Copy the application outside the repository into a temporary directory and
   launch its real `TeXWeave.exe` with a fresh temporary user profile. Require
   backend initialization, preload bridge, application IPC, project listing and
   the rendered home page to succeed. The check times out and fails explicitly
   instead of displaying a blocking startup error dialog. Temporary data is
   removed; the user's settings and projects are not used.
   将应用复制到仓库之外的临时目录，以临时用户配置启动真实程序。要求后端初始化、
   预加载桥接、应用 IPC、项目列表接口和主页渲染均成功。超时或错误会明确终止构建，
   不弹出阻塞检查的启动错误框。临时数据会清理，不使用用户现有设置和项目。
5. Create the portable executable from that verified unpacked application.
   Launch the actual portable file with another isolated profile to verify its
   self-extraction and startup. Write its SHA-256 checksum and update `latest.json`
   only after every stage succeeds.
   使用已经验证的解包应用生成便携版；再用临时配置启动最终便携文件，验证自解压及启动。
   记录 SHA-256，并仅在全部成功后更新最近成功构建的记录。

The mapping follows electron-builder's documented ASAR-relative FileSet `to`
paths: [Application contents](https://www.electron.build/v26/docs/contents/).

上述映射采用 electron-builder 官方说明的 ASAR 相对目标路径：
[应用文件打包规则](https://www.electron.build/v26/docs/contents/)。

## Outputs and diagnostics / 输出和诊断

The first build uses `release/<version>/`. If it already exists, a new
`release/<version>-<timestamp>/` directory is used. Existing builds are never
recursively deleted or overwritten by this workflow, including running copies.
`release/latest.json` records the most recent successful directory and artifact.

首次构建输出到 `release/<版本>/`；若目录已存在，则使用新的时间戳目录。
此流程不会递归删除或覆盖已有版本，包括正在运行的副本。
`release/latest.json` 记录最近一次成功构建的目录和文件。

Each successful output directory contains / 成功输出目录包含：

- `TeXWeave-<version>-x64-portable.exe`: runnable portable application / 可运行的便携版。
- `TeXWeave-<version>-x64-portable.exe.sha256`: integrity checksum / 完整性校验值。
- `win-unpacked/`: verified application layout / 已验证的应用目录。
- `startup-check.json`: startup result tied to the ASAR hash / 与 ASAR 哈希绑定的启动结果。
- `startup.log`: captured startup diagnostics / 启动诊断日志。
- `portable-startup-check.json` and `portable-startup.log`: actual portable
  startup result and diagnostics / 最终便携文件的启动结果和诊断日志。

An incomplete directory remains available for diagnosis when a stage fails.
The command exits unsuccessfully and does not update `latest.json`. Compression
can take a few minutes even when no new output appears.

构建失败时保留不完整目录供排查；命令返回失败，不更新最近成功记录。
压缩阶段即使没有新输出，也可能需要数分钟。

An optional unused output folder name can be passed with
`npm run desktop:package:win -- <folder-name>`. The internal `--skip-build` flag
is reserved for reusing an already successful source build; normal packaging
always rebuilds first.

可以通过 `npm run desktop:package:win -- <目录名>` 指定尚不存在的输出目录。
内部参数 `--skip-build` 仅用于复用已经成功完成的源码构建；常规打包始终先重建。

## Distribution behavior / 分发行为

The portable executable does not install shortcuts or register file associations.
Normal runs use Electron's per-user settings directory, and projects remain in
their original folders. The old setup installer is retired. Startup verification
covers application loading; manual beta testing is still needed for editing,
compilation, AI providers and PDF interactions on target computers.

便携版不安装快捷方式，也不注册文件关联。正常运行时使用 Electron 的用户设置目录，
项目保留在原有文件夹。旧版安装器已停用。启动校验覆盖应用加载；编辑、编译、AI 服务
和 PDF 交互仍需在目标电脑上进行内测。
