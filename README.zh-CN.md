# pi-quiet-tool-calls

> [English](README.md) | **中文**

让 [pi](https://github.com/earendil-works/pi-mono) 的工具调用安静下来的扩展：不再是一大串绿框/红框里塞满命令和输出，每个工具调用折叠成**一行状态**，agent 在做什么一眼可见：

```
✓  Read        Sources/App.swift                                  3 lines · 0.1s
⠹  Bash        npm test                                                       3s
✓  Grep        applyIconChoice|AppIcon… in Sources             12 matches · 0.4s
✓  Edit        src/index.ts · 2 edits                            2 blocks · 0.2s
✓  Find        **/*.swift in Agent/                               3 files · 0.2s
×  Bash        npm run build                                       exit 2 · 0.4s
```

默认使用 **minimal 极简外观**：状态符号固定在左侧，工具名与摘要对齐，结果和耗时靠右。已完成记录使用中性色，运行和失败状态突出显示。空闲时显示摘要，执行中显示转圈动画 + 已耗时，完成后 `✓` + 结果统计，失败时 `×` + 退出码/超时/错误原因。长时间运行的命令看起来永远不会卡死。

> 纯显示层改动：工具执行、LLM 上下文、会话文件完全不受影响。

## 功能特性

- **默认极简外观** —— 统一状态列（`·` 待执行、转圈动画执行中、`✓` 完成、`×` 失败），工具名对齐；可切回原有 emoji 外观。
  `Read` · `Bash` · `PowerShell` · `Edit` · `Write` · `Grep` · `Find` · `Ls`
  - 路径自动转为相对项目路径（`Sources/App.swift` 而不是 `/Users/.../Sources/App.swift`）
  - 目录淡化、文件名保留正常亮度；长路径优先省略中间目录（`src/components/…/Button.tsx`），尽量保留文件名、扩展名与 `@120` 行号
  - `cd dir && cmd` 折叠为 `cmd (in dir)`
  - `read` 带 `offset` 时显示 `file @120`
  - `edit` 显示改动数量（`src/index.ts · 2 处改动`）
- **单行自适应** —— 摘要按终端宽度缩短，支持中文和 emoji；优先保留状态与耗时，空间不足时省略展开提示。
- **执行中实时状态** —— 转圈动画 + 已耗时（`⠹  Bash  npm test  3s`）；安静、展开和完整模式都会记录完成时间，稍后收起详情不会增加耗时。
- **完成后的结果统计** —— `✓ 12 个匹配`（grep）、`✓ 3 个文件`（find）、`✓ 42 行`（read，截断时显示 `lines 1-5/200`）、`✓ 2 blocks`（edit）、`✓ 24 items`（ls），外加耗时
- **错误信息一目了然** —— `× exit 2`（bash）、`× timeout 30s`；没有状态码时直接显示真实错误首行：`× Path not found: …/a.md`、`× bash: npm: command not found`
- **统计更准确** —— read 行数包含空白行，grep 只统计匹配行，不计入前后上下文；目录和搜索结果的数量不包含 pi 追加的 `[...]` 提示行。
- **展开提示** —— 仅最近完成的一条记录显示淡色 `Ctrl+O` 提示，失败记录也适用；旧记录自动移除提示，重绘时不会重新出现（可用 `"expandHint": false` 关闭）。
- 不再有彩色成功/失败大框（工具渲染自己的外壳）
- 按 `Ctrl+O` 临时展开，查看真实命令与输出（复用 pi 内置渲染器，依然无框）
- `/toggletools`（或 `/toggletools quiet|full`）随时切换安静/完整显示
- `pi --show-tools` 启动即完整显示
- 缓存有上限（工具行 512 条、工具定义 8 个 cwd），长会话内存占用稳定
- 颜色取自 pi 主题变量（`accent`/`text`/`error`/`dim` 等），自动适配深浅色主题

## 安装

从 GitHub 安装（推荐，固定到发布 tag）：

```bash
pi install git:github.com/AkisySama/pi-quiet-tool-calls@v2.2.0
```

不安装直接试用：

```bash
pi -e git:github.com/AkisySama/pi-quiet-tool-calls
```

手动安装：把 `extensions/quiet-tools.ts` 复制到 `~/.pi/agent/extensions/`（全局）或 `.pi/extensions/`（项目级），然后 `/reload`。

卸载：`pi remove git:github.com/AkisySama/pi-quiet-tool-calls`

## 使用方法

| 操作 | 效果 |
|---|---|
| （默认） | 每个工具调用一行状态，输出隐藏 |
| 执行中 | 行首动画：`⠹  Bash  npm test  3s` |
| 完成 | `✓` + 结果统计 + 耗时，如 `✓  Grep  foo in src  12 matches · 0.4s` |
| 出错 | `×` + 退出码/超时/错误原因，如 `×  Bash  npm run build  exit 2 · 0.4s` |
| `Ctrl+O` | 展开查看真实命令 + 输出 |
| `/toggletools [quiet\|full]` | 切换/设置安静 vs 完整显示（持久保存） |
| `pi --show-tools` | 启动 pi 即完整显示 |

## 自定义配置

通过 `~/.pi/quiet-tools.json` 配置（首次执行 `/toggletools` 时自动创建；删除文件即可恢复默认）：

```json
{
  "hidden": true,
  "appearance": "minimal",
  "maxSummary": 60,
  "expandHint": true,
  "style": {
    "bash": { "label": "Shell" }
  }
}
```

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `hidden` | `true` | 启动时是否为安静模式 |
| `appearance` | `"minimal"` | 极简状态列；`"emoji"` 恢复原有图标与布局 |
| `icons` | `true` | emoji 外观下是否显示工具图标，minimal 外观忽略此项 |
| `maxSummary` | `60` | 所有工具摘要（含路径）的最大字符数，终端较窄时进一步缩短 |
| `expandHint` | `true` | 空间足够时，在最近完成的一条记录上显示 Ctrl+O 展开提示 |
| `style` | — | 两种外观都可覆盖 `label`；`icon` 仅用于 emoji 外观 |

文件里只会写入**非默认值**；删除文件永远恢复默认。设置 `"appearance": "emoji"` 可恢复原有外观，该模式下仍可用 `"icons": false` 隐藏工具图标。旧配置中的 `icons` 不会覆盖新的 minimal 默认外观；修改配置后重新加载扩展即可。

## 注意事项

- **纯显示层。** 会话文件（`~/.pi/sessions/*.jsonl`）仍保存完整命令和输出；`-p` 打印模式和 RPC 不受影响。
- 覆盖内置工具会让 pi 在交互模式下显示一条诊断警告——无害。
- 安静模式下 `read` 的图片结果仍会内联显示（图片渲染发生在组件层）。
- **自定义**工具（如 `read_image`）没有被本扩展接管，保持默认渲染。
- **未注册的工具名无法安静化。** 如果模型发出了畸形调用（工具名不是任何已注册工具），比如把整条命令当成工具名，pi 找不到对应 `ToolDefinition`，会走内置渲染器显示错误框（`Tool <name> not found`）。pi ≤ 0.85 没有给扩展留这个钩子，插件无法接管。想减少发生频率，建议使用工具调用更稳定的模型。

## 实现原理

扩展用同名重新注册每个内置工具，`execute()` 委托给原实现，行为完全一致，只覆盖渲染：

- `renderShell: "self"` 去掉默认彩色框
- 安静模式下 `renderCall` / `renderResult` 展示状态行；展开时委托给 pi 内置渲染器
- 每个工具调用行在所有显示模式下记录开始时间和最终耗时，并保存结果统计（从最终结果解析：匹配数、退出码、截断范围等）
- 执行中（`isPartial`）用 `setInterval` + `context.invalidate()` 驱动转圈动画；完成后多渲染一帧，把转圈换成最终 `✓`/`×` 状态

## 开发

```bash
npm install        # 安装 jiti + peer pi 依赖
npm test           # 冒烟测试 + 真实 ToolExecutionComponent 渲染测试
npx tsc            # 严格类型检查
```

## 安全

和所有 pi 包一样，它拥有你系统的完整权限。安装前请审阅源码——只有一个文件，很小。

## License

MIT
