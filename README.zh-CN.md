# pi-quiet-tool-calls

> [English](README.md) | **中文**

让 [pi](https://github.com/earendil-works/pi-mono) 的工具调用安静下来的扩展：不再是一大串绿框/红框里塞满命令和输出，每个工具调用折叠成**一行状态**，agent 在做什么一眼可见：

```
📖 Read  · Sources/App.swift                    ✓ 3 行 · 0.1s
💻 Bash  · npm test                             ⠹ 3s
🔍 Grep  · applyIconChoice|AppIcon… in Sources  ✓ 12 个匹配 · 0.4s
✏️ Edit  · src/index.ts · 2 处改动             ✓ 2 blocks · 0.2s
📂 Find  · **/*.swift in Agent/                 ✓ 3 个文件 · 0.2s
💻 Bash  · npm run build                        ✗ exit 2 · 0.4s
```

每一步都有**状态**：空闲时是「图标 + 工具名 + 一句话摘要」，执行中显示转圈动画 + 已耗时，完成后 `✓` + 结果统计，失败时 `✗` + 退出码/超时/错误原因。长时间运行的命令看起来永远不会卡死。

> 纯显示层改动：工具执行、LLM 上下文、会话文件完全不受影响。

## 功能特性

- **按工具区分的状态行** —— 每个内置工具都有专属图标和可读摘要：
  `📖 Read` · `💻 Bash` · `🖥️ PowerShell` · `✏️ Edit` · `📝 Write` · `🔍 Grep` · `📂 Find` · `🗂️ Ls`
  - 路径自动转为相对项目路径（`Sources/App.swift` 而不是 `/Users/.../Sources/App.swift`）
  - `cd dir && cmd` 折叠为 `cmd (in dir)`
  - `read` 带 `offset` 时显示 `file @120`
  - `edit` 显示改动数量（`src/index.ts · 2 处改动`）
- **执行中实时状态** —— 转圈动画 + 已耗时（`💻 Bash · npm test ⠹ 3s`）
- **完成后的结果统计** —— `✓ 12 个匹配`（grep）、`✓ 3 个文件`（find）、`✓ 42 行`（read，截断时显示 `lines 1-5/200`）、`✓ 2 blocks`（edit）、`✓ 24 items`（ls），外加耗时
- **错误信息一目了然** —— `✗ exit 2`（bash）、`✗ timeout 30s`；没有状态码时直接显示真实错误首行：`✗ Path not found: …/a.md`、`✗ bash: npm: command not found`
- **统计更准确** —— pi 追加的 `[...]` 提示行（`N entries limit reached`、`64KB limit reached` 等）不会混进数量统计
- **展开提示** —— 完成/出错行尾部带淡色的 `Ctrl+O` 提示（可用 `"expandHint": false` 关闭）
- 不再有彩色成功/失败大框（工具渲染自己的外壳）
- 按 `Ctrl+O` 临时展开，查看真实命令与输出（复用 pi 内置渲染器，依然无框）
- `/toggletools`（或 `/toggletools quiet|full`）随时切换安静/完整显示
- `pi --show-tools` 启动即完整显示
- 缓存有上限（工具行 512 条、工具定义 8 个 cwd），长会话内存占用稳定
- 颜色取自 pi 主题变量（`accent`/`success`/`error`/`dim`），自动适配深浅色主题

## 安装

从 GitHub 安装（推荐，固定到发布 tag）：

```bash
pi install git:github.com/AkisySama/pi-quiet-tool-calls@v2.1.0
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
| 执行中 | 行尾动画：`💻 Bash · npm test ⠹ 3s` |
| 完成 | `✓` + 结果统计 + 耗时，如 `🔍 Grep · foo in src ✓ 12 个匹配 · 0.4s` |
| 出错 | `✗` + 退出码/超时/错误原因，如 `💻 Bash · npm run build ✗ exit 2 · 0.4s` |
| `Ctrl+O` | 展开查看真实命令 + 输出 |
| `/toggletools [quiet\|full]` | 切换/设置安静 vs 完整显示（持久保存） |
| `pi --show-tools` | 启动 pi 即完整显示 |

## 自定义配置

通过 `~/.pi/quiet-tools.json` 配置（首次执行 `/toggletools` 时自动创建；删除文件即可恢复默认）：

```json
{
  "hidden": true,
  "icons": true,
  "maxSummary": 60,
  "expandHint": true,
  "style": {
    "read": { "icon": "📄", "label": "Read" },
    "bash": { "icon": "⚡", "label": "Shell" }
  }
}
```

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `hidden` | `true` | 启动时是否为安静模式 |
| `icons` | `true` | 是否显示 emoji 图标，`false` 使用纯文本标签 |
| `maxSummary` | `60` | 摘要最大字符数 |
| `expandHint` | `true` | 完成/出错行是否显示 Ctrl+O 展开提示 |
| `style` | — | 按工具覆盖 `icon` / `label` |

文件里只会写入**非默认值**；删除文件永远恢复默认。终端渲染 emoji 有问题时，设置 `"icons": false`。

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
- 每个工具调用行有自己的状态：摘要（来自参数）、`startedAt` / `finishedAt`、结果统计（从最终结果解析：匹配数、退出码、截断范围等）
- 执行中（`isPartial`）用 `setInterval` + `context.invalidate()` 驱动转圈动画；完成后多渲染一帧，把转圈换成最终 `✓`/`✗` 状态

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
