/**
 * pi-quiet-tool-calls v2 — 状态化工具折叠（pi 扩展）
 *
 * 默认状态（quiet）：
 *   默认 minimal 外观：状态符号 + 对齐工具名 + 摘要，结果与耗时靠右。
 *     ✓  Read        Sources/App.swift          42 lines · 0.1s
 *     ⠹  Bash        npm test                                3s
 *     ×  Bash        npm run build                exit 2 · 0.4s
 *   已完成记录使用中性色；执行中使用强调色，失败状态与原因使用错误色。
 *   appearance: "emoji" 可恢复工具 emoji 与原有布局。
 *   输出内容、绿色/红色大框全部隐藏。
 *
 * 展开查看：
 *   Ctrl+O（全局展开工具输出，app.tools.expand）：占位符临时还原为 pi 内置的真实
 *   命令 + 输出渲染（委托内置渲染器，无彩色外框）。
 *
 * 切换：
 *   /toggletools            在 quiet / full 之间切换
 *   /toggletools quiet|full 直接指定
 *   pi --show-tools         启动即完整显示
 *
 *
 * 配置文件 ~/.pi/quiet-tools.json（可选，自动创建，删除即恢复默认）：
 *   {
 *     "hidden": true,                 // 默认是否隐藏细节
 *     "appearance": "minimal",        // minimal（默认）或 emoji
 *     "icons": true,                  // emoji 外观下是否显示工具图标
 *     "maxSummary": 60,               // 摘要最大字符数
 *     "expandHint": true,             // 完成行是否显示 Ctrl+O 展开提示
 *     "style": {                      // 覆盖图标/标签
 *       "read":  { "icon": "📄", "label": "Read" },
 *       "bash":  { "icon": "⚡", "label": "Shell" }
 *     }
 *   }
 *
 * 说明：
 *   - 只影响 TUI 显示；工具执行、LLM 上下文与会话文件完全不变。
 *   - 颜色全部取自当前主题变量（accent/success/error/dim），自动适配深浅主题。
 *   - 已知限制：模型调用“未注册的工具名”（例如参数与工具名错位的畸形调用，
 *     或被 --no-tools 禁用的工具）时，pi 没有对应的 ToolDefinition，
 *     该行会由 pi 的默认渲染器（带边框的错误框）显示，插件无法接管。
 */

