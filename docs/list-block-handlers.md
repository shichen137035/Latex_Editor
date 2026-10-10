# 列表块处理器

itemize、enumerate 和 description 在环境资源中绑定 `builtin.list`。名称不决定渲染行为；自建环境也可以使用该处理器。

环境的 `behavior` 配置包含：

- `renderer: "list"` 与 `blockHandler: "builtin.list"`：选择列表处理器。
- `listStyle`：ordered、unordered 或 description。
- `listMarker`：数字、字母、罗马数字、圆点等标记。
- `listItemCommand`：条目命令名称，默认 item。
- `listItemEditing`：开启条目范围的源码编辑，否则进入整个块的源码编辑。
- `listShowCount`：表头显示条目数量。

块管理器高级区域与 XML 均支持这些配置。已有的用户配置继续优先于内置默认值。

`preview/block-handlers.ts` 提供处理器注册接口，处理器负责源码条目范围解析和插入逻辑。宿主负责虚拟列表、嵌套块、编辑器、未保存草稿和源码应用。自定义处理器使用绝对 UTF-16 范围，必须保留未修改源码。

这是后续打包 JS/TS 插件的扩展入口。目前只加载随软件提供的处理器，不执行用户配置内的脚本文本；插件加载、权限、隔离和卸载机制尚未实现。
