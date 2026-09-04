import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const entrypoints = [
  "extensions/timing/index.ts",
  "extensions/subagents/index.ts",
  "extensions/context-usage/index.ts",
  "extensions/handoff/index.ts",
].map((path) => resolve(root, path));

describe("real Pi package loader", () => {
  it("loads every retained entrypoint with isolated package, config, and session directories", () => {
    const isolated = mkdtempSync(join(tmpdir(), "pi-tools-loader-"));
    try {
      const config = join(isolated, "config");
      const packages = join(isolated, "packages");
      const sessions = join(isolated, "sessions");
      for (const directory of [config, packages, sessions]) mkdirSync(directory);
      const executable = resolve(root, "node_modules/.bin/pi");
      const args = entrypoints.flatMap((entrypoint) => ["--extension", entrypoint]);
      const result = spawnSync(executable, [...args, "--list-models"], {
        cwd: isolated,
        encoding: "utf8",
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: config,
          PI_CODING_AGENT_SESSION_DIR: sessions,
          PI_PACKAGE_DIR: packages,
          PI_OFFLINE: "1",
          PI_SKIP_VERSION_CHECK: "1",
        },
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stderr).not.toMatch(/extension.*(error|failed)/i);
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});