import type {
  ExtensionAPI,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  CONFIG_DIR_NAME,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createPowerShellToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  keyHint,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isAbsolute, relative, dirname, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** true = quiet（隐藏细节，默认），false = 完整显示 */
let hidden = true;
/** 默认使用状态符号；emoji 外观保留原有工具图标。 */
let appearance: "minimal" | "emoji" = "minimal";
/** emoji 外观下是否显示工具图标 */
let useIcons = true;
/** 摘要最大字符数 */
let maxSummary = 60;
/** 完成行是否显示 Ctrl+O 展开提示 */
let expandHint = true;

interface ToolStyle {
  icon: string;
  label: string;
}

const DEFAULT_STYLES: Record<string, ToolStyle> = {
  read: { icon: "📖", label: "Read" },
  bash: { icon: "💻", label: "Bash" },
  powershell: { icon: "🖥️", label: "PowerShell" },
  edit: { icon: "✏️", label: "Edit" },
  write: { icon: "📝", label: "Write" },
  grep: { icon: "🔍", label: "Grep" },
  find: { icon: "📂", label: "Find" },
  ls: { icon: "🗂️", label: "Ls" },
};

/** 未配置样式的工具（防御性回退，正常不会走到） */
const FALLBACK_STYLE: ToolStyle = { icon: "⚙", label: "Tool call" };

let styles: Record<string, ToolStyle> = { ...DEFAULT_STYLES };

interface Config {
  hidden?: boolean;
  appearance?: "minimal" | "emoji";
  icons?: boolean;
  maxSummary?: number;
  expandHint?: boolean;
  style?: Record<string, { icon?: string; label?: string }>;
}

const CONFIG_PATH = join(homedir(), CONFIG_DIR_NAME, "quiet-tools.json");

function loadConfig(): void {
  hidden = true;
  appearance = "minimal";
  useIcons = true;
  maxSummary = 60;
  expandHint = true;
  styles = { ...DEFAULT_STYLES };
  try {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
    if (typeof cfg.hidden === "boolean") hidden = cfg.hidden;
    if (cfg.appearance === "minimal" || cfg.appearance === "emoji") appearance = cfg.appearance;
    if (typeof cfg.icons === "boolean") useIcons = cfg.icons;
    if (typeof cfg.maxSummary === "number" && cfg.maxSummary > 0)
      maxSummary = Math.floor(cfg.maxSummary);
    if (typeof cfg.expandHint === "boolean") expandHint = cfg.expandHint;
    for (const [name, s] of Object.entries(cfg.style ?? {})) {
      const base = DEFAULT_STYLES[name] ?? FALLBACK_STYLE;
      styles[name] = { ...base, ...s };
    }
  } catch {
    // 无配置文件或解析失败：使用默认值
  }
}

function saveConfig(): void {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    // 只持久化非默认值：默认样式/开关不出现在文件中，删除文件即恢复默认
    const styleOverrides = Object.fromEntries(
      Object.entries(styles)
        .filter(([name, v]) => {
          const base = DEFAULT_STYLES[name];
          return base !== undefined && (base.icon !== v.icon || base.label !== v.label);
        })
        .map(([k, v]) => [k, {
          ...(v.icon !== DEFAULT_STYLES[k].icon ? { icon: v.icon } : {}),
          ...(v.label !== DEFAULT_STYLES[k].label ? { label: v.label } : {}),
        }]),
    );
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify(
        {
          ...(!hidden ? { hidden } : {}),
          ...(appearance !== "minimal" ? { appearance } : {}),
          ...(!useIcons ? { icons: useIcons } : {}),
          ...(maxSummary !== 60 ? { maxSummary } : {}),
          ...(!expandHint ? { expandHint } : {}),
          ...(Object.keys(styleOverrides).length > 0 ? { style: styleOverrides } : {}),
        },
        null,
        2,
      ),
    );
  } catch {
    // 写入失败不影响功能
  }
}

function getStyle(toolName: string): ToolStyle {
  return styles[toolName] ?? FALLBACK_STYLE;
}

// ---------------------------------------------------------------------------
// 内置工具定义（按 cwd 缓存）
// ---------------------------------------------------------------------------

const TOOL_NAMES = ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"] as const;
type BuiltinName = (typeof TOOL_NAMES)[number];
type AnyToolDef = ToolDefinition<any, any, any>;

/** 从 ToolDefinition 推导渲染上下文类型（内部类型未从包根导出） */
type RenderContext = Parameters<NonNullable<AnyToolDef["renderCall"]>>[2];
type RenderResultOptions = Parameters<NonNullable<AnyToolDef["renderResult"]>>[1];

const definitionCache = new Map<string, Record<BuiltinName, AnyToolDef>>();
/** 缓存上限（防止 cwd 频繁变化时无限增长） */
const MAX_DEFINITIONS = 8;

/** 带 LRU 淘汰的 set：命中/写入时重插到尾部，超出上限时淘汰最旧项 */
function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function getDefinitions(cwd: string): Record<BuiltinName, AnyToolDef> {
  let defs = definitionCache.get(cwd);
  if (!defs) {
    defs = {
      read: createReadToolDefinition(cwd),
      bash: createBashToolDefinition(cwd),
      powershell: createPowerShellToolDefinition(cwd),
      edit: createEditToolDefinition(cwd),
      write: createWriteToolDefinition(cwd),
      grep: createGrepToolDefinition(cwd),
      find: createFindToolDefinition(cwd),
      ls: createLsToolDefinition(cwd),
    };
    setBounded(definitionCache, cwd, defs, MAX_DEFINITIONS);
  } else {
    // 命中：重插以维持 LRU 顺序
    definitionCache.delete(cwd);
    definitionCache.set(cwd, defs);
  }
  return defs;
}

