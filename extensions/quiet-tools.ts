/**
 * pi-quiet-tool-calls — 隐藏工具调用细节（pi 扩展）
 *
 * 默认状态（quiet）：
 *   - 所有内置工具调用（bash/read/write/edit/grep/find/ls）折叠成一行青色
 *     "⚙ tool call" 占位符；命令、参数、输出全部不显示。
 *   - 运行中显示旋转动画 + 已耗时秒数，长命令不会让用户以为卡死。
 *   - 不再有 pi 默认的大号绿/红框子。
 *
 * 展开查看：
 *   - 按 Ctrl+E（全局展开工具输出）时，占位符会临时还原为真实的命令+输出，
 *     使用 pi 内置渲染器，但仍无彩色外框。
 *
 * 切换：
 *   - /toggletools  在 quiet（隐藏）和 full（完整显示）之间切换。
 *   - pi --show-tools  启动时直接进入完整显示模式。
 *
 * 说明：
 *   - 只影响 TUI 显示；工具实际执行行为和会话内容完全不变。
 *   - 会话文件（~/.pi/sessions/*.jsonl）仍会保存完整命令与输出。
 *
 * 用法：
 *   pi install git:github.com/<user>/pi-quiet-tool-calls@v1.0.0
 *   或放入 ~/.pi/agent/extensions/ 后 /reload
 */

import type {
  ExtensionAPI,
  Theme,
  ToolDefinition,
  ToolRenderContext,
} from "@earendil-works/pi-coding-agent";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

/** true = quiet 模式（隐藏细节），false = 完整显示 */
let hidden = true;

const TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
type BuiltinName = (typeof TOOL_NAMES)[number];

// ---------------------------------------------------------------------------
// 内置工具定义（按 cwd 缓存）
// ---------------------------------------------------------------------------

type AnyToolDef = ToolDefinition<any, any, any>;

const definitionCache = new Map<string, Record<BuiltinName, AnyToolDef>>();

function getDefinitions(cwd: string): Record<BuiltinName, AnyToolDef> {
  let defs = definitionCache.get(cwd);
  if (!defs) {
    defs = {
      read: createReadToolDefinition(cwd),
      bash: createBashToolDefinition(cwd),
      edit: createEditToolDefinition(cwd),
      write: createWriteToolDefinition(cwd),
      grep: createGrepToolDefinition(cwd),
      find: createFindToolDefinition(cwd),
      ls: createLsToolDefinition(cwd),
    };
    definitionCache.set(cwd, defs);
  }
  return defs;
}

// ---------------------------------------------------------------------------
// 委托内置渲染器时需要的 per-row 缓存
// （内置渲染器依赖 lastComponent 复用 + 共享 state，需模拟 ToolExecutionComponent 的行为）
// ---------------------------------------------------------------------------

interface RowCache {
  state: Record<string, unknown>;
  callComp?: Component;
  resultComp?: Component;
}

const rowCaches = new Map<string, RowCache>();

function getRowCache(toolCallId: string): RowCache {
  let cache = rowCaches.get(toolCallId);
  if (!cache) {
    cache = { state: {} };
    rowCaches.set(toolCallId, cache);
  }
  return cache;
}

function delegateCall(
  builtin: AnyToolDef,
  args: unknown,
  theme: Theme,
  context: ToolRenderContext,
): Component {
  const cache = getRowCache(context.toolCallId);
  const comp = builtin.renderCall!(args, theme, {
    ...context,
    state: cache.state,
    lastComponent: cache.callComp,
  });
  cache.callComp = comp;
  return comp;
}

function delegateResult(
  builtin: AnyToolDef,
  result: { content: unknown[]; details: unknown },
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  context: ToolRenderContext,
): Component {
  const cache = getRowCache(context.toolCallId);
  const comp = builtin.renderResult!(result as never, options, theme, {
    ...context,
    state: cache.state,
    lastComponent: cache.resultComp,
  });
  cache.resultComp = comp;
  return comp;
}

// ---------------------------------------------------------------------------
// 占位符 + 运行中动画
// ---------------------------------------------------------------------------

/** 旋转字符帧（经典 CLI spinner） */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** 动画间隔（ms），与每帧时长一致 */
const SPINNER_INTERVAL_MS = 100;

/** 所有运行中的动画定时器，用于 session 结束时统一清理 */
const activeIntervals = new Set<ReturnType<typeof setInterval>>();

/**
 * 占位符与动画主色：青色（标准 ANSI 36）。
 * 想换色改这里的色码即可，例如：
 *   亮青 truecolor  \x1b[38;2;0;215;255m （主题变量里的 #00d7ff）
 *   品红            \x1b[35m
 */
