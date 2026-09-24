# TeXWeave v0.4.4 技术设计：Project Directory Redesign

> 状态：开发方案  
> 范围：应用主界面 / 项目目录（Project Directory）  
> 技术栈：Electron + React + TypeScript  
> 目标：将展示型首页改造为面向大量 LaTeX 项目的高密度管理界面。

## 1. 改版目标与边界

现有界面的问题：顶部独立白色 Logo 栏实际功能有限；超大 Project Directory 横幅占用高度；列表行距及列间距过大，项目多时信息密度低；缺少收藏、置顶、筛选及批量管理。

v0.4.4 应实现：
- 合并 Logo 与应用工具栏，取消大型横幅；项目列表占据主界面的大部分高度。
- 保留 `Local workspace` 选择器，为未来 `Online workspace` / 云端空间预留入口和数据模型；**本版本不实现云同步或账户登录**。
- 提供搜索、筛选、排序、收藏（Favorite）、置顶（Pin）、紧凑列表、多选和批量操作。
- 保持当前蓝、青、白、浅银的视觉风格，弱化纯装饰区域。
- 保留原有项目创建、打开、从列表移除及磁盘删除等能力，明确区分破坏性行为。

## 2. 页面结构

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ [Logo] TeXWeave │ Global search (Ctrl+K) │ [Local workspace ▾] │ [+ New ▾] │
│                                        [Import] [Settings] [Window buttons]│
├────────────────────────────────────────────────────────────────────────────┤
│ Projects                                              24 local projects   │
│ [All 24] [Pinned 4] [Favorites 6] [Recent]                               │
│ [Search projects...]                  [Sort: Last opened ▾] [List] [Grid*] │
├────────────────────────────────────────────────────────────────────────────┤
│ □  PROJECT NAME        MAIN FILE       LOCATION       LAST OPENED  ☆  📌 ⋯│
│ □  PPAR                main.tex        D:\...\PPAR    Today        ★  📌 ⋯│
│ □  Survey on LLMs      main.tex        D:\...         Yesterday    ★  📌 ⋯│
│ ...                       独立滚动 / 按需虚拟化                         │
├────────────────────────────────────────────────────────────────────────────┤
│ ● Changes are saved locally                          TeXWeave v0.4.4     │
└────────────────────────────────────────────────────────────────────────────┘
```

`*` Grid 可仅保留界面入口或后续实现；本版以 Compact List 为默认和必需视图。不要出现无作用的控件：未实现的 Grid 入口应隐藏，而非提供空按钮。

### 2.1 高度与宽度

- 顶栏目标高度：约 56–64 px；标题与筛选区：约 110–140 px；状态栏：约 24–28 px。
- 列表使用 `flex: 1; min-height: 0; overflow: auto` 占据其余可用高度；不因条目数量增加而无限拉长外层页面。
- 单行高度：Compact 模式约 48–56 px；可选 Comfortable 模式约 64–72 px。
- 在常见 1080p 窗口中，列表应明显占主导；优先显示约 12 条以上记录，随窗口实际高度变化。
- 允许列表充分利用桌面窗口宽度，但列宽按信息价值分配，避免项目名称和时间之间出现巨大空白。路径列默认省略，悬停显示完整路径。

## 3. 顶部工具栏与工作空间

从左到右：
1. 小尺寸 Logo + `TeXWeave`，移除重复的 `Local LaTeX workspace` 副标题。
2. 全局搜索（快捷键 `Ctrl+K` / macOS `Cmd+K`）：首版搜索已登记项目的名称、主文件名、路径；不承诺正文全文索引。与列表内搜索共用搜索服务，避免两套互相冲突的逻辑。可在输入框中标识搜索范围。
3. `Local workspace ▾`：**保留**。首版下拉项为当前 `Local workspace`，可显示空间类型和本地项目数量。未来可以增加 `Online workspace`、账户和同步状态。不可点击未实现的云端入口来假装已接通。
4. `+ New project ▾`：普通点击进入项目创建；下拉菜单可提供从模板创建、打开已有文件夹（复用既有能力）。
5. `Import`：复用现有导入/打开项目能力，不与简单的“将已存在文件夹登记进最近项目”混淆。
6. `Settings`；Windows 窗口控制区遵循 Electron 自定义标题栏的拖动及系统交互规范。

窗口拖动区域必须避开按钮、搜索框和下拉菜单（`-webkit-app-region: no-drag`）；保留键盘可访问性。顶栏空间不足时，先折叠次要动作进入 `⋯`，不要压缩搜索到不可用。

## 4. 项目列表与行信息

### 4.1 默认列

| 列 | 内容 | 行为 |
|---|---|---|
| 选择 | Checkbox | 支持单选及批量选择；表头全选当前过滤后的可见结果 |
| Project name | 图标、项目名；可选次要信息（如主文件） | 双击打开；文本省略，悬停查看全名 |
| Main file | `main.tex` 等 | 无已设置主文件时显示 `Not set`；缺失时显示异常状态 |
| Location | 本地路径 | 单行省略；悬停完整路径；右键复制或在文件管理器中显示 |
| Last opened | 上次从 TeXWeave 打开时间 | 缺失时显示 `Never`；不要与磁盘最后修改时间混用 |
| Favorite | 空心 / 实心星标 | 点击立即切换并持久化 |
| Pin | 空心 / 实心图钉 | 点击立即切换并持久化 |
| More | `⋯` | 操作菜单 |

次要内容采用浅色细字；项目名保持视觉优先级。不要为了视觉效果给所有项目捏造 `Draft`、`Submission` 等状态；如果没有相应的用户可编辑元数据字段，隐藏状态标签。

### 4.2 行交互

- 单击空白处选中行；双击行打开；点击星标、图钉、复选框、菜单不能意外打开项目。
- 单选：点击行或 checkbox；`Ctrl/Cmd` 增减多选；`Shift` 从锚点到当前行范围选择。要与预览界面的块选择交互概念保持一致，但状态相互独立。
- `Enter` 打开唯一选中项目；多选时不执行含糊的批量打开；`Delete` 默认仅提示“从项目列表移除”，**不能无确认直接删除磁盘目录**。
- 列表右键菜单：Open / Reveal in Explorer / Copy Path / Favorite / Pin / Rename Display Name（若支持）/ Remove from List / Delete from Disk。
- 缺失路径项目不得直接尝试打开：标记 `Location missing`，可提供 Locate / Remove from List。重新定位需验证项目主文件。

## 5. 收藏与置顶：两种独立状态

**Favorite** 表示长期关注、常用；星标仅用于 `Favorites` 筛选和显示，不会在默认列表中自动升序。  
**Pin** 表示短期固定在列表顶部；置顶项目在 `All` 视图中优先于普通项目；两者互不排斥。

### 5.1 排序规则

默认选择 `Last opened` 降序。其他排序项：`Last updated`（项目文件修改时间，若尚未可靠采集则不暴露）、`Name A–Z / Z–A`、`Date added`。

默认 `All` 视图排序：
1. 先按 `isPinned` 分组：置顶组在前；
2. 每组内部应用当前排序规则；
3. 同值时按显示名称、稳定项目 ID 作为确定性次序。

`Pinned` 标签只显示置顶项目，`Favorites` 只显示收藏项目；各自内部仍沿用当前排序。`Recent` 按 Last opened 排序，**不再强制置顶优先**，避免“最近”含义失真；无打开记录的项目位于末尾或不进入 Recent（建议 Recent 排除从未打开项目）。

筛选、搜索、排序均是视图状态，不改变原始项目登记顺序和文件位置。排序及视图偏好需要跨重启保存。

## 6. 搜索、筛选及批量操作

- 搜索范围：当前工作空间中已登记项目的项目名、主文件名、路径；匹配不区分大小写；输入防抖约 150–250ms；清空恢复列表。
- 四个互斥范围 Tab：`All`、`Pinned`、`Favorites`、`Recent`。搜索词与 Tab 共同生效；角标显示该 Tab 的总量还是搜索后的数量应统一，建议显示未搜索时的全量统计，以避免数值跳动，并在结果区单独显示筛选结果数。
- 排序下拉可在上述视图中使用；视图切换不清除搜索词。
- 全选仅作用于当前已过滤结果；使用虚拟滚动时，不得误把“已挂载 DOM 行”当作“全部过滤结果”。
- 选中项目后显示浮动/固定批量工具栏：`Pin`、`Unpin`、`Favorite`、`Unfavorite`、`Remove from List`；`Delete from Disk` 放入危险操作菜单。
- 当当前筛选因批量操作而不再满足时（例如 Pinned 视图里批量取消置顶），条目从当前视图移除，选择状态按项目 ID 安全更新；操作后提供可撤销的视图元数据操作提示。

## 7. 安全的删除、移除与项目文件操作

必须区分以下操作：

| 操作 | 修改磁盘内容 | 要求 |
|---|---|---|
| Remove from List | 否 | 移除项目登记与对应显示元数据；显示可撤销 Toast 或确认框 |
| Delete from Disk | 是 | 二次确认；显示项目名和真实路径；优先移动到系统回收站；失败必须报告 |
| Rename Display Name | 否 | 只改软件中显示名称，避免用户误认为文件夹已改名 |
| Rename Folder（如支持） | 是 | 需额外处理打开文件、相对路径与失败回滚；不作为本版必需项 |

批量磁盘删除应强提醒项目数量、路径和不可预期影响，不得默认与 `Remove from List` 共享一个含糊的删除按钮。

## 8. 本地持久化及未来空间扩展

推荐使用应用级项目目录存储（例如 Electron `app.getPath('userData')` 下的 JSON 或当前项目管理持久化层），与用户真实 LaTeX 项目分离。延续已有存储时添加迁移逻辑，而不是直接覆盖旧格式。

建议的数据结构（示意）：

```ts
type WorkspaceKind = 'local' | 'online';
type ProjectId = string;