// ---------------------------------------------------------------------------
// 委托内置渲染器（展开/完整模式）：per-row 缓存
// 内置渲染器依赖 lastComponent 复用 + 共享 state，模拟 ToolExecutionComponent 行为
// ---------------------------------------------------------------------------

interface RowCache {
  state: Record<string, unknown>;
  callComp?: Component;
  resultComp?: Component;
}

const rowCaches = new Map<string, RowCache>();
/** 缓存上限：只保留最近的行，长会话下避免无限增长 */
const MAX_ROWS = 512;

function getRowCache(toolCallId: string): RowCache {
  let cache = rowCaches.get(toolCallId);
  if (!cache) {
    cache = { state: {} };
    setBounded(rowCaches, toolCallId, cache, MAX_ROWS);
    // setBounded 可能已淘汰其他行，但当前 key 始终保留；读到的是最新值
    cache = rowCaches.get(toolCallId) ?? cache;
  } else {
    // 命中：重插以维持 LRU 顺序，并修正被淘汰的旧引用
    rowCaches.delete(toolCallId);
    rowCaches.set(toolCallId, cache);
  }
  return cache;
}

function delegateCall(
  builtin: AnyToolDef,
  args: unknown,
  theme: Theme,
  context: RenderContext,
): Component {
  const cache = getRowCache(context.toolCallId);
  const render = builtin.renderCall;
  if (!render) return renderQuietOnly("tool", args, theme, context);
  const comp = render(args, theme, {
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
  options: RenderResultOptions,
  theme: Theme,
  context: RenderContext,
): Component {
  const cache = getRowCache(context.toolCallId);
  const render = builtin.renderResult;
  if (!render) return new Text("", 0, 0);
  const comp = render(result as never, options, theme, {
    ...context,
    state: cache.state,
    lastComponent: cache.resultComp,
  });
  cache.resultComp = comp;
  return comp;
}

/** renderCall/renderResult 缺失时的极简回退（防御性，正常不会走到） */
function renderQuietOnly(
  toolName: string,
  args: unknown,
  theme: Theme,
  context: RenderContext,
): Component {
  return renderLine(
    theme,
    toolName,
    summarizeToolCall(toolName, args, context.cwd),
  );
}

// ---------------------------------------------------------------------------
// 摘要（一句话说明这一步在做什么）
// ---------------------------------------------------------------------------

function truncate(s: string, n = maxSummary): string {
  const flat = s.replace(/[\r\n\t]+/g, " ").trim();
  const chars = Array.from(flat);
  if (chars.length <= n) return flat;
  return `${chars.slice(0, Math.max(0, n - 1)).join("")}…`;
}

/** 使路径相对于 cwd（更短、更直观） */
function relPath(p: string | undefined, cwd: string): string {
  if (!p) return "";
  try {
    if (isAbsolute(p)) {
      const rel = relative(cwd, p);
      if (rel && !rel.startsWith("..") && rel.length < p.length) return rel;
    }
  } catch {
    // 保持原样
  }
  return p;
}

function firstLine(s: string): string {
  const line = (s.split("\n").find((l) => l.trim().length > 0) ?? "").trim();
  return line.replace(/\s+/g, " ");
}

interface PathSummary {
  prefix: string;
  path: string;
  suffix: string;
}

type ToolSummary = string | PathSummary;

function pathSummary(path: string, suffix = "", prefix = ""): PathSummary {
  return { prefix, path, suffix };
}

function summarizeToolCall(toolName: string, args: any, cwd: string): ToolSummary {
  const a = (args ?? {}) as Record<string, any>;
  switch (toolName) {
    case "bash":
    case "powershell": {
      const cmd = typeof a.command === "string" ? firstLine(a.command) : "";
      // "cd dir && cmd" → "cmd (in dir)"，省掉最啰嗦的前缀
      const cd = cmd.match(/^cd\s+(\S+)\s*&&\s+(.+)$/);
      if (cd) return `${truncate(cd[2])} (in ${cd[1]})`;
      return truncate(cmd);
    }
    case "read": {
      const p = relPath(a.path, cwd);
      return pathSummary(p, a.offset && a.offset > 1 ? ` @${a.offset}` : "");
    }
    case "edit": {
      const p = relPath(a.path, cwd);
      const n = Array.isArray(a.edits) ? a.edits.length : 0;
      return pathSummary(p, n > 0 ? ` · ${n} ${n === 1 ? "edit" : "edits"}` : "");
    }
    case "write":
      return pathSummary(relPath(a.path, cwd));
    case "grep": {
      const pattern = truncate(String(a.pattern ?? ""), Math.min(40, maxSummary));
      const glob = a.glob ? ` (${a.glob})` : "";
      return a.path ? pathSummary(relPath(a.path, cwd), glob, `${pattern} in `) : pattern + glob;
    }
    case "find": {
      const pattern = truncate(String(a.pattern ?? ""), Math.min(40, maxSummary));
      return a.path ? pathSummary(relPath(a.path, cwd), "", `${pattern} in `) : pattern;
    }
    case "ls": {
      const p = relPath(a.path, cwd);
      return pathSummary(p || ".");
    }
    default:
      return truncate(JSON.stringify(a).slice(1, -1) || toolName);
  }
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function middleEllipsis(text: string, fits: (text: string) => boolean): string {
  if (fits(text)) return text;
  if (!fits("…")) return "";
  const chars = Array.from(graphemes.segment(text), part => part.segment);
  // Keep both the beginning and the extension when the basename itself is too long.
  let left = 0;
  let right = 0;
  while (left + right < chars.length) {
    const nextLeft = left + (left <= right ? 1 : 0);
    const nextRight = right + (left > right ? 1 : 0);
    const candidate = chars.slice(0, nextLeft).join("") + "…" + chars.slice(chars.length - nextRight).join("");
    if (!fits(candidate)) break;
    left = nextLeft;
    right = nextRight;
  }
  return chars.slice(0, left).join("") + "…" + chars.slice(chars.length - right).join("");
}

function splitPath(path: string): [string, string] {
  const withoutTrailingSlash = path.replace(/[\\/]+$/, "");
  const boundary = Math.max(withoutTrailingSlash.lastIndexOf("/"), withoutTrailingSlash.lastIndexOf("\\"));
  return [path.slice(0, boundary + 1), path.slice(boundary + 1)];
}

function compactPath(path: string, fits: (text: string) => boolean): string {
  if (fits(path)) return path;
  const [directory, name] = splitPath(path);
  const shortenName = () => {
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 ? name.slice(dot) : "";
    if (extension && fits("…" + extension)) {
      return middleEllipsis(name.slice(0, dot), text => fits(text + extension)) + extension;
    }
    return middleEllipsis(name, fits);
  };
  if (!directory) return shortenName();
  const separator = directory.slice(-1);
  let compact = `…${separator}${name}`;
  if (!fits(compact)) return shortenName();
  let prefix = "";
  // Omit whole middle directories, retaining as much of the project prefix as fits.
  const parts = directory.match(/[^\\/]*[\\/]/g) ?? [];
  for (const part of parts.slice(0, -1)) {
    prefix += part;
    const candidate = `${prefix}…${separator}${name}`;
    if (!fits(candidate)) break;
    compact = candidate;
  }
  return compact;
}

function renderSummary(summary: ToolSummary, width: number, theme: Theme, color: "accent" | "text"): string {
  if (typeof summary === "string") return theme.fg(color, truncateToWidth(truncate(summary), width, "…"));
  const flatten = (value: string) => value.replace(/[\r\n\t]+/g, " ");
  let prefix = flatten(summary.prefix);
  const path = flatten(summary.path);
  const suffix = flatten(summary.suffix);
  const fits = (text: string) => visibleWidth(text) <= width && Array.from(text).length <= maxSummary;
  const [, name] = splitPath(path);
  // File names and line numbers take precedence over a search prefix.
  if (!fits(prefix + name + suffix)) {
    prefix = middleEllipsis(prefix.trimEnd(), text => fits(text + " " + name + suffix));
    if (prefix) prefix += " ";
  }
  const compact = compactPath(path, text => fits(prefix + text + suffix));
  if (!compact) return theme.fg(color, truncateToWidth(truncate(name + suffix), width, "…"));
  const [directory, basename] = splitPath(compact);
  return theme.fg(color, prefix) + theme.fg("dim", directory) + theme.fg(color, basename) + theme.fg("dim", suffix);
}

// ---------------------------------------------------------------------------
// 完成状态（✓/✗ + 结果统计 + 耗时）
// ---------------------------------------------------------------------------

interface CallStatus {
  hint?: string;
  durationMs?: number;
}

/** per-row 渲染状态（ToolExecutionComponent 的 rendererState） */
interface RowState {
  startedAt?: number;
  animInterval?: ReturnType<typeof setInterval>;
  finalTick?: ReturnType<typeof setTimeout>;
  status?: CallStatus;
}

/** Only the most recently completed row offers the global expand shortcut. */
let latestCompletedState: RowState | undefined;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 100;
/** 完成后用于刷新一次最终状态的延迟 */
const FINAL_RENDER_DELAY_MS = 40;

/** 所有运行中的定时器，session 结束时统一清理 */
const activeTimers = new Set<ReturnType<typeof setInterval>>();
const activeTimeouts = new Set<ReturnType<typeof setTimeout>>();

function clearTimers(state: RowState): void {
  if (state.animInterval) {
    clearInterval(state.animInterval);
    activeTimers.delete(state.animInterval);
    state.animInterval = undefined;
  }
  if (state.finalTick) {
    clearTimeout(state.finalTick);
    activeTimeouts.delete(state.finalTick);
    state.finalTick = undefined;
  }
}

function formatSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const totalSec = ms / 1000;
  if (totalSec < 1) return `${Math.max(0.1, Math.round(totalSec * 10) / 10)}s`;
  if (totalSec < 60) return `${Math.round(totalSec)}s`;
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}m ${s}s`;
}

/** 把所有文本块拼接成结果文本（忽略图片块） */
function resultText(result: { content: unknown[] }): string {
  return (result.content ?? [])
    .filter((c): c is { type: "text"; text: string } => (c as any)?.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  // A trailing newline terminates the last line; interior blank lines still count.
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

function countGrepMatches(text: string): number {
  return text.split("\n").filter((line) => {
    // pi formats matches as path:N: text and context as path-N- text.
    // Inspect the first location marker so context containing "file:1:" stays context.
    const location = line.match(/^.+?(?::(\d+):|-(\d+)- )/);
    return location?.[1] !== undefined;
  }).length;
}

/**
 * 判断是否是 pi 输出尾部附加的提示行，例如：
 *   [200 entries limit reached. Use limit=400 for more]
 *   [64KB limit reached]
 *   [Some lines truncated to 2000 chars. Use read tool to see full lines]
 * 统计结果数量时不应把这类行算进去。
 */
const NOTICE_RE =
  /(limit reached|more lines? in file|more entries|KB limit reached|truncated to \d+ chars)/;

function isNoticeLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("[") && t.endsWith("]") && NOTICE_RE.test(t);
}

/** 统计有效结果行数（忽略空行与 [...] 提示行） */
function countContentLines(text: string): number {
  return text
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return t.length > 0 && !isNoticeLine(t);
    }).length;
}

/**
 * 错误时的首行提示：优先取“跳出”堆栈信息的真实错误行，
 * 例如 bash 的 `command not found`、read/ls 的 `Path not found: ...`。
 * 格式类状态行（Command exited with code / timed out）单独匹配，不在这里。
 */
function firstErrorLine(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find(
      (l) =>
        l.length > 0 &&
        !/^(Command exited with code |Command timed out after |\[)/.test(l),
    );
  if (!line) return undefined;
  return truncate(line, 40);
}

/**
 * 从最终结果推导一行状态尾巴，例如：
 *   bash 错误 → "exit 2" / "timeout 30s" / "error"
 *   read      → "42 lines" / "lines 1-20/300" / "image"
 *   grep/find → "12 matches" / "3 files" / "0 matches"
 *   ls        → "24 items"
 *   edit      → "2 blocks"
 */
function computeStatusHint(toolName: string, result: { content: unknown[]; details: any }, isError: boolean): string | undefined {
  const text = resultText(result);
  const hasImage = (result.content ?? []).some((c) => (c as any)?.type === "image");

  if (isError) {
    const exit = text.match(/Command exited with code (\d+)/);
    if (exit) return `exit ${exit[1]}`;
    const timeout = text.match(/timed out after (\d+) seconds/);
    if (timeout) return `timeout ${timeout[1]}s`;
    return firstErrorLine(text) ?? "error";
  }

  switch (toolName) {
    case "bash":
      return undefined; // 成功 bash 无需统计
    case "read": {
      if (hasImage) return "image";
      const range = text.match(/\[Showing lines (\d+)-(\d+) of (\d+)/);
      if (range) return `lines ${range[1]}-${range[2]}/${range[3]}`;
      const more = text.match(/\[(\d+) more lines? in file/);
      if (more) return `${more[1]} more`;
      const n = countLines(text);
      return n > 0 ? `${n} lines` : undefined;
    }
    case "grep": {
      if (text.trim() === "No matches found") return "0 matches";
      const n = countGrepMatches(text);
      return n > 0 ? `${n} matches` : "0 matches";
    }
    case "find": {
      if (text.trim() === "No files found matching pattern") return "0 files";
      const n = countContentLines(text);
      return n > 0 ? `${n} files` : "0 files";
    }
    case "ls": {
      if (text.trim() === "(empty directory)") return "0 items";
      const n = countContentLines(text);
      return n > 0 ? `${n} items` : undefined;
    }
    case "edit": {
      const blocks = text.match(/Successfully replaced (\d+) block\(s\)/);
      if (blocks) return `${blocks[1]} block${blocks[1] === "1" ? "" : "s"}`;
      return "done";
    }
    case "write":
      return undefined;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// 占位符渲染：minimal 用状态符号与对齐列，emoji 保留原有布局
// ---------------------------------------------------------------------------

interface LineStatus {
  mark: "running" | "ok" | "error";
  suffix?: string;
  frame?: string;
}

function formatMinimalLine(
  width: number,
  theme: Theme,
  toolName: string,
  summary: ToolSummary,
  status?: LineStatus,
  hint?: string,
): string {
  const color = status?.mark === "running" ? "accent" : status?.mark === "error" ? "error" : "dim";
  const symbol = status?.mark === "running" ? status.frame ?? SPINNER_FRAMES[0]
    : status?.mark === "ok" ? "✓" : status?.mark === "error" ? "×" : "·";
  const marker = theme.fg(color, symbol);
  if (width <= 2) return truncateToWidth(marker, width);

  const label = getStyle(toolName).label.replace(/[\r\n\t]+/g, " ");
  // Keep a shared label column in wide terminals, and reclaim padding when narrow.
  const labelWidth = width >= 60
    ? Math.min(16, Math.max(...TOOL_NAMES.map(name => visibleWidth(getStyle(name).label))))
    : visibleWidth(label);
  const head = marker + "  " + theme.fg("dim", truncateToWidth(label, labelWidth, "…", true));
  const summaryColor = status?.mark === "running" ? "accent" : "text";
  const brief = renderSummary(summary, width, theme, summaryColor);
  let tail = status?.suffix ? theme.fg(status.mark === "error" ? "error" : "dim", status.suffix) : "";
  if (hint && visibleWidth(head + "  " + brief + "  " + tail + "  " + hint) <= width) {
    tail += (tail ? "  " : "") + theme.fg("dim", hint);
  }

  const budget = width - visibleWidth(head) - (tail ? visibleWidth(tail) + 4 : 2);
  if (budget >= 1) {
    const text = head + "  " + renderSummary(summary, budget, theme, summaryColor);
    return tail ? text + " ".repeat(width - visibleWidth(text + tail)) + tail : text;
  }
  // Keep the status and result visible when there is no room for a summary.
  const headBudget = width - visibleWidth(tail) - 2;
  if (headBudget >= 4) return truncateToWidth(head, headBudget) + "  " + tail;
  return marker + " " + truncateToWidth(tail || label, width - 2);
}

function formatEmojiLine(
  width: number,
  theme: Theme,
  toolName: string,
  summary: ToolSummary,
  status?: LineStatus,
  hint?: string,
): string {
  const style = getStyle(toolName);
  const head = theme.fg("dim", (useIcons ? `${style.icon} ${style.label}` : style.label)
    .replace(/[\r\n\t]+/g, " "));
  let tail = "";

  if (status?.mark === "running") {
    tail = theme.fg("accent", `${status.frame ?? SPINNER_FRAMES[0]} ${status.suffix ?? ""}`);
  } else if (status?.mark === "ok") {
    tail = theme.fg("success", "✓");
    if (status.suffix) tail += " " + theme.fg("dim", status.suffix);
  } else if (status?.mark === "error") {
    tail = theme.fg("error", "✗");
    if (status.suffix) tail += " " + theme.fg("dim", status.suffix);
  }
  const brief = renderSummary(summary, width, theme, "accent");
  const separator = theme.fg("dim", " · ");
  // Optional help is the first thing dropped when space is tight.
  const help = hint && visibleWidth(head + separator + brief + " " + tail + " " + hint) <= width
    ? " " + theme.fg("dim", hint)
    : "";
  const suffix = (tail ? " " + tail : "") + help;
  const budget = width - visibleWidth(head + separator + suffix);
  if (budget >= 1) {
    return head + separator + renderSummary(summary, budget, theme, "accent") + suffix;
  }
  // On very narrow terminals drop the summary, then shorten the label.
  const headBudget = width - visibleWidth(suffix);
  if (headBudget >= 1) return truncateToWidth(head, headBudget) + suffix;
  return truncateToWidth(tail || head, width);
}

function renderLine(
  theme: Theme,
  toolName: string,
  summary: ToolSummary,
  status?: LineStatus,
  hint?: () => string | undefined,
): Component {
  return {
    invalidate() {},
    render(width) {
      const format = appearance === "minimal" ? formatMinimalLine : formatEmojiLine;
      return width > 0 ? [format(width, theme, toolName, summary, status, hint?.())] : [];
    },
  };
}

/** Ctrl+O 展开提示：优先用主题化的 keyHint，异常时回退纯文本 */
function expandHintText(): string {
  try {
    return keyHint("app.tools.expand", "expand");
  } catch {
    return "Ctrl+O expand";
  }
}

/**
 * quiet 模式的 call 行渲染。
 * 状态机（per-row state）：
 *   执行前            → 静态行
 *   执行中(isPartial) → 动画行（spinner + 耗时）
 *   刚完成(第一帧)    → 静态行 + 安排一次延迟重绘
 *   延迟帧(状态就绪)  → 最终行（✓/✗ + 统计 + 耗时），并停止一切定时器
 */
function renderQuietCall(
  toolName: string,
  theme: Theme,
  context: RenderContext,
): Component {
  const state = context.state as RowState;
  const summary = summarizeToolCall(toolName, context.args, context.cwd);

  // 已完成且状态就绪：渲染最终行（优先级最高，避免 isPartial 滞后时卡在动画）
  if (state.status) {
    clearTimers(state);
    const { hint, durationMs } = state.status;
    const dur = durationMs !== undefined ? formatSeconds(durationMs) : undefined;
    const suffix = hint && dur ? `${hint} · ${dur}` : (hint ?? dur);
    const hintText = () => expandHint && !context.expanded && latestCompletedState === state ? expandHintText() : undefined;
    return renderLine(theme, toolName, summary, {
      mark: context.isError ? "error" : "ok",
      suffix,
    }, hintText);
  }

  // 执行中：启动动画（只启动一次）
  if (context.isPartial) {
    if (context.executionStarted) {
      if (!state.animInterval) {
        const iv = setInterval(() => context.invalidate(), SPINNER_INTERVAL_MS);
        state.animInterval = iv;
        activeTimers.add(iv);
      }
      const elapsed = formatSeconds(Date.now() - (state.startedAt ?? Date.now()));
      const frame =
        SPINNER_FRAMES[
          Math.floor(Date.now() / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length
        ];
      return renderLine(theme, toolName, summary, {
        mark: "running",
        frame,
        suffix: elapsed,
      });
    }
    // 参数就绪但尚未开始执行：静态行
    return renderLine(theme, toolName, summary);
  }

  // 刚结束的过渡帧：安排一次延迟重绘，renderResult 会把统计写进 state.status
  if (!state.finalTick) {
    state.finalTick = setTimeout(() => context.invalidate(), FINAL_RENDER_DELAY_MS);
    activeTimeouts.add(state.finalTick);
  }
  return renderLine(theme, toolName, summary);
}

/** 所有显示模式都记录完成状态，避免展开详情时漏记结束时间。 */
function recordResultStatus(
  toolName: string,
  result: any,
  options: RenderResultOptions,
  context: RenderContext,
): void {
  const state = context.state as RowState;

  if (!options.isPartial) {
    // 最终结果：计算完成状态（只算一次）
    if (!state.status) {
      const finishedAt = Date.now();
      state.status = {
        hint: computeStatusHint(toolName, result, context.isError),
        durationMs: state.startedAt !== undefined ? finishedAt - state.startedAt : undefined,
      };
      latestCompletedState = state;
    }
    // 完成后的过渡帧由 renderCall 的 finalTick 驱动重绘
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
      const state = context.state as RowState;
      if (context.executionStarted && context.isPartial && !state.status) {
        state.startedAt ??= Date.now();
      }
      const builtin = getDefinitions(context.cwd)[name];
      if (!hidden || context.expanded) {
        // 展开/完整模式：动画与占位交给内置渲染器
        clearTimers(context.state as RowState);
        return delegateCall(builtin, args, theme, context);
      }
      return renderQuietCall(name, theme, context);
    },

    renderResult(result, options, theme, context) {
      recordResultStatus(name, result, options, context);
      const builtin = getDefinitions(context.cwd)[name];
      if (!hidden || context.expanded) {
        return delegateResult(builtin, result, options, theme, context);
      }
      return new Text("", 0, 0);
    },
  });
}

// ---------------------------------------------------------------------------
// 扩展入口
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  loadConfig();
  latestCompletedState = undefined;

  // 可选 CLI flag：启动即完整显示（优先级高于配置文件）
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
    description:
      "Toggle tool call display between quiet (placeholder) and full detail (add quiet|full to set explicitly)",
    handler: async (args, ctx) => {
      const mode = (args ?? "").trim().toLowerCase();
      if (mode === "quiet") hidden = true;
      else if (mode === "full" || mode === "show") hidden = false;
      else hidden = !hidden;
      saveConfig();

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

  // 清理 per-row 渲染缓存、工具定义缓存与运行中的动画/计时定时器
  pi.on("session_shutdown", () => {
    latestCompletedState = undefined;
    for (const iv of activeTimers) clearInterval(iv);
    activeTimers.clear();
    for (const t of activeTimeouts) clearTimeout(t);
    activeTimeouts.clear();
    rowCaches.clear();
    definitionCache.clear();
  });
}
