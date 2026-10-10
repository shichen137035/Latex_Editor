# 自适应主题颜色

块、特殊命令和关系图标签共用「基础色 → 语义颜色 → 组件」系统。基础色在 `resources/environments/preview-environments.json` 的 `colorPalette` 定义一次。主题无需再次列出所有环境的颜色。

系统保留基础色的色相，在 OKLab 中调整明度、彩度，并根据当前主题的 `--color-bg-panel` 测量对比度。自动模式根据背景亮度判断明暗，不依赖主题名称。生成的角色包括强调色、底色、普通边框、选中边框、标签底色和标签文字色。

## 用户配置

- 设置 → 外观 → 主题管理器：调整当前主题的颜色参数，可预览并恢复主题默认值。调整按主题独立保存，不随项目变化。
- 块管理器 → 外观：默认「随主题适应」，只需设置基础色；「固定颜色」保留六项直接指定颜色的入口。切换到固定模式会捕获当前配色，之后可以分别修改。
- 特殊命令管理器：同样支持自适应和固定模式。

固定模式中的十六进制颜色不会随主题变化。填写 CSS 变量则会继续遵循该变量的定义。固定底色上的正文使用与底色匹配的中性文字色，防止白底白字；用户指定的标签文字色保持原样。

## 主题 CSS 参数

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `--semantic-color-mode` | `auto` | `auto`、`light`、`dark` |
| `--semantic-chroma-scale` | `1` | 基础色彩度倍率，0–1.5 |
| `--semantic-accent-contrast` | `3` | 强调色与背景的目标对比度，1.5–7 |
| `--semantic-text-contrast` | `4.5` | 标签文字的目标对比度，3–12 |
| `--semantic-fill-mix` | `.04` | 块底色中强调色的比例，0–.3 |
| `--semantic-label-mix` | `.1` | 标签底色中强调色的比例，.02–.4 |
| `--semantic-border-mix` | `.24` | 边框中强调色的比例，.1–.8 |

界面把倍率和混合比例显示为百分数，CSS 中使用小数。内置深色主题略微降低彩度、提高底色和边框的混合比例。若指定背景无法达到要求的对比度，算法选择可获得的最佳对比度。

自定义主题示例：

```css
:root {
  color-scheme: dark;
  --color-bg-panel: #241d3b;
  --color-text-primary: #e9e4f3;
  --semantic-chroma-scale: .85;
  --semantic-label-mix: .14;
  --semantic-border-mix: .3;
}
```

设置界面的值覆盖主题 CSS 参数，重置后重新继承 CSS。基础色也可按需要覆盖，例如 `--env-algorithm-base: #159eae`。主题作者仍可以直接覆盖角色变量，如 `--env-algorithm-label-bg` 和 `--env-algorithm-label-text`；导入的主题 CSS 位于生成样式之后，因此显式覆盖有效。推荐优先使用参数和基础色。

## 实现边界

环境配置使用 `style.colorMode` 和 `style.baseColor`；命令配置使用 `colorMode` 和既有 `accentColor`。XML 导入导出保留颜色模式及基础色。全局偏好 `themeColorProfiles` 保存各主题的参数覆盖。

运行时按基础色缓存生成的 CSS 变量。只在切换主题、修改参数或出现新的基础色时重新计算；滚动及普通块渲染不读取每个块的 DOM 颜色。基础色和固定底色缓存有数量上限。
