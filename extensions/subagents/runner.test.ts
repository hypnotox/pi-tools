import { EventEmitter } from "node:events";
import { win32 } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RunRequest } from "./runner.js";
import { isPathWithin, SubprocessRunner, truncateUtf8 } from "./runner.js";

function fakeChild(pid = 123): EventEmitter & {
  pid: number;
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
} {
  return Object.assign(new EventEmitter(), {
    pid,
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
    killed: false,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function request(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    prepared: {
      cwd: "/parent/child",
      systemPrompt: "minimal system",
      prompt: "task",
      toolPolicy: { mode: "allowlist", tools: ["read"] },
    },
    model: { provider: "p", id: "m", thinkingLevels: ["off"] },
    thinkingLevel: "off",
    tools: ["read"],
    parentCwd: "/parent",
    parentTrusted: true,
    ...overrides,
  };
}

function dependencies(child = fakeChild()) {
  return {
    child,
    spawn: vi.fn((..._args: unknown[]) => child),
    canonicalize: async (value: string) => value,
    mkdtemp: (async () => "/tmp/test") as never,
    writeFile: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    executable: () => ({ command: "pi", prefix: [] }),
    signalTree: vi.fn(),
    delay: vi.fn(async () => undefined),
  };
}

async function launch(deps: ReturnType<typeof dependencies>, value = request()) {
  const runner = new SubprocessRunner(deps as never);
  const promise = runner.run(value);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { runner, promise };
}

describe("SubprocessRunner", () => {
  it("does not launch an already aborted invocation", async () => {
    const spawn = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const runner = new SubprocessRunner({ spawn: spawn as never });
    const result = await runner.run(request({ signal: controller.signal }));
    expect(result.state).toBe("cancelled");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("uses exact isolated arguments, restrictive prompt storage, and descendant trust", async () => {
    const deps = dependencies();
    const { promise } = await launch(deps);
    deps.child.emit("close", 0);
    await expect(promise).resolves.toMatchObject({ state: "completed" });
    expect(deps.writeFile).toHaveBeenCalledWith(
      "/tmp/test/system-prompt.txt",
      "minimal system",
      expect.objectContaining({ mode: 0o600 }),
    );
    expect(deps.spawn.mock.calls[0]?.[1]).toEqual([
      "--mode",
      "json",
      "--print",
      "--no-session",
      "--no-context-files",
      "--no-skills",
      "--system-prompt",
      "/tmp/test/system-prompt.txt",
      "--model",
      "p/m",
      "--thinking",
      "off",
      "--tools",
      "read",
      "--approve",
    ]);
    expect(deps.child.stdin.end).toHaveBeenCalledWith("task", "utf8");
    expect(deps.spawn.mock.calls[0]?.[2]).toMatchObject({
      cwd: "/parent/child",
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: expect.objectContaining({ PI_TOOLS_SUBAGENT_CHILD: "1" }),
    });
    expect(deps.rm).toHaveBeenCalled();
  });

  it.each(["--approve", "-a", "--no-tools", "--help", "@secret", "-arbitrary"])(
    "passes parser-sensitive prompt %s only through stdin",
    async (prompt) => {
      const deps = dependencies();
      const { promise } = await launch(
        deps,
        request({
          prepared: { ...request().prepared, cwd: "/outside", prompt },
          parentTrusted: false,
        }),
      );
      deps.child.emit("close", 0);
      await promise;
      expect(deps.spawn.mock.calls[0]?.[1]).not.toContain(prompt);
      expect(deps.child.stdin.end).toHaveBeenCalledWith(prompt, "utf8");
    },
  );

  it("does not trust siblings, prefix collisions, or cross-volume Windows paths", async () => {
    expect(isPathWithin("/parent", "/parentish/child")).toBe(false);
    expect(isPathWithin("C:\\parent", "D:\\parent\\child", win32)).toBe(false);
    const deps = dependencies();
    const { promise } = await launch(
      deps,
      request({ prepared: { ...request().prepared, cwd: "/outside" } }),
    );
    deps.child.emit("close", 0);
    await promise;
    expect(deps.spawn.mock.calls[0]?.[1]).not.toContain("--approve");
    expect(deps.spawn.mock.calls[0]?.[1]).not.toContain("--no-approve");
  });

  it("parses split multibyte JSONL, EOF lines, usage, retry, and tool activity", async () => {
    const deps = dependencies();
    const updates: unknown[] = [];
    const { promise } = await launch(deps, request({ onUpdate: (value) => updates.push(value) }));
    const retry = `${JSON.stringify({ type: "auto_retry_start", errorMessage: "retry 😀" })}\n`;
    const bytes = Buffer.from(retry);
    const split = bytes.indexOf(Buffer.from("😀")) + 2;
    deps.child.stdout.emit("data", bytes.subarray(0, split));
    deps.child.stdout.emit("data", bytes.subarray(split));
    deps.child.stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ type: "tool_execution_start", toolName: "read" })}\n${JSON.stringify({ type: "auto_retry_end", success: true })}\n${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.5 } } } })}`,
      ),
    );
    deps.child.emit("close", 0);
    const result = await promise;
    expect(result).toMatchObject({
      state: "completed",
      report: "done",
      retries: 1,
      retryActive: false,
      usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5 },
    });
    expect(result.activity.map((entry) => entry.kind)).toEqual([
      "retry_start",
      "tool_start",
      "retry_end",
    ]);
    expect(result.activity[0]?.text).toContain("😀");
    expect(updates.length).toBeGreaterThan(0);
  });

  it("bounds malformed and oversized lines without corrupting later events", async () => {
    const deps = dependencies();
    const { promise } = await launch(deps);
    deps.child.stdout.emit("data", Buffer.from(`not json\n${"x".repeat(1024 * 1024 + 1)}\n`));
    deps.child.stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "after" }] } })}\n`,
      ),
    );
    deps.child.emit("close", 0);
    const result = await promise;
    expect(result.report).toBe("after");
    expect(result.activity.filter((entry) => entry.kind === "diagnostic")).toHaveLength(2);
  });

  it("terminates the process tree gracefully then forcibly on cancellation", async () => {
    const deps = dependencies();
    const controller = new AbortController();
    const { promise } = await launch(deps, request({ signal: controller.signal }));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.signalTree).toHaveBeenNthCalledWith(1, deps.child, "SIGTERM");
    expect(deps.signalTree).toHaveBeenNthCalledWith(2, deps.child, "SIGKILL");
    await expect(promise).resolves.toMatchObject({ state: "cancelled" });
  });

  it("normalizes prompt pipe failures and terminates the child tree", async () => {
    const deps = dependencies();
    const { promise } = await launch(deps);
    deps.child.stdin.emit("error", new Error("broken pipe"));
    await expect(promise).resolves.toMatchObject({
      state: "failed",
      failure: "Failed to send subagent prompt: broken pipe",
    });
    expect(deps.signalTree).toHaveBeenCalledWith(deps.child, "SIGTERM");
  });

  it("settles close/error races once and cleans up", async () => {
    const deps = dependencies();
    const { promise } = await launch(deps);
    deps.child.emit("error", new Error("spawn failed"));
    deps.child.emit("close", 1);
    await expect(promise).resolves.toMatchObject({ state: "failed", failure: "spawn failed" });
    expect(deps.rm).toHaveBeenCalledTimes(1);
  });

  it("reports cleanup failures instead of rejecting or hiding them", async () => {
    const deps = dependencies();
    deps.rm.mockRejectedValueOnce(new Error("permission denied"));
    const { promise } = await launch(deps);
    deps.child.emit("close", 0);
    await expect(promise).resolves.toMatchObject({
      state: "failed",
      failure: "Failed to clean up subagent prompt: permission denied",
    });
  });

  it("awaits termination of active children during shutdown", async () => {
    const deps = dependencies();
    const { runner, promise } = await launch(deps);
    const shutdown = runner.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.signalTree).toHaveBeenCalledWith(deps.child, "SIGTERM");
    deps.child.emit("close", 0);
    await shutdown;
    await promise;
  });

  it("prevents spawn and awaits a run interrupted during pre-launch setup", async () => {
    const gate = deferred<string>();
    const deps = dependencies();
    deps.canonicalize = vi.fn(() => gate.promise);
    const runner = new SubprocessRunner(deps as never);
    const run = runner.run(request());
    const shutdown = runner.shutdown();
    let shutdownFinished = false;
    void shutdown.then(() => {
      shutdownFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shutdownFinished).toBe(false);
    gate.resolve("/parent/child");
    await expect(run).resolves.toMatchObject({ state: "cancelled" });
    await shutdown;
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it("awaits delayed prompt cleanup before shutdown completes", async () => {
    const cleanup = deferred<void>();
    const deps = dependencies();
    deps.rm = vi.fn(() => cleanup.promise);
    const { runner, promise } = await launch(deps);
    deps.child.emit("close", 0);
    const shutdown = runner.shutdown();
    let shutdownFinished = false;
    void shutdown.then(() => {
      shutdownFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shutdownFinished).toBe(false);
    cleanup.resolve();
    await promise;
    await shutdown;
  });

  it("truncates UTF-8 without splitting a code point", () => {
    const value = truncateUtf8("😀".repeat(100), 31);
    expect(Buffer.byteLength(value, "utf8")).toBeLessThanOrEqual(31);
    expect(value).not.toContain("�");
    expect(value).toContain("[truncated]");
  });
});
