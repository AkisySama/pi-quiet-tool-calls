/**
 * Smoke test for the quiet-tools extension: summarizes, state machine and
 * result stats, all rendered through the extension's own renderers.
 *
 * Run: npm test  (needs `npm install` first — devDeps jiti + peer pi packages)
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isolateHome } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

// isolate config file reads from the real user config
const testHome = isolateHome();

const jiti = createJiti(import.meta.url, { interopDefault: true });

const tools = [];
const commands = {};
const piMock = {
  registerTool: (def) => tools.push(def),
  registerFlag: () => {},
  getFlag: () => undefined,
  registerCommand: (name, def) => (commands[name] = def),
  on: () => {},
};

const mod = await jiti.import(join(repoRoot, "extensions/quiet-tools.ts"));
mod.default(piMock);

const theme = { fg: (_c, t) => t, bold: (t) => t };

let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name} ${extra}`);
  }
};
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const lineText = (comp) => stripAnsi(comp.render(120).join("\n"));

function makeCtx(state, partial, started, isError = false) {
  return {
    state,
    args: {},
    toolCallId: "t1",
    invalidate: () => {},
    lastComponent: undefined,
    cwd: "/Users/akisy/Projects/x",
    executionStarted: started,
    argsComplete: true,
    isPartial: partial,
    expanded: false,
    showImages: true,
    isError,
  };
}

const bash = tools.find((t) => t.name === "bash");
const read = tools.find((t) => t.name === "read");
const grep = tools.find((t) => t.name === "grep");
const edit = tools.find((t) => t.name === "edit");
const find = tools.find((t) => t.name === "find");
const write = tools.find((t) => t.name === "write");
const ls = tools.find((t) => t.name === "ls");

console.log("bash:");
{
  // static pre-execution line
  let st = {};
  let ctx = makeCtx(st, true, false);
  ctx.args = { command: "cd src && npm test -- --watch" };
  let out = lineText(bash.renderCall(ctx.args, theme, ctx));
  ok("summary merges cd prefix", out.includes("npm test -- --watch (in src)"), JSON.stringify(out));

  // running line
  st = {};
  ctx = makeCtx(st, true, true);
  ctx.args = { command: "npm run build" };
  out = lineText(bash.renderCall(ctx.args, theme, ctx));
  ok("running shows label + summary without emoji", out.includes("Bash") && out.includes("npm run build") && !out.includes("💻"), JSON.stringify(out));
  ok("running has leading spinner and elapsed time", /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+Bash.*\d+(\.\d+)?s/.test(out), JSON.stringify(out));
  ok("running started interval", st.animInterval !== undefined);

  // completion: isPartial flips to false, then result arrives
  ctx = makeCtx(st, false, true);
  const result = { content: [{ type: "text", text: "build output\n" }], details: {} };
  const rr = bash.renderResult(result, { expanded: false, isPartial: false }, theme, ctx);
  ok("final renderResult sets status", st.status !== undefined, JSON.stringify(st.status));
  ok("final renderResult renders empty", rr.render(120).join("").trim() === "");

  await new Promise((r) => setTimeout(r, 60));
  out = lineText(bash.renderCall(ctx.args, theme, ctx));
  ok("final line shows ✓", out.includes("✓"), JSON.stringify(out));
  ok("final line shows duration", /^✓\s+Bash\s+\d+(\.\d+)?[sm]/.test(out), JSON.stringify(out));
  ok("final line shows expand hint", out.toLowerCase().includes("expand"), JSON.stringify(out));
  ok("timers cleared", st.animInterval === undefined && st.finalTick === undefined);
}

console.log("bash error:");
{
  const st = {};
  const ctx = makeCtx(st, false, true, true);
  ctx.args = { command: "npm run build" };
  const result = {
    content: [{ type: "text", text: "output\nnpm ERR!\nCommand exited with code 2" }],
    details: {},
  };
  bash.renderResult(result, { expanded: false, isPartial: false }, theme, ctx);
  await new Promise((r) => setTimeout(r, 60));
  const out = lineText(bash.renderCall(ctx.args, theme, ctx));
  ok("error line starts with × and shows exit 2", out.startsWith("×") && out.includes("exit 2"), JSON.stringify(out));
}

console.log("other tools:");
{
  let st = {}, ctx = makeCtx(st, false, true);
  ctx.args = { path: "/Users/akisy/Projects/x/Sources/App.swift" };
  let out = lineText(read.renderCall(ctx.args, theme, ctx));
  ok("read relative path", out.includes("Sources/App.swift") && /^·\s+Read\s/.test(out), JSON.stringify(out));

  st = {}; ctx = makeCtx(st, false, true);
  ctx.args = { path: "/Users/akisy/Projects/x/Sources/App.swift", offset: 120 };
  out = lineText(read.renderCall(ctx.args, theme, ctx));
  ok("read offset shown", out.includes("Sources/App.swift @120"), JSON.stringify(out));

  st = {}; ctx = makeCtx(st, false, true);
  ctx.args = { path: "src/index.ts", edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }] };
  out = lineText(edit.renderCall(ctx.args, theme, ctx));
  ok("edit count", out.includes("src/index.ts · 2 edits"), JSON.stringify(out));

  st = {}; ctx = makeCtx(st, false, true);
  ctx.args = { pattern: "applyIconChoice|AppIconChoice", path: "Sources" };
  out = lineText(grep.renderCall(ctx.args, theme, ctx));
  ok("grep pattern + path", out.includes("applyIconChoice|AppIconC") && out.includes("in Sources"), JSON.stringify(out));

  st = {}; ctx = makeCtx(st, false, true);
  ctx.args = { pattern: "**/*.ts", path: "src" };
  out = lineText(find.renderCall(ctx.args, theme, ctx));
  ok("find pattern + path", out.includes("**/*.ts") && out.includes("in src"), JSON.stringify(out));

  st = {}; ctx = makeCtx(st, false, true);
  ctx.args = { path: "docs/readme.md" };
  out = lineText(write.renderCall(ctx.args, theme, ctx));
  ok("write path", out.includes("docs/readme.md"), JSON.stringify(out));

  st = {}; ctx = makeCtx(st, false, true);
  ctx.args = {};
  out = lineText(ls.renderCall(ctx.args, theme, ctx));
  ok("ls default .", out.trimEnd().endsWith("."), JSON.stringify(out));
}

