# Interface help / 界面帮助

Press **F1**, click **?** on the project home page, or click **Help** at the bottom of the workspace activity bar to toggle interface help. The existing workspace shortcut **Ctrl+Shift+7** also starts or exits help. F1 can be reassigned in the shortcut manager.

按 **F1**、点击项目主页的 **?**，或点击工作区左侧工具栏底部的 **帮助**，即可开启或关闭界面帮助。原有的工作区快捷键 **Ctrl+Shift+7** 也可开启或退出。F1 可在快捷键管理器中修改。

Hover over or click a region to highlight it and read its purpose. **Previous / Next** visits the visible regions or controls at the current navigation level. Inspection intercepts clicks and editing/build commands, so exploring does not create projects, change files or start compilation. Scroll to explore more of the current page. Press **Esc**, use the close button or toggle help again to resume work. Help is temporary and is not restored after restarting the application.

悬浮或点击界面区域，即可高亮该区域并阅读用途说明。**上一项／下一项** 按顺序浏览当前层级的可见区域或控件。帮助模式拦截点击、编辑和编译命令，避免试点时创建项目、修改文章或开始编译；仍可滚动浏览页面。按 **Esc**、点击关闭按钮或再次切换帮助即可恢复操作。帮助模式为临时状态，重启软件后不会自动开启。

Descriptions cover project creation/import, the project list, tools, files and outline, insertion and view controls, file tabs, document editing, compilation, PDF preview, resizable boundaries, status/diagnostics, and settings. Over one hundred specific controls have their own descriptions. Expand **Controls in this area** in the help card and select an entry to inspect it without running it. Related shortcuts and unavailable-state guidance appear with the explanation. Controls without a dedicated entry still inherit their surrounding region description.

说明覆盖项目创建与导入、项目列表、侧栏工具、文件与大纲、插入与视图控件、文件标签页、文章编辑、编译、PDF 预览、可调边界、状态与诊断、设置。超过一百项具体控件拥有独立说明。展开帮助卡片内的 **此工具栏的控件** 列表并点击条目，可查看其用途而不执行操作。说明同时提供相关快捷键和不可用状态提示。尚未单独配置的控件仍沿用所属区域的介绍。

For developers: `apps/desktop/src/renderer/help/topics.ts` holds the selector/topic catalog. `controlDefinitions.ts` defines scoped control selectors, localized label keys, descriptions and optional command links; `controlTopics.ts` resolves those entries in the current locale. Message-level actions use inspection-only entries to avoid enumerating long transcripts. `HelpMode.tsx` handles inspection, the region tour, focus restoration and event cleanup. Add region descriptions under `helpMode.*` and detailed descriptions under `helpDetail.*` in the locale catalogs. Listeners and geometry observers are installed only while help is active; the mode does not poll or observe the entire editor DOM. The desktop regression `help-mode` checks home and workspace entry points, safe clicks, navigation, shortcuts and cleanup.

开发说明：`apps/desktop/src/renderer/help/topics.ts` 集中管理区域选择器与说明条目。`controlDefinitions.ts` 配置控件的作用域选择器、本地化标签键、说明和可选命令链接，`controlTopics.ts` 按当前语言解析条目。消息级操作使用仅悬浮检查条目，避免枚举长对话。`HelpMode.tsx` 负责区域检查、逐项浏览、焦点恢复和事件清理。在各语言文件的 `helpMode.*` 下添加区域说明，在 `helpDetail.*` 下添加具体控件说明。事件监听和尺寸观察仅在模式开启时安装，不轮询或观察整个编辑器 DOM。桌面回归 `help-mode` 检查主页与工作区入口、点击安全性、逐项浏览、快捷键和退出清理。

## Keyboard navigation / 键盘分层浏览

Use **Left / Right** to browse regions at the same level. Press **Q** to enter the highlighted region and inspect its child regions or controls. Press **Backspace** to return to the parent region, and **Esc** to exit help. The card shows the current hierarchy and equivalent Enter details / Parent region buttons. Mouse inspection remains available; after hovering a control, keyboard navigation continues among its siblings. None of these keys activates the actual control or edits the document.

使用 **← / →** 浏览同一级区域；按 **Q** 进入高亮区域，查看内部子区域或具体控件。按 **Backspace** 返回上一级，按 **Esc** 退出帮助。卡片显示当前层级，并提供“进入详情／返回上级”按钮。仍可随时用鼠标悬浮查看；悬浮后，键盘会从该控件所在层级继续浏览。这些按键不会执行控件操作，也不会编辑文章。
