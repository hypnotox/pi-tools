import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { SubprocessRunner } from "./runner.js";

function fakeChild(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
} {
  return Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    killed: false,
  });
}

describe("SubprocessRunner", () => {
  it("does not launch an already aborted invocation", async () => {
    const spawn = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const runner = new SubprocessRunner({ spawn: spawn as never });
    const result = await runner.run({
      prepared: { cwd: ".", prompt: "task", toolPolicy: { mode: "allowlist", tools: [] } },
      model: { provider: "p", id: "m", thinkingLevels: ["off"] },
      thinkingLevel: "off",
      tools: [],
      parentCwd: ".",
      parentTrusted: false,
      signal: controller.signal,
    });
    expect(result.state).toBe("cancelled");
    expect(spawn).not.toHaveBeenCalled();
  });
  it("uses isolated JSON arguments and only propagates descendant trust", async () => {
    const child = fakeChild();
    const spawn = vi.fn((..._args: unknown[]) => child);
    const runner = new SubprocessRunner({
      spawn: spawn as never,
      canonicalize: async (value) => (value.endsWith("/child") ? "/parent/child" : "/parent"),
      mkdtemp: (async () => "/tmp/test") as never,
      writeFile: async () => undefined,
      rm: async () => undefined,
      executable: () => ({ command: "pi", prefix: [] }),
    });
    const promise = runner.run({
      prepared: {
        cwd: "child",
        prompt: "task",
        toolPolicy: { mode: "allowlist", tools: ["read"] },
      },
      model: { provider: "p", id: "m", thinkingLevels: ["off"] },
      thinkingLevel: "off",
      tools: ["read"],
      parentCwd: "parent",
      parentTrusted: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    child.emit("close", 0);
    await promise;
    const call = spawn.mock.calls[0] as unknown[] | undefined;
    expect(call?.[1]).toEqual(
      expect.arrayContaining([
        "--mode",
        "json",
        "--no-session",
        "--no-context-files",
        "--no-skills",
        "--approve",
      ]),
    );
    expect(call?.[2]).toMatchObject({
      cwd: "/parent/child",
      env: expect.objectContaining({ PI_TOOLS_SUBAGENT_CHILD: "1" }),
    });
  });
});