console.log("result stats:");
{
  async function statFor(tool, result, isError = false) {
    const st = {};
    const ctx = makeCtx(st, false, true, isError);
    ctx.args =
      tool.name === "read"
        ? { path: "a.md" }
        : tool.name === "grep"
          ? { pattern: "x" }
          : tool.name === "edit"
            ? { path: "a.ts", edits: [{}] }
            : {};
    tool.renderResult(result, { expanded: false, isPartial: false }, theme, ctx);
    await new Promise((r) => setTimeout(r, 60));
    return lineText(tool.renderCall(ctx.args, theme, ctx));
  }
  let out = await statFor(grep, { content: [{ type: "text", text: "a.ts:1:x\nb.ts:2:x" }], details: {} });
  ok("grep 2 matches", out.includes("2 matches"), JSON.stringify(out));

  out = await statFor(grep, { content: [{ type: "text", text: "No matches found" }], details: {} });
  ok("grep 0 matches", out.includes("0 matches"), JSON.stringify(out));

  out = await statFor(find, { content: [{ type: "text", text: "No files found matching pattern" }], details: {} });
  ok("find 0 files", out.includes("0 files"), JSON.stringify(out));

  out = await statFor(read, { content: [{ type: "text", text: "line1\nline2\nline3" }], details: {} });
  ok("read 3 lines", out.includes("3 lines"), JSON.stringify(out));

  for (const [text, expected] of [["a\n\nb", 3], ["a\n\nb\n", 3], ["a\n\n", 2], ["\n", 1], ["a\r\n \r\nb\r\n", 3]]) {
    out = await statFor(read, { content: [{ type: "text", text }], details: {} });
    ok(`read counts blank lines in ${JSON.stringify(text)}`, out.includes(`${expected} lines`), JSON.stringify(out));
  }

  out = await statFor(read, { content: [{ type: "text", text: "" }], details: {} });
  ok("empty read does not invent a line", !out.includes("1 lines"), JSON.stringify(out));

  out = await statFor(grep, { content: [{ type: "text", text: "a.ts-1- context.ts:99: text\na.ts:2: match\na.ts-3- after\n\n[1 matches limit reached. Use limit=2 for more]" }], details: {} });
  ok("grep excludes context even when it contains a location", out.includes("1 matches"), JSON.stringify(out));

  out = await statFor(grep, { content: [{ type: "text", text: "C:\\src\\file-2026-backup.ts-1- before\nC:\\src\\file-2026-backup.ts:2: match\nC:\\src\\file-2026-backup.ts-3- after" }], details: {} });
  ok("grep handles Windows paths and numeric filename segments", out.includes("1 matches"), JSON.stringify(out));

  const fixtureDir = join(testHome, "fixtures");
  mkdirSync(fixtureDir);
  writeFileSync(join(fixtureDir, "sample.txt"), "before\nneedle\n\nneedle\nafter\n");
  const actualRead = await read.execute("real-read", { path: "sample.txt" }, undefined, undefined, { cwd: fixtureDir });
  out = await statFor(read, actualRead);
  ok("real read counts blank lines and trailing newline", out.includes("5 lines"), JSON.stringify(out));
  const actualGrep = await grep.execute("real-grep", { pattern: "needle", path: ".", context: 1 }, undefined, undefined, { cwd: fixtureDir });
  out = await statFor(grep, actualGrep);
  ok("real grep counts matches with overlapping context", out.includes("2 matches"), JSON.stringify(out));

  out = await statFor(read, { content: [{ type: "text", text: "x\n\n[Showing lines 1-5 of 200. Use offset=6 to continue.]" }], details: {} });
  ok("read truncated range", out.includes("lines 1-5/200"), JSON.stringify(out));

  out = await statFor(ls, { content: [{ type: "text", text: "a\nb\n\n[100 entries limit reached. Use limit=200 for more]" }], details: {} });
  ok("ls ignores notice line", out.includes("2 items"), JSON.stringify(out));

  out = await statFor(edit, { content: [{ type: "text", text: "Successfully replaced 2 block(s) in a.ts." }], details: {} });
  ok("edit 2 blocks", out.includes("2 blocks"), JSON.stringify(out));

  out = await statFor(ls, { content: [{ type: "text", text: "(empty directory)" }], details: {} });
  ok("ls 0 items", out.includes("0 items"), JSON.stringify(out));
}

