import os from "node:os";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { mock } from "node:test";

export const hasRipgrep = () => !spawnSync("rg", ["--version"], { stdio: "ignore" }).error;

// Each test process gets an isolated config directory without changing HOME.
export function isolateHome() {
  // The isolated home hides pi's installed tools: keep them reachable and never download.
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(os.homedir(), ".pi", "agent");
  process.env.PATH = join(agentDir, "bin") + delimiter + process.env.PATH;
  process.env.PI_OFFLINE = "1";
  const home = mkdtempSync(join(os.tmpdir(), "quiet-tools-test-"));
  mock.method(os, "homedir", () => home);
  syncBuiltinESMExports();
  process.on("exit", () => rmSync(home, { recursive: true, force: true }));
  return home;
}