interface WorkspaceRecord {
  id: string;                // stable ID; e.g. "local-default"
  kind: WorkspaceKind;
  name: string;              // "Local workspace"
}

interface ProjectDirectoryEntry {
  id: ProjectId;             // stable ID, not array index
  workspaceId: string;
  displayName: string;
  rootPath: string;          // Local projects only. Future cloud projects use a separate locator model.
  mainFileRelativePath?: string;
  isFavorite: boolean;
  isPinned: boolean;
  dateAdded: string;         // ISO 8601
  lastOpenedAt?: string;     // ISO 8601
  lastModifiedAt?: string;   // optional, only if reliably detected
}

interface ProjectDirectoryPreferences {
  activeWorkspaceId: string;
  activeTab: 'all' | 'pinned' | 'favorites' | 'recent';
  sortBy: 'lastOpened' | 'lastModified' | 'name' | 'dateAdded';
  sortDirection: 'asc' | 'desc';
  viewDensity: 'compact' | 'comfortable';
}
```

**未来兼容性注意：** 云端项目不应直接复用 `rootPath` 作为唯一定位字段；后续通过 `workspaceId` 和新的云端 locator 扩展。用户账户凭据及 token 不应写入普通项目目录 JSON。

状态更改时及时落盘（可做短时合并写入），采用临时文件 + 原子替换或现有可靠持久化方案，避免崩溃丢失 Pin/Favorite 状态。跨平台路径比较采用系统适当的大小写规范，不用项目名做唯一键。新版本迁移默认设置 `isFavorite=false`、`isPinned=false` 并保留所有旧项目记录。

## 9. React / Electron 实现建议

- `ProjectDirectoryPage`：页面容器、布局及 tab 切换。
- `WorkspaceSwitcher`：首版 Local workspace，下拉模型可扩展。
- `ProjectToolbar`：搜索、排序、密度切换及新建/导入入口。
- `ProjectList` / `ProjectRow`：虚拟化列表、可访问的单选/多选行为。
- `BulkActionBar`、`ProjectContextMenu`、`DeleteProjectDialog`。
- `projectDirectoryService`：纯粹的过滤与排序函数、ID 集合选择管理；UI 不直接操作磁盘。
- Electron IPC：读写目录元数据、检验路径、在文件管理器中显示、回收站删除；严格校验 IPC 参数与真实路径。

几十个项目可以先使用普通列表；当项目达到数百/上千条且渲染有明显成本时启用 `@tanstack/react-virtual` 等成熟虚拟化工具。无论是否虚拟化，选中集合必须基于稳定 ID，不能依赖 DOM 顺序；排序和筛选逻辑使用纯函数，便于单元测试。

## 10. 视觉规范

- 保留当前亮蓝、青色、白银底色与圆角；页背景轻微几何圆弧只做低对比点缀。
- 去除大面积横幅、独立大型数字装饰和重复搜索框：**默认只出现一个主要搜索入口**；若保留全局 Ctrl+K 与项目内搜索两种入口，必须在视觉及范围上清晰区分。
- Pin 蓝色、Favorite 金色，仅以图标加辅助 Tooltip 表示；不能只依靠颜色区分状态，配合填充/轮廓与无障碍名称。
- 控制行高、列宽、字重和悬停态。长路径省略但可在 Tooltip/菜单查看，不发生横向撑破。
- 空目录及无搜索结果分别显示合适空状态，包含 New / Open existing folder 等可执行动作。

## 11. 异常及兼容场景

1. 项目根目录被移动、删除或无权限访问。
2. 主文件 `main.tex` 被改名、缺失、未设置。
3. 重复导入同一路径：给出打开已有项目或取消提示，避免重复记录。
4. 路径有中文、日文、空格、很长的目录名；Windows 驱动器盘符及 macOS/Linux 路径。
5. 视图筛选后所选项目消失；多选和键盘范围选择不能误操作隐藏项目。
6. Electron 窗口缩小时列逐步隐藏：首先弱化/隐藏低优先级列，将完整内容放入行详情或菜单；保留项目名、打开能力和主要操作。
7. 持久化文件损坏：尝试备份恢复，至少不能删除磁盘中的真实项目。
8. 云端空间未发布前，切换器不得显示能够触发不存在功能的选项。

## 12. 验收测试

### 布局与交互
- [ ] 顶部 Logo 和操作工具栏合并；大型横幅消失；列表占主要高度且独立滚动。
- [ ] 在 1366×768、1920×1080 及较窄窗口中，搜索、新建和打开项目保持可用；不出现明显横向溢出。
- [ ] 20、200、1000 个虚拟项目情况下，滚动、搜索、排序没有明显卡顿。
- [ ] 单击、双击、Ctrl/Cmd、Shift、多选、全选与键盘操作符合预期。

### 功能与数据
- [ ] 收藏不会自动置顶；置顶在 All 中优先展示；Recent 不受置顶影响。
- [ ] Tab + 搜索 + 排序组合正确，计数语义一致；筛选后的全选不会漏选未渲染条目。
- [ ] 收藏、置顶、排序及密度偏好在重启后保留。
- [ ] 旧版项目目录迁移无项目丢失；重名不同路径项目保持独立。
- [ ] `Local workspace` 下拉可用，未来 Online 类型接口有明确扩展位置，但本版不执行虚假云端操作。

### 安全与异常
- [ ] Remove from List 不删除本地文件；Delete from Disk 必须明确确认且优先回收站。
- [ ] 缺失路径、无权限、重名和失效主文件有明确可恢复反馈。
- [ ] 右键操作、星标和图钉不会意外触发打开；删除失败不错误更新列表状态。

## 13. 建议开发顺序

1. 重构布局、合并工具栏、移除 Hero、压缩列表。
2. 扩展存储模型并完成旧数据迁移；加入 Workspace 接口与 Local 切换器。
3. 实现 Favorite / Pin、筛选、排序及搜索。
4. 实现多选、批量操作与安全删除流程。
5. 完成异常提示、快捷键、响应式适配和大量项目性能测试。

**非本版范围：** 真正的在线工作空间与同步、账号系统、项目全文检索、项目标签/复杂工作流、自动识别 Draft/Submission、Grid 视图（可后续再加）。
