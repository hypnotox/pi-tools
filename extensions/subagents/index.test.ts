import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionDetails, ExecutionOutcome } from "./api.js";
import { CHILD_MARKER } from "./api.js";
import { createSubagentToolkit, validateProfileData } from "./index.js";

interface RegisteredTool {
  name: string;
  execute: (
    id: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: ((result: unknown) => void) | undefined,
    context: unknown,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; details: ExecutionDetails }>;
}

type Handler = (event: unknown, context: unknown) => unknown;

function fakePi() {
  const tools: RegisteredTool[] = [];
  const handlers = new Map<string, Handler[]>();
  const api = {
    registerTool: (tool: RegisteredTool) => tools.push(tool),
    getActiveTools: () => ["read", "subagent"],
    on: (event: string, handler: Handler) => {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
  };
  return { api: api as unknown as ExtensionAPI, tools, handlers };
}

const runtimeModel = {
  provider: "p",
  id: "m",
  reasoning: true,
  thinkingLevelMap: { xhigh: null, max: null },
};

function context(branch: unknown[] = []) {
  return {
    cwd: "/parent",
    model: runtimeModel,
    thinkingLevel: "high",
    isProjectTrusted: () => true,
    modelRegistry: {
      find: (provider: string, id: string) =>
        provider === runtimeModel.provider && id === runtimeModel.id ? runtimeModel : undefined,
    },
    sessionManager: { getBranch: () => branch },
  };
}

function completedOutcome(): ExecutionOutcome {
  return {
    state: "completed",
    report: "done",
    usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5 },
    activity: [{ kind: "tool_end", text: "read" }],
    omittedActivity: 0,
    retries: 1,
    retryActive: false,
  };
}

afterEach(() => {
  delete process.env[CHILD_MARKER];
});

describe("subagent toolkit adapter", () => {
  it("registers exactly one default tool and deactivates it in marked children", () => {
    const parent = fakePi();
    createSubagentToolkit(parent.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    expect(parent.tools.map((tool) => tool.name)).toEqual(["subagent"]);

    process.env[CHILD_MARKER] = "1";
    const child = fakePi();
    createSubagentToolkit(child.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    expect(child.tools).toHaveLength(0);
  });

  it("resolves the registry model, clamps thinking, removes profile tools, and preserves facts", async () => {
    const harness = fakePi();
    const run = vi.fn(async (request: { onUpdate?: (value: ExecutionOutcome) => void }) => {
      const outcome = completedOutcome();
      request.onUpdate?.({ ...outcome, state: "running" });
      return outcome;
    });
    createSubagentToolkit(harness.api, {
      runner: { run, shutdown: vi.fn(async () => undefined) },
    });
    const updates: unknown[] = [];
    const result = await harness.tools[0]?.execute(
      "call",
      { task: "focus", model: "p/m", thinkingLevel: "max" },
      undefined,
      (update) => updates.push(update),
      context(),
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ provider: "p", id: "m" }),
        thinkingLevel: "high",
        tools: ["read"],
        prepared: expect.objectContaining({
          cwd: "/parent",
          prompt: "focus",
          systemPrompt: expect.stringContaining("focused subagent"),
        }),
      }),
    );
    expect(result?.content).toEqual([{ type: "text", text: "done" }]);
    expect(result?.details).toMatchObject({
      state: "completed",
      retries: 1,
      usage: { input: 1, output: 2, cost: 0.5 },
    });
    expect(updates).toHaveLength(1);
  });

  it("normalizes unknown models and marks terminal results as errors", async () => {
    const harness = fakePi();
    createSubagentToolkit(harness.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    const result = await harness.tools[0]?.execute(
      "call",
      { task: "focus", model: "missing/model" },
      undefined,
      undefined,
      context(),
    );
    expect(result?.details).toMatchObject({
      state: "failed",
      failure: "Unknown model: missing/model",
    });
    const middleware = harness.handlers.get("tool_result")?.[0];
    expect(
      middleware?.(
        {
          toolName: "subagent",
          details: result?.details,
          content: result?.content,
          isError: false,
        },
        context(),
      ),
    ).toEqual({ isError: true });
  });

  it("blocks an exclusive subagent when its assistant batch has siblings", () => {
    const harness = fakePi();
    createSubagentToolkit(harness.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    const preflight = harness.handlers.get("tool_call")?.[0];
    const branch = [
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "one", name: "read", arguments: {} },
            { type: "toolCall", id: "two", name: "subagent", arguments: {} },
          ],
        },
      },
    ];
    expect(preflight?.({ toolCallId: "two", toolName: "subagent" }, context(branch))).toEqual({
      block: true,
      reason: "An exclusive subagent tool cannot run beside sibling tools",
    });
  });

  it("awaits runner shutdown", async () => {
    const harness = fakePi();
    const shutdown = vi.fn(async () => undefined);
    createSubagentToolkit(harness.api, { runner: { run: vi.fn(), shutdown } });
    await harness.handlers.get("session_shutdown")?.[0]?.({}, context());
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid, cyclic, non-finite, and oversized profile data", () => {
    expect(validateProfileData({ ok: [true, 1, null] })).toEqual({ ok: [true, 1, null] });
    expect(() => validateProfileData({ invalid: undefined })).toThrow("JSON data");
    expect(() => validateProfileData({ invalid: Number.POSITIVE_INFINITY })).toThrow("JSON data");
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => validateProfileData(cyclic)).toThrow("acyclic");
    expect(() => validateProfileData({ value: "x".repeat(20 * 1024) })).toThrow("exceeds");
  });
});
