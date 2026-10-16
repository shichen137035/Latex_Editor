# Codex CLI 环境

设置 → AI 基础设置提供 Codex CLI 环境检测、安装/修复、路径指定和重新检测。Codex 面板中缺失或启动失败时也显示安装入口和环境设置入口。安装后继续原有登录流程。

Windows x64/ARM64 下载官方 @openai/codex npm 原生平台包，按主包的 optionalDependencies 锁定兼容版本，验证 registry.npmjs.org 来源及 SHA-512 完整性后解压。无需用户预装 Node.js/npm，也不更改全局 PATH。原生包包含厂商提供的辅助程序；先执行 --version 验证后才保存并启用路径。其他平台继续使用原有 npm 安装路径。

安装到 userData/tools/codex-cli/native，保留旧 npm 安装的兼容检测。并发请求共用一个安装任务；普通安装优先复用已检测到的环境，修复明确下载到应用管理目录，不覆盖系统环境。修复时先检查 AI 任务是否空闲，再断开连接并安装，避免中断运行中的任务。全卸载仅清理由 ownership marker 或原有 npm 包标识确认属于应用的 Codex 环境。

测试：codex-native-install.test.ts、codex-discovery.test.ts、ai-connection 桌面检查。原生下载测试无需登录或调用模型。