console.log("error hints:");
{
  async function errorFor(tool, result) {
    const st = {};
    const ctx = makeCtx(st, false, true, true);
    ctx.args = tool.name === "read" ? { path: "a.md" } : { command: "x" };
    tool.renderResult(result, { expanded: false, isPartial: false }, theme, ctx);
    await new Promise((r) => setTimeout(r, 60));
    return lineText(tool.renderCall(ctx.args, theme, ctx));
  }
  let out = await errorFor(read, {
    content: [{ type: "text", text: "Path not found: /Users/akisy/Projects/x/a.md" }],
    details: {},
  });
  ok("read error shows real first line", out.includes("Path not found"), JSON.stringify(out));

  out = await errorFor(bash, {
    content: [{ type: "text", text: "bash: npm: command not found\nCommand exited with code 127" }],
    details: {},
  });
  ok("bash exit code still wins", out.includes("exit 127"), JSON.stringify(out));
}

console.log("config persistence:");
{
  const cfgPath = join(testHome, ".pi", "quiet-tools.json");
  rmSync(cfgPath, { force: true });
  const cmdCtx = {
    mode: "tui",
    ui: {
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
      notify: () => {},
    },
  };
  await commands.toggletools.handler("full", cmdCtx);
  const saved1 = JSON.parse(readFileSync(cfgPath, "utf8"));
  ok("toggletools full persists config", saved1.hidden === false, JSON.stringify(saved1));
  ok("config omits all default settings", JSON.stringify(saved1) === '{"hidden":false}', JSON.stringify(saved1));
  await commands.toggletools.handler("", cmdCtx);
  ok("toggletools quiet persists empty defaults", readFileSync(cfgPath, "utf8") === "{}");

  writeFileSync(cfgPath, JSON.stringify({ appearance: "emoji", icons: false, maxSummary: 24, expandHint: false, style: { read: { icon: "R", label: "Read" }, bash: { icon: "💻", label: "Shell" } } }));
  mod.default(piMock);
  await commands.toggletools.handler("full", cmdCtx);
  const savedCustom = JSON.parse(readFileSync(cfgPath, "utf8"));
  ok("config preserves custom settings and emoji appearance", savedCustom.appearance === "emoji" && savedCustom.icons === false && savedCustom.maxSummary === 24 && savedCustom.expandHint === false, JSON.stringify(savedCustom));
  ok("config omits default fields inside custom styles", JSON.stringify(savedCustom.style) === '{"read":{"icon":"R"},"bash":{"label":"Shell"}}', JSON.stringify(savedCustom));

  await commands.toggletools.handler("quiet", cmdCtx);
  const customCtx = makeCtx({}, true, false);
  customCtx.args = { path: "x".repeat(80) };
  const customLine = lineText(read.renderCall(customCtx.args, theme, customCtx));
  ok("maxSummary applies to paths and icons can be disabled", customLine.trim() === "Read · " + "x".repeat(12) + "…" + "x".repeat(11), JSON.stringify(customLine));

  writeFileSync(cfgPath, JSON.stringify({ appearance: "emoji" }));
  mod.default(piMock);
  const emojiLine = lineText(read.renderCall(customCtx.args, theme, customCtx));
  ok("emoji appearance restores original icons", emojiLine.startsWith("📖 Read · "), JSON.stringify(emojiLine));

  rmSync(cfgPath);
  mod.default(piMock);
  const restoredLine = lineText(read.renderCall(customCtx.args, theme, customCtx));
  ok("deleting config restores minimal defaults on reload", restoredLine.trim() === "·  Read        " + "x".repeat(30) + "…" + "x".repeat(29), JSON.stringify(restoredLine));
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
