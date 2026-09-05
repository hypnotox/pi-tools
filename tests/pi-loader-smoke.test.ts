import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("discovers and expands the package handoff prompt", () => {
    const isolated = mkdtempSync(join(tmpdir(), "pi-tools-prompts-"));
    try {
      const config = join(isolated, "config");
      const sessions = join(isolated, "sessions");
      for (const directory of [config, sessions]) mkdirSync(directory);
      writeFileSync(join(config, "settings.json"), JSON.stringify({ packages: [root] }));
      const result = spawnSync(resolve(root, "node_modules/.bin/pi"), ["--mode", "rpc"], {
        cwd: isolated,
        encoding: "utf8",
        input: [
          JSON.stringify({ id: "commands", type: "get_commands" }),
          JSON.stringify({ id: "expand", type: "steer", message: "/handoff" }),
          JSON.stringify({ id: "queue", type: "clear_queue" }),
          "",
        ].join("\n"),
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: config,
          PI_CODING_AGENT_SESSION_DIR: sessions,
          PI_OFFLINE: "1",
          PI_SKIP_VERSION_CHECK: "1",
        },
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      const messages = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const commands = messages.find((message) => message.id === "commands") as
        | { data?: { commands?: Array<{ name?: string; source?: string }> } }
        | undefined;
      expect(commands?.data?.commands).toContainEqual(
        expect.objectContaining({ name: "handoff", source: "prompt" }),
      );
      const queue = messages.find((message) => message.id === "queue") as
        | { data?: { steering?: string[] } }
        | undefined;
      expect(queue?.data?.steering?.[0]).toContain("handoff_session");
      expect(queue?.data?.steering?.[0]?.trim()).not.toBe("");
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});
