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

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
process.env.HOME = "/tmp/qt-tests-home";

const jiti = createJiti(import.meta.url, { interopDefault: true });

const tools = [];
const piMock = {
  registerTool: (def) => tools.push(def),
  registerFlag: () => {},
  getFlag: () => undefined,
  registerCommand: () => {},
  on: () => {},
};
const mod = await jiti.import(join(repoRoot, "extensions/quiet-tools.ts"));
mod.default(piMock);

const { ToolExecutionComponent, Theme, initTheme } = await jiti.import(
  "@earendil-works/pi-coding-agent",
);
initTheme(undefined, false);

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
ok("pre-execution static line", out.includes("💻 Bash") && out.includes("npm test"), JSON.stringify(out));

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
ok("final ✓ line", out.includes("✓") && /✓\s+\d+(\.\d+)?[sm]/.test(out), JSON.stringify(out));
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
ok("error ✗ exit 1", out.includes("✗") && out.includes("exit 1"), JSON.stringify(out));

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
ok("read summary line", out.includes("📖 Read") && out.includes("src/main.ts"), JSON.stringify(out));
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

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
