# pi-quiet-tool-calls

A [pi](https://github.com/earendil-works/pi-mono) extension that quiets tool calls in the TUI: instead of giant green/red boxes full of commands and output, every tool call collapses into a **single status line** that shows what the agent is doing at a glance:

```
📖 Read  · Sources/App.swift                    ✓ 3 lines · 0.1s
💻 Bash  · npm test                             ⠹ 3s
🔍 Grep  · applyIconChoice|AppIcon… in Sources  ✓ 12 matches · 0.4s
✏️ Edit  · src/index.ts · 2 edits               ✓ 2 blocks · 0.2s
📂 Find  · **/*.swift in Agent/                 ✓ 3 files · 0.2s
💻 Bash  · npm run build                        ✗ exit 2 · 0.4s
```

Each step is a **state**: icon + tool name + one-line summary while idle, spinner + elapsed seconds while running, `✓` with result stats when done, `✗` with exit code / timeout when it fails. Long-running commands never look frozen.

> Display-only: tool execution, LLM context, and session files are completely unchanged.

## Features

- **Per-state rows** — every built-in tool gets its own icon and label with a human-readable summary:
  `📖 Read` · `💻 Bash` · `🖥️ PowerShell` · `✏️ Edit` · `📝 Write` · `🔍 Grep` · `📂 Find` · `🗂️ Ls`
  - paths are shown relative to the project (`Sources/App.swift` instead of `/Users/.../Sources/App.swift`)
  - `cd dir && cmd` collapses to `cmd (in dir)`
  - `read` with an offset shows `file @120`
  - `edit` shows how many changes (`src/index.ts · 2 edits`)
- **Live status while running** — spinner + elapsed seconds (`💻 Bash · npm test ⠹ 3s`)
- **Result stats when done** — `✓ 12 matches` (grep), `✓ 3 files` (find), `✓ 42 lines` (read, incl. `lines 1-5/200` when truncated), `✓ 2 blocks` (edit), `✓ 24 items` (ls), plus duration
- **Errors at a glance** — `✗ exit 2` (bash), `✗ timeout 30s`, `✗ error`
- No more colored success/error boxes (the tool renders its own shell)
- Press `Ctrl+O` to temporarily expand and reveal the real command and output (using pi's built-in renderers, still boxless)
- `/toggletools` (or `/toggletools quiet|full`) to switch between quiet and full display
- `pi --show-tools` flag to start with full display
- Colors come from pi's theme variables (`accent`/`success`/`error`/`dim`), so it adapts to any theme (dark/light/custom)

## Install

From GitHub (recommended, pinned to a release tag):

```bash
pi install git:github.com/AkisySama/pi-quiet-tool-calls@v2.0.0
```

Try it without installing:

```bash
pi -e git:github.com/AkisySama/pi-quiet-tool-calls
```

Manual install: copy `extensions/quiet-tools.ts` into `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project-local), then `/reload`.

Remove: `pi remove git:github.com/AkisySama/pi-quiet-tool-calls`

## Usage

| Action | What it does |
|---|---|
| (default) | Tool calls show as one status line per state; output is hidden |
| running | Line animates: `💻 Bash · npm test ⠹ 3s` |
| done | `✓` + result stats + duration, e.g. `🔍 Grep · foo in src ✓ 12 matches · 0.4s` |
| error | `✗` + exit code/timeout, e.g. `💻 Bash · npm run build ✗ exit 2 · 0.4s` |
| `Ctrl+O` | Expand to see the real command + output |
| `/toggletools [quiet\|full]` | Toggle/set quiet vs full display (persisted) |
| `pi --show-tools` | Start pi with full display |

## Customizing

Everything is configurable via `~/.pi/quiet-tools.json` (auto-created on first `/toggletools`; delete it to reset):

```json
{
  "hidden": true,
  "icons": true,
  "maxSummary": 60,
  "style": {
    "read": { "icon": "📄", "label": "Read" },
    "bash": { "icon": "⚡", "label": "Shell" }
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `hidden` | `true` | Start in quiet mode |
| `icons` | `true` | Emoji icons; set `false` for plain text labels |
| `maxSummary` | `60` | Max chars of the one-line summary |
| `style` | — | Override `icon` / `label` per tool |

Set `"icons": false` if your terminal has trouble rendering emoji.

## Caveats

- **Display-only.** Session files (`~/.pi/sessions/*.jsonl`) still store full commands and output; `-p` print mode and RPC are unaffected.
- Overriding built-in tools makes pi show a diagnostic warning in interactive mode — harmless.
- `read` image results are still displayed inline in quiet mode (image rendering happens at the component level).
- Tool calls made by **custom** tools (e.g. `read_image`) are not re-registered by this extension, so their default rendering stays unchanged.

## How it works

The extension re-registers each built-in tool under the same name and delegates `execute()` to the original implementation, so behavior is identical. It only overrides rendering:

- `renderShell: "self"` drops the default colored box
- `renderCall` / `renderResult` show the status row when quiet, and delegate to pi's built-in renderers when expanded
- per-tool-call state tracks: summary (from args), `startedAt` / `finishedAt`, and result stats (parsed from the final result, e.g. match counts, exit codes, truncation ranges)
- a `setInterval` + `context.invalidate()` loop animates the spinner while `isPartial` is true; completion triggers one more frame that swaps the spinner for the final `✓`/`✗` status

## Development

```bash
npm install        # installs jiti + peer pi packages
npm test           # smoke tests + real ToolExecutionComponent render tests
```

## Security

Like any pi package, this extension runs with your full system permissions. Review the source before installing — it's a single small file.

## License

MIT

---

## 中文说明

让 pi 的工具调用安静下来，并且**一眼看清每个步骤的状态**：不是千篇一律的 `⚙ tool call`，而是每行一个状态 —— 图标 + 工具名 + 一句话摘要：

- 执行中：`💻 Bash · npm test ⠹ 3s`（旋转动画 + 已耗时）
- 完成：`🔍 Grep · foo in src ✓ 12 matches · 0.4s`（✓ + 结果统计 + 耗时）
- 出错：`💻 Bash · npm run build ✗ exit 2 · 0.4s`（✗ + 退出码 / 超时）

各工具专属图标：`📖 Read` `💻 Bash` `🖥️ PowerShell` `✏️ Edit` `📝 Write` `🔍 Grep` `📂 Find` `🗂️ Ls`。路径自动转为相对路径，`cd x && cmd` 折叠为 `cmd (in x)`，`edit` 显示改动数。

- `Ctrl+O` 临时展开查看真实命令与输出
- `/toggletools` / `/toggletools quiet|full` 随时切换（记忆到 `~/.pi/quiet-tools.json`）
- `pi --show-tools` 启动即完整显示
- 颜色取自当前主题变量，自动适配深浅色主题
- 仅影响 TUI 显示，工具执行与会话文件内容完全不变

安装：

```bash
pi install git:github.com/AkisySama/pi-quiet-tool-calls@v2.0.0
```

安装即生效，无需其他配置。

开发测试：`npm install && npm test`。