function cyan(text: string): string {
  return `\x1b[36m${text}\x1b[39m`;
}

function placeholder(theme: Theme, context: ToolRenderContext): Component {
  const state = context.state as {
    animInterval?: ReturnType<typeof setInterval>;
    startedAt?: number;
  };

  if (context.isPartial) {
    // 命令还在跑：启动动画定时器（只启动一次），每帧触发重绘
    if (!state.animInterval) {
      state.startedAt = Date.now();
      const iv = setInterval(() => context.invalidate(), SPINNER_INTERVAL_MS);
      state.animInterval = iv;
      activeIntervals.add(iv);
    }

    const elapsedSec = Math.max(
      0,
      Math.round((Date.now() - (state.startedAt ?? Date.now())) / 1000),
    );
    const frame =
      SPINNER_FRAMES[Math.floor(Date.now() / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length];

    let text = theme.bold(cyan("⚙ tool call"));
    text += " " + cyan(frame);
    text += " " + theme.fg("dim", `${elapsedSec}s`);
    return new Text(text, 0, 0);
  }

  // 命令结束：清理动画定时器，恢复静态占位符
  if (state.animInterval) {
    clearInterval(state.animInterval);
    activeIntervals.delete(state.animInterval);
    state.animInterval = undefined;
  }
  return new Text(theme.bold(cyan("⚙ tool call")), 0, 0);
}

/** 停止动画（切到展开/完整模式时交给内置渲染器） */
function stopSpinner(context: ToolRenderContext): void {
  const state = context.state as { animInterval?: ReturnType<typeof setInterval> };
  if (state.animInterval) {
    clearInterval(state.animInterval);
    activeIntervals.delete(state.animInterval);
    state.animInterval = undefined;
  }
}

// ---------------------------------------------------------------------------
// 覆盖内置工具：行为不变，只接管渲染
// ---------------------------------------------------------------------------

function registerQuietTool(pi: ExtensionAPI, name: BuiltinName) {
  const base = getDefinitions(process.cwd())[name];

  pi.registerTool({
    ...base,
    renderShell: "self", // 完全接管外壳：不显示默认的彩色 Box

    // 执行按 ctx.cwd 委托，保证与内置行为一致
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const builtin = getDefinitions(ctx.cwd)[name];
      return builtin.execute(toolCallId, params, signal, onUpdate, ctx);
    },

    renderCall(args, theme, context) {
      const builtin = getDefinitions(context.cwd)[name];
      if (!hidden || context.expanded) {
        stopSpinner(context); // 展开/完整模式：动画交给内置渲染器
        return delegateCall(builtin, args, theme, context);
      }
      return placeholder(theme, context);
    },

    renderResult(result, options, theme, context) {
      const builtin = getDefinitions(context.cwd)[name];
      if (!hidden || context.expanded) {
        return delegateResult(builtin, result, options, theme, context);
      }
      // quiet 模式：不显示任何输出（空 Text 渲染为 0 行）
      return new Text("", 0, 0);
    },
  });
}

// ---------------------------------------------------------------------------
// 扩展入口
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // 可选 CLI flag：启动即完整显示
  pi.registerFlag("show-tools", {
    description: "Start with tool call details shown (disable quiet-tools hiding)",
    type: "boolean",
    default: false,
  });
  if (pi.getFlag("show-tools")) hidden = false;

  for (const name of TOOL_NAMES) {
    registerQuietTool(pi, name);
  }

  // 切换 quiet / full
  pi.registerCommand("toggletools", {
    description: "Toggle tool call display between quiet (placeholder) and full detail",
    handler: async (_args, ctx) => {
      hidden = !hidden;

      if (ctx.mode === "tui") {
        // 翻转全局展开状态两次，强制所有已渲染的工具行重绘
        const cur = ctx.ui.getToolsExpanded();
        ctx.ui.setToolsExpanded(!cur);
        ctx.ui.setToolsExpanded(cur);
      }

      ctx.ui.notify(
        hidden ? "Tool details hidden (quiet)" : "Tool details shown (full)",
        "info",
      );
    },
  });

  // 清理 per-row 渲染缓存与运行中的动画/计时定时器
  pi.on("session_shutdown", () => {
    for (const iv of activeIntervals) clearInterval(iv);
    activeIntervals.clear();
    for (const cache of rowCaches.values()) {
      const s = cache.state as { interval?: ReturnType<typeof setInterval> };
      if (s.interval) clearInterval(s.interval);
    }
    rowCaches.clear();
  });
}
