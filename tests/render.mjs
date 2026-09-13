/**
 * End-to-end render test: feeds registered quiet tools into pi's real
 * ToolExecutionComponent and checks the rendered lines, including the
 * Ctrl+O expand / collapse cycle.
 *
 * Run: npm test  (needs `npm install` first — devDeps jiti + peer pi packages)
 */
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isolateHome } from "./helpers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
isolateHome();

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

const { ToolExecutionComponent, initTheme } = await jiti.import(
  "@earendil-works/pi-coding-agent",
);
initTheme(undefined, false);
const { visibleWidth } = await jiti.import("@earendil-works/pi-tui");

const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
const ui = { requestRender() {} };

let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name} ${extra}`);
  }
};
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const render = (c) => {
  let lines;
  try {
    lines = c.render(100);
  } catch (e) {
    return `THREW: ${e.message}`;
  }
  return stripAnsi(lines.join("\n")).trim();
};

// --- bash flow ---
const c = new ToolExecutionComponent(
  "bash",
  "id-bash-1",
  { command: "npm test" },
  { showImages: true, imageWidthCells: 60 },
  byName.bash,
  ui,
  "/Users/akisy/Projects/x",
);
let out = render(c);
ok("pre-execution static line", /^·\s+Bash\s+npm test/.test(out) && !out.includes("💻"), JSON.stringify(out));

c.markExecutionStarted();
out = render(c);
ok("running spinner line", /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(out), JSON.stringify(out));

c.updateResult({ content: [{ type: "text", text: "partial out" }], details: {} }, true);
out = render(c);
ok("partial keeps spinner", /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(out), JSON.stringify(out));

c.updateResult({ content: [{ type: "text", text: "done" }], details: {} }, false);
out = render(c);
ok("final frame transitional", !out.includes("✓") && out.includes("npm test"), JSON.stringify(out));

await new Promise((r) => setTimeout(r, 80));
out = render(c);
ok("final ✓ line", /^✓\s+Bash\s+npm test\s+\d+(\.\d+)?[sm]/.test(out), JSON.stringify(out));
ok("expand hint present", out.toLowerCase().includes("expand"), JSON.stringify(out));
ok("no giant boxes", !out.includes("┌") && !out.includes("└"), JSON.stringify(out));

// --- error flow ---
const e = new ToolExecutionComponent(
  "bash",
  "id-bash-2",
  { command: "npm run nope" },
  {},
  byName.bash,
  ui,
  "/Users/akisy/Projects/x",
);
e.markExecutionStarted();
e.updateResult(
  { content: [{ type: "text", text: "ERR\nCommand exited with code 1" }], details: {}, isError: true },
  false,
);
await new Promise((r) => setTimeout(r, 80));
out = render(e);
ok("error × exit 1", out.startsWith("×") && out.includes("exit 1"), JSON.stringify(out));

// --- read flow ---
const r = new ToolExecutionComponent(
  "read",
  "id-read-1",
  { path: "/Users/akisy/Projects/x/src/main.ts" },
  {},
  byName.read,
  ui,
  "/Users/akisy/Projects/x",
);
out = render(r);
ok("read summary line", /^·\s+Read\s+src\/main.ts/.test(out), JSON.stringify(out));
r.markExecutionStarted();
r.updateResult({ content: [{ type: "text", text: "a\nb\nc\nd" }], details: {} }, false);
await new Promise((r2) => setTimeout(r2, 80));
out = render(r);
ok("read ✓ 4 lines", out.includes("✓") && out.includes("4 lines"), JSON.stringify(out));

// --- grep with expand toggle ---
const g = new ToolExecutionComponent(
  "grep",
  "id-grep-1",
  { pattern: "foo", path: "src" },
  {},
  byName.grep,
  ui,
  "/Users/akisy/Projects/x",
);
g.markExecutionStarted();
g.updateResult({ content: [{ type: "text", text: "src/a.ts:1:foo" }], details: {} }, false);
await new Promise((r2) => setTimeout(r2, 80));
out = render(g);
ok("grep ✓ 1 match", out.includes("1 match") && out.includes("foo"), JSON.stringify(out));

g.setExpanded(true);
out = render(g);
ok("expanded shows real output", out.includes("src/a.ts:1:foo"), JSON.stringify(out).slice(0, 200));
g.setExpanded(false);
await new Promise((r2) => setTimeout(r2, 50));
out = render(g);
ok("collapsed back to quiet", out.includes("1 match") && !out.includes("src/a.ts:1:foo"), JSON.stringify(out));

// Historical rows lose the hint without being explicitly invalidated or rebuilt.
ok("only the latest completion shows expand help", render(g).includes("expand") && [c, e, r].every(row => !render(row).includes("expand")));
c.setExpanded(true);
c.setExpanded(false);
ok("redrawing an old row does not reclaim the hint", !render(c).includes("expand") && render(g).includes("expand"));

const slow = new ToolExecutionComponent("bash", "slow", { command: "slow" }, {}, byName.bash, ui, repoRoot);
const fast = new ToolExecutionComponent("bash", "fast", { command: "fast" }, {}, byName.bash, ui, repoRoot);
slow.markExecutionStarted();
fast.markExecutionStarted();
fast.updateResult({ content: [{ type: "text", text: "done" }], details: {} }, false);
await new Promise(resolve => setTimeout(resolve, 60));
ok("new completion takes the hint from previous rows", render(fast).includes("expand") && !render(g).includes("expand"));
slow.updateResult({ content: [{ type: "text", text: "Command exited with code 1" }], details: {}, isError: true }, false);
await new Promise(resolve => setTimeout(resolve, 60));
ok("latest completion wins even when it started earlier and failed", render(slow).includes("expand") && !render(fast).includes("expand"));
slow.setExpanded(true);
ok("expanding the latest row does not move its hint to older rows", !render(fast).includes("expand"));
slow.setExpanded(false);
ok("collapse restores the hint only on its owner", render(slow).includes("expand") && !render(fast).includes("expand"));

// File names and line offsets survive directory compaction at different widths.
for (const path of [
  "src/components/" + "deeply-nested/".repeat(8) + "Button.tsx",
  "src/" + "目录👩‍💻/".repeat(8) + "按钮.tsx",
  "C:\\project\\" + "components\\nested\\".repeat(8) + "Button.tsx",
]) {
  const filename = path.split(/[\\/]/).at(-1);
  const row = new ToolExecutionComponent("read", `path-${path}`, { path, offset: 120 }, {}, byName.read, ui, repoRoot);
  for (const width of [40, 60, 80, 120]) {
    const lines = row.render(width).filter(line => stripAnsi(line).trim());
    const output = stripAnsi(lines.join("\n"));
    ok(`path keeps basename and offset at width ${width}`, output.includes(`${filename} @120`) && output.includes("…") && lines.length === 1 && visibleWidth(lines[0]) <= width, JSON.stringify(output));
    ok(`path compaction preserves valid Unicode at width ${width}`, !output.includes("\ufffd") && !/(?<!\uD83D)\uDC69|\u200D(?!💻)/u.test(output), JSON.stringify(output));
  }
  const expanded = row;
  expanded.setExpanded(true);
  ok("expanded view retains the original unshortened path", render(expanded).includes("deeply-nested") || render(expanded).includes("目录") || render(expanded).includes("nested"), JSON.stringify(render(expanded)));
}

for (const name of ["write", "edit", "grep", "find", "ls"]) {
  const path = "src/" + "components/".repeat(10) + "Button.tsx";
  const args = { path, pattern: "Button", edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }] };
  const row = new ToolExecutionComponent(name, `path-${name}`, args, {}, byName[name], ui, repoRoot);
  const output = render(row);
  ok(`${name} preserves the path basename`, output.includes("Button.tsx") && output.includes("…"), JSON.stringify(output));
  if (name === "edit") ok("edit preserves its change count", output.includes("· 2 edits"), JSON.stringify(output));
}

const hugeName = new ToolExecutionComponent("read", "long-basename", { path: "src/" + "Button".repeat(20) + ".swift", offset: 120 }, {}, byName.read, ui, repoRoot);
for (const width of [24, 32, 40]) {
  const shortName = stripAnsi(hugeName.render(width).join("\n"));
  ok(`oversized basename retains extension and line offset at width ${width}`, shortName.includes("…") && shortName.includes(".swift @120"), JSON.stringify(shortName));
}

// --- long Unicode summaries stay on one physical row at every terminal width ---
const longPath = "src/" + "目录📁/".repeat(30) + "index.ts";
for (const [name, args] of [
  ["read", { path: longPath }],
  ["write", { path: longPath }],
  ["edit", { path: longPath, edits: [{ oldText: "a", newText: "b" }] }],
  ["grep", { pattern: "内容".repeat(30), path: longPath }],
  ["find", { pattern: "**/*.ts", path: longPath }],
  ["ls", { path: longPath }],
  ["bash", { command: "cd " + longPath + " && npm test" }],
  ["powershell", { command: "Write-Output " + longPath }],
]) {
  const row = new ToolExecutionComponent(name, `long-${name}`, args, {}, byName[name], ui, repoRoot);
  row.markExecutionStarted();
  row.updateResult({ content: [{ type: "text", text: "Command exited with code 2" }], details: {}, isError: true }, false);
  await new Promise(resolve => setTimeout(resolve, 60));
  for (const width of [1, 8, 24, 40, 80, 160]) {
    const lines = row.render(width).filter(line => stripAnsi(line).trim());
    ok(`${name} stays one row at width ${width}`, lines.length === 1 && visibleWidth(lines[0]) <= width, JSON.stringify(lines));
    if (width >= 24) ok(`${name} preserves error and duration at width ${width}`, stripAnsi(lines[0]).startsWith("×") && /exit 2 · \d/.test(stripAnsi(lines[0])), JSON.stringify(lines));
  }
}

// --- deterministic timing across expansion and full-mode changes ---
const cmdCtx = { mode: "tui", ui: { getToolsExpanded: () => false, setToolsExpanded() {}, notify() {} } };
const originalNow = Date.now;
try {
  let now = 0;
  Date.now = () => now;
  for (const mode of ["expanded-during", "expanded-before", "full"]) {
    now = 0;
    if (mode === "full") await commands.toggletools.handler("full", cmdCtx);
    const row = new ToolExecutionComponent("bash", `timing-${mode}`, { command: "test" }, {}, byName.bash, ui, repoRoot);
    if (mode === "expanded-before") row.setExpanded(true);
    row.markExecutionStarted();
    now = 50;
    if (mode === "expanded-during") row.setExpanded(true);
    now = 200;
    row.updateResult({ content: [{ type: "text", text: "done" }], details: {} }, false);
    now = 5000;
    if (mode === "full") await commands.toggletools.handler("quiet", cmdCtx);
    row.setExpanded(false);
    out = render(row);
    ok(`${mode} records completion before collapsing`, /^✓\s+Bash\s+test\s+0\.2s\b/.test(out), JSON.stringify(out));
    now = 10000;
    row.setExpanded(true);
    row.setExpanded(false);
    ok(`${mode} duration stays fixed on later redraws`, /^✓\s+Bash\s+test\s+0\.2s\b/.test(render(row)), JSON.stringify(render(row)));
  }
  const history = new ToolExecutionComponent("bash", "history", { command: "test" }, {}, byName.bash, ui, repoRoot);
  history.updateResult({ content: [{ type: "text", text: "done" }], details: {} }, false);
  history.setExpanded(true);
  history.setExpanded(false);
  out = render(history);
  ok("history without start time does not invent a duration", out.includes("✓") && !/✓\s+\d/.test(out), JSON.stringify(out));
} finally {
  Date.now = originalNow;
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
