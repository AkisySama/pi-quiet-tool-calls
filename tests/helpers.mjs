import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { mock } from "node:test";

// Each test process gets an isolated config directory without changing HOME.
export function isolateHome() {
  const home = mkdtempSync(join(os.tmpdir(), "quiet-tools-test-"));
  mock.method(os, "homedir", () => home);
  syncBuiltinESMExports();
  process.on("exit", () => rmSync(home, { recursive: true, force: true }));
  return home;
}
