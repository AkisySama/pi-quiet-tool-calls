# pi-quiet-tool-calls

A [pi](https://github.com/earendil-works/pi-mono) extension that quiets tool calls in the TUI: instead of giant green/red boxes full of commands and output, every tool call collapses into a single subtle **cyan** `⚙ tool call` placeholder.

While a command is running, the placeholder animates with a spinner and an elapsed-time counter, so long-running commands never look frozen.

> Display-only: tool execution, LLM context, and session files are completely unchanged.

## Features

- Collapses all built-in tool calls (`bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`) into one placeholder line — commands, arguments, and output stay hidden
- No more colored success/error boxes (the tool renders its own shell)
- **Live spinner + elapsed seconds** while a command runs (e.g. `⚙ tool call ⠹ 12s`)
- Press `Ctrl+E` to temporarily expand and reveal the real command and output (using pi's built-in renderers, still boxless)
- `/toggletools` command to switch between quiet and full display at any time
- `pi --show-tools` flag to start with full display

## Install

From GitHub (recommended, pinned to a release tag):

```bash
pi install git:github.com/AkisySama/pi-quiet-tool-calls@v1.0.0
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
| (default) | Tool calls show as a cyan `⚙ tool call` placeholder; output is hidden |
| running | Placeholder animates: `⚙ tool call ⠹ 12s` |
| `Ctrl+E` | Expand to see the real command + output |
| `/toggletools` | Toggle between quiet and full display |
| `pi --show-tools` | Start pi with full display |

## Customizing

The placeholder color is a single function at the top of `extensions/quiet-tools.ts`:

```typescript
function cyan(text: string): string {
  return `\x1b[36m${text}\x1b[39m`;
}
```

Swap the ANSI code to any color you like (e.g. `\x1b[38;2;0;215;255m` for bright cyan).

## Caveats

- **Display-only.** Session files (`~/.pi/sessions/*.jsonl`) still store full commands and output; `-p` print mode and RPC are unaffected.
- Overriding built-in tools makes pi show a diagnostic warning in interactive mode — harmless.
- `read` image results are still displayed inline in quiet mode (image rendering happens at the component level).

## How it works

The extension re-registers each built-in tool under the same name and delegates `execute()` to the original implementation, so behavior is identical. It only overrides rendering:

- `renderShell: "self"` drops the default colored box
- `renderCall` / `renderResult` show the placeholder when quiet and delegate to pi's built-in renderers when expanded
- A `setInterval` + `context.invalidate()` loop animates the spinner while `isPartial` is true

## Security

Like any pi package, this extension runs with your full system permissions. Review the source before installing — it's a single small file.

## License

MIT

---

## 中文说明

让 pi 的工具调用安静下来：`bash/read/write/edit/grep/find/ls` 全部折叠成一行青色 `⚙ tool call` 占位符，不再有巨大的绿/红框子。命令运行中显示旋转动画和已耗时秒数（`⚙ tool call ⠹ 12s`），长命令也不会误以为卡死。

- `Ctrl+E` 临时展开查看真实命令与输出
- `/toggletools` 随时切换隐藏/完整显示
- `pi --show-tools` 启动即完整显示
- 仅影响 TUI 显示，工具执行与会话文件内容完全不变

安装：

```bash
pi install git:github.com/<你的用户名>/pi-quiet-tool-calls@v1.0.0
```
