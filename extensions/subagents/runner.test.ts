import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { type RunRequest, SubprocessRunner, truncateUtf8 } from "./runner.js";

function fakeChild(pid = 123) {
  return Object.assign(new EventEmitter(), {
    pid,
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
}

function request(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    cwd: "/project",
    task: "inspect this",
    systemPrompt: "role prompt",
    model: { provider: "provider", id: "model" },
    thinkingLevel: "high",
    tools: ["read", "bash"],
    approved: true,
    ...overrides,
  };
}

function dependencies(child = fakeChild()) {
  return {
    child,
    spawn: vi.fn((..._args: unknown[]) => child),
    mkdtemp: vi.fn(async () => "/tmp/prompt"),
    writeFile: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    executable: () => ({ command: "pi", prefix: [] }),
    signalTree: vi.fn(),
    delay: vi.fn(async () => undefined),
  };
}

async function launch(deps = dependencies(), value = request()) {
  const runner = new SubprocessRunner(deps as never);
  const result = runner.run(value);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { deps, runner, result };
}

function event(child: ReturnType<typeof fakeChild>, value: unknown): void {
  child.stdout.emit("data", Buffer.from(`${JSON.stringify(value)}\n`));
}

function assistant(text: string, extra: Record<string, unknown> = {}) {
  return {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }], ...extra },
  };
}

describe("SubprocessRunner", () => {
  it("launches a no-session JSON child with skills, no context files, and stdin task", async () => {
    const { deps, result } = await launch();
    deps.child.emit("close", 0);
    await expect(result).resolves.toMatchObject({ state: "completed" });

    const args = deps.spawn.mock.calls[0]?.[1] as unknown as string[];
    expect(args).toEqual(
      expect.arrayContaining([
        "--mode",
        "json",
        "--print",
        "--no-session",
        "--no-context-files",
        "--model",
        "provider/model",
        "--thinking",
        "high",
        "--tools",
        "read,bash",
        "--approve",
      ]),
    );
    expect(args).not.toContain("--no-skills");
    expect(args).not.toContain("--no-extensions");
    expect(deps.child.stdin.end).toHaveBeenCalledWith("inspect this", "utf8");
    expect(deps.writeFile).toHaveBeenCalledWith(
      "/tmp/prompt/system-prompt.txt",
      "role prompt",
      expect.objectContaining({ mode: 0o600 }),
    );
    expect(deps.spawn.mock.calls[0]?.[2]).toMatchObject({
      cwd: "/project",
      detached: true,
      shell: false,
      env: expect.objectContaining({ PI_TOOLS_SUBAGENT_CHILD: "1" }),
    });
  });

  it("omits a custom system prompt for the direct generic tool and approval for untrusted parents", async () => {
    const { systemPrompt: _systemPrompt, ...genericRequest } = request({
      approved: false,
      tools: [],
    });
    const { deps, result } = await launch(dependencies(), genericRequest);
    deps.child.emit("close", 0);
    await result;
    const args = deps.spawn.mock.calls[0]?.[1] as unknown as string[];
    expect(args).not.toContain("--system-prompt");
    expect(args).not.toContain("--approve");
    expect(args).toContain("--no-tools");
    expect(deps.mkdtemp).not.toHaveBeenCalled();
  });

  it("lets a successful automatic retry supersede the earlier assistant failure", async () => {
    const { deps, result } = await launch();
    event(deps.child, assistant("", { errorMessage: "temporary failure", usage: { input: 1 } }));
    event(deps.child, { type: "auto_retry_start", attempt: 1 });
    event(deps.child, { type: "auto_retry_end", success: true });
    event(
      deps.child,
      assistant("final report", {
        usage: {
          input: 2,
          output: 3,
          totalTokens: 5,
          cost: { total: 0.25 },
        },
      }),
    );
    deps.child.emit("close", 0);

    await expect(result).resolves.toMatchObject({
      state: "completed",
      report: "final report",
      usage: { input: 3, output: 3, totalTokens: 5, cost: { total: 0.25 } },
    });
  });

  it("treats prompt cleanup as best effort for success and failure", async () => {
    for (const code of [0, 1]) {
      const deps = dependencies();
      deps.rm.mockRejectedValueOnce(new Error("permission denied"));
      const launched = await launch(deps);
      if (code === 0) event(deps.child, assistant("done"));
      else deps.child.stderr.emit("data", Buffer.from("real failure"));
      deps.child.emit("close", code);
      await expect(launched.result).resolves.toMatchObject(
        code === 0
          ? { state: "completed", report: "done" }
          : { state: "failed", failure: "real failure" },
      );
    }
  });

  it("normalizes a successful blank assistant report", async () => {
    const { deps, result } = await launch();
    event(deps.child, assistant("  \n"));
    deps.child.emit("close", 0);
    await expect(result).resolves.toMatchObject({
      state: "completed",
      report: "Subagent completed without a text report.",
    });
  });

  it("bounds malformed and oversized JSONL while retaining later valid output", async () => {
    const { deps, result } = await launch();
    deps.child.stdout.emit("data", Buffer.from(`not json\n${"x".repeat(1024 * 1024 + 1)}\n`));
    event(deps.child, assistant("after bounds"));
    deps.child.emit("close", 0);
    await expect(result).resolves.toMatchObject({ report: "after bounds" });
  });

  it("bounds stderr and reports spawn failures", async () => {
    const stderrRun = await launch();
    stderrRun.deps.child.stderr.emit("data", Buffer.from("😀".repeat(20_000)));
    stderrRun.deps.child.emit("close", 1);
    const stderrResult = await stderrRun.result;
    expect(stderrResult.state).toBe("failed");
    expect(Buffer.byteLength(stderrResult.failure ?? "", "utf8")).toBeLessThanOrEqual(16 * 1024);
    expect(stderrResult.failure).not.toContain("�");

    const spawnRun = await launch();
    spawnRun.deps.child.emit("error", new Error("spawn failed"));
    await expect(spawnRun.result).resolves.toMatchObject({
      state: "failed",
      failure: "spawn failed",
    });
  });

  it("terminates the POSIX process group with TERM then KILL on cancellation", async () => {
    const controller = new AbortController();
    const { deps, result } = await launch(dependencies(), request({ signal: controller.signal }));
    controller.abort();
    await expect(result).resolves.toMatchObject({ state: "cancelled" });
    expect(deps.signalTree).toHaveBeenNthCalledWith(1, deps.child, "SIGTERM");
    expect(deps.signalTree).toHaveBeenNthCalledWith(2, deps.child, "SIGKILL");
  });

  it("waits for active children during shutdown", async () => {
    const { deps, runner, result } = await launch();
    const shutdown = runner.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deps.signalTree).toHaveBeenCalledWith(deps.child, "SIGTERM");
    deps.child.emit("close", 0);
    await shutdown;
    await expect(result).resolves.toMatchObject({ state: "cancelled" });
  });

  it("does not launch an already aborted request and truncates UTF-8 safely", async () => {
    const controller = new AbortController();
    controller.abort();
    const spawn = vi.fn();
    const runner = new SubprocessRunner({ spawn: spawn as never });
    await expect(runner.run(request({ signal: controller.signal }))).resolves.toMatchObject({
      state: "cancelled",
    });
    expect(spawn).not.toHaveBeenCalled();

    const text = truncateUtf8("😀".repeat(100), 31);
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(31);
    expect(text).not.toContain("�");
    expect(text).toContain("[truncated]");
  });
});
