import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExecutionDetails,
  ExecutionOutcome,
  ProfileCapability,
  ProfileDefinition,
} from "./api.js";
import {
  CHILD_MARKER,
  SUBAGENT_PROFILE_CAPABILITY_EVENT,
  SUBAGENT_PROFILE_PROTOCOL_VERSION,
  SUBAGENT_PROFILE_REQUEST_EVENT,
} from "./api.js";
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

function fakePi(
  configuredTools = ["read"],
  eventHandlers = new Map<string, Array<(data: unknown) => void>>(),
) {
  const tools: RegisteredTool[] = [];
  const handlers = new Map<string, Handler[]>();
  let activeTools = [...configuredTools];
  const api = {
    registerTool: (tool: RegisteredTool) => tools.push(tool),
    getActiveTools: () => [...activeTools],
    getAllTools: () => [
      ...configuredTools.map((name) => ({ name })),
      ...tools.map(({ name }) => ({ name })),
    ],
    setActiveTools: (names: string[]) => {
      activeTools = [...names];
    },
    on: (event: string, handler: Handler) => {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
    events: {
      on: (event: string, handler: (data: unknown) => void) => {
        const existing = eventHandlers.get(event) ?? [];
        existing.push(handler);
        eventHandlers.set(event, existing);
        return () => {
          const current = eventHandlers.get(event) ?? [];
          eventHandlers.set(
            event,
            current.filter((candidate) => candidate !== handler),
          );
        };
      },
      emit: (event: string, data: unknown) => {
        eventHandlers.get(event)?.forEach((handler) => {
          handler(data);
        });
      },
    },
  };
  const start = () =>
    handlers.get("session_start")?.forEach((handler) => {
      handler({}, context());
    });
  const shutdown = async () => {
    for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, context());
  };
  return {
    api: api as unknown as ExtensionAPI,
    tools,
    handlers,
    eventHandlers,
    start,
    shutdown,
    activeTools: () => [...activeTools],
  };
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

function customProfile(overrides: Partial<ProfileDefinition> = {}): ProfileDefinition {
  return {
    id: "custom",
    toolName: "custom_agent",
    label: "Custom",
    description: "Custom profile",
    parameters: Type.Object({ task: Type.String() }),
    profileDataSchema: Type.Object({ summary: Type.String() }, { additionalProperties: false }),
    selectModel: ({ parent }) => parent.model,
    prepare: ({ args, parent }) => ({
      cwd: parent.cwd,
      systemPrompt: "custom system",
      prompt: (args as { task: string }).task,
      toolPolicy: { mode: "allowlist", tools: [] },
    }),
    ...overrides,
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
    parent.start();
    expect(parent.tools.map((tool) => tool.name)).toEqual(["subagent"]);

    process.env[CHILD_MARKER] = "1";
    const child = fakePi();
    createSubagentToolkit(child.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    child.start();
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
    harness.start();
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

  it("transfers callback state, transforms reports, and persists schema-validated data", async () => {
    const harness = fakePi();
    const beforeRun = vi.fn(() => ({ token: "prepared" }));
    const afterRun = vi.fn((_outcome, state) => ({
      report: `transformed ${String((state as { token: string }).token)}`,
      profileData: { summary: "bounded" },
    }));
    createSubagentToolkit(harness.api, {
      runner: {
        run: vi.fn(async () => completedOutcome()),
        shutdown: vi.fn(async () => undefined),
      },
      profiles: [customProfile({ beforeRun, afterRun })],
    });
    harness.start();
    const result = await harness.tools[0]?.execute(
      "call",
      { task: "focus" },
      undefined,
      undefined,
      context(),
    );
    expect(beforeRun).toHaveBeenCalledTimes(1);
    expect(afterRun).toHaveBeenCalledWith(expect.objectContaining({ report: "done" }), {
      token: "prepared",
    });
    expect(result?.content).toEqual([{ type: "text", text: "transformed prepared" }]);
    expect(result?.details.profileData).toEqual({ summary: "bounded" });
  });

  it("protects runner outcomes and detaches validated profile data from callback aliases", async () => {
    const harness = fakePi();
    const retained = { summary: "bounded" };
    createSubagentToolkit(harness.api, {
      runner: {
        run: vi.fn(async () => completedOutcome()),
        shutdown: vi.fn(async () => undefined),
      },
      profiles: [
        customProfile({
          afterRun: (outcome) => {
            Reflect.set(outcome, "report", "tampered");
            Reflect.set(outcome.activity[0] ?? {}, "text", "tampered");
            return { profileData: retained };
          },
        }),
      ],
    });
    harness.start();
    const result = await harness.tools[0]?.execute(
      "call",
      { task: "focus" },
      undefined,
      undefined,
      context(),
    );
    retained.summary = "mutated later";
    expect(result?.details).toMatchObject({
      report: "done",
      activity: [{ kind: "tool_end", text: "read" }],
      profileData: { summary: "bounded" },
    });
    expect(Object.isFrozen(result?.details.profileData)).toBe(true);
  });

  it("normalizes callback failures and profile-data schema mismatches", async () => {
    const harness = fakePi();
    createSubagentToolkit(harness.api, {
      runner: {
        run: vi.fn(async () => completedOutcome()),
        shutdown: vi.fn(async () => undefined),
      },
      profiles: [
        customProfile({
          afterRun: () => ({ profileData: { summary: 42 } }) as never,
        }),
      ],
    });
    harness.start();
    const invalid = await harness.tools[0]?.execute(
      "call",
      { task: "focus" },
      undefined,
      undefined,
      context(),
    );
    expect(invalid?.details).toMatchObject({
      state: "failed",
      cwd: "/parent",
      model: { provider: "p", id: "m" },
      report: "done",
      retries: 1,
      activity: [{ kind: "tool_end", text: "read" }],
      usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0.5 },
      failure: "Profile returned data that does not match its schema",
    });

    const throwing = fakePi();
    createSubagentToolkit(throwing.api, {
      runner: {
        run: vi.fn(async () => completedOutcome()),
        shutdown: vi.fn(async () => undefined),
      },
      profiles: [
        customProfile({
          beforeRun: () => {
            throw new Error("callback failed");
          },
        }),
      ],
    });
    throwing.start();
    const failed = await throwing.tools[0]?.execute(
      "call",
      { task: "focus" },
      undefined,
      undefined,
      context(),
    );
    expect(failed?.details).toMatchObject({ state: "failed", failure: "callback failed" });
  });

  it("rejects duplicate prepared tool names before launching", async () => {
    const harness = fakePi();
    const run = vi.fn(async () => completedOutcome());
    createSubagentToolkit(harness.api, {
      runner: { run, shutdown: vi.fn(async () => undefined) },
      profiles: [
        customProfile({
          prepare: ({ parent }) =>
            ({
              cwd: parent.cwd,
              systemPrompt: "custom system",
              prompt: "focus",
              toolPolicy: { mode: "allowlist", tools: ["child_only", "child_only"] },
            }) as never,
        }),
      ],
    });
    harness.start();
    const result = await harness.tools[0]?.execute(
      "call",
      { task: "focus" },
      undefined,
      undefined,
      context(),
    );
    expect(result?.details).toMatchObject({
      state: "failed",
      failure: "Profile prepared an invalid run",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("normalizes unknown models and marks terminal results as errors", async () => {
    const harness = fakePi();
    createSubagentToolkit(harness.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    harness.start();
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
    harness.start();
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

  it("negotiates either load order and deduplicates replayed requests", () => {
    const registration = {
      registrationId: "consumer:review",
      profiles: [customProfile()],
      suppressDefault: true,
    };

    const consumerFirst = fakePi();
    const consumerFirstReceipts: unknown[] = [];
    const correlationId = "consumer-first";
    consumerFirst.api.events.on(SUBAGENT_PROFILE_CAPABILITY_EVENT, (data) => {
      const capability = data as ProfileCapability;
      if (
        capability.protocolVersion !== SUBAGENT_PROFILE_PROTOCOL_VERSION ||
        (capability.correlationId !== undefined && capability.correlationId !== correlationId)
      )
        return;
      consumerFirstReceipts.push(capability.register(registration));
    });
    consumerFirst.api.events.emit(SUBAGENT_PROFILE_REQUEST_EVENT, {
      protocolVersion: SUBAGENT_PROFILE_PROTOCOL_VERSION,
      correlationId,
    });
    createSubagentToolkit(consumerFirst.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    consumerFirst.start();
    expect(consumerFirst.tools.map((tool) => tool.name)).toEqual(["custom_agent"]);
    expect(consumerFirstReceipts).toHaveLength(1);
    expect(consumerFirstReceipts[0]).toMatchObject({ state: "registered" });

    const toolkitFirst = fakePi();
    createSubagentToolkit(toolkitFirst.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    const toolkitFirstReceipts: unknown[] = [];
    toolkitFirst.api.events.on(SUBAGENT_PROFILE_CAPABILITY_EVENT, (data) => {
      const capability = data as ProfileCapability;
      if (capability.correlationId !== "toolkit-first") return;
      toolkitFirstReceipts.push(capability.register(registration));
    });
    for (let replay = 0; replay < 2; replay++) {
      toolkitFirst.api.events.emit(SUBAGENT_PROFILE_REQUEST_EVENT, {
        protocolVersion: SUBAGENT_PROFILE_PROTOCOL_VERSION,
        correlationId: "toolkit-first",
      });
    }
    expect(toolkitFirstReceipts[0]).toBe(toolkitFirstReceipts[1]);
    toolkitFirst.start();
    expect(toolkitFirst.tools.map((tool) => tool.name)).toEqual(["custom_agent"]);
    expect(toolkitFirstReceipts[0]).toMatchObject({ state: "registered" });
  });

  it("keeps the standalone default for absent or incompatible consumers and rejects late batches", () => {
    const harness = fakePi();
    let capability: ProfileCapability | undefined;
    createSubagentToolkit(harness.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    harness.api.events.on(SUBAGENT_PROFILE_CAPABILITY_EVENT, (data) => {
      capability = data as ProfileCapability;
    });
    harness.api.events.emit(SUBAGENT_PROFILE_REQUEST_EVENT, {
      protocolVersion: SUBAGENT_PROFILE_PROTOCOL_VERSION + 1,
      correlationId: "incompatible",
    });
    expect(capability).toBeUndefined();
    harness.start();
    expect(harness.tools.map((tool) => tool.name)).toEqual(["subagent"]);

    harness.api.events.emit(SUBAGENT_PROFILE_REQUEST_EVENT, {
      protocolVersion: SUBAGENT_PROFILE_PROTOCOL_VERSION,
      correlationId: "late",
    });
    expect(
      capability?.register({
        registrationId: "late",
        profiles: [customProfile()],
        suppressDefault: true,
      }),
    ).toMatchObject({ state: "late" });
  });

  it("renegotiates on a replacement runtime without retaining stale request listeners", async () => {
    const sharedBus = new Map<string, Array<(data: unknown) => void>>();
    const registration = {
      registrationId: "consumer:replacement",
      profiles: [customProfile()],
      suppressDefault: true,
    };
    let correlatedReplies = 0;
    const first = fakePi(["read"], sharedBus);
    first.api.events.on(SUBAGENT_PROFILE_CAPABILITY_EVENT, (data) => {
      const capability = data as ProfileCapability;
      if (capability.correlationId === "replacement-request") correlatedReplies++;
      capability.register(registration);
    });
    createSubagentToolkit(first.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    first.start();
    expect(first.tools.map((tool) => tool.name)).toEqual(["custom_agent"]);
    await first.shutdown();

    const replacement = fakePi(["read"], sharedBus);
    createSubagentToolkit(replacement.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    replacement.api.events.emit(SUBAGENT_PROFILE_REQUEST_EVENT, {
      protocolVersion: SUBAGENT_PROFILE_PROTOCOL_VERSION,
      correlationId: "replacement-request",
    });
    replacement.start();
    expect(replacement.tools.map((tool) => tool.name)).toEqual(["custom_agent"]);
    expect(correlatedReplies).toBe(1);
  });

  it("removes discovered profile names from marked child runtimes", () => {
    process.env[CHILD_MARKER] = "1";
    const child = fakePi(["read", "subagent", "custom_agent"]);
    child.api.events.on(SUBAGENT_PROFILE_CAPABILITY_EVENT, (data) => {
      const capability = data as ProfileCapability;
      capability.register({
        registrationId: "child-consumer",
        profiles: [customProfile()],
        suppressDefault: true,
      });
    });
    createSubagentToolkit(child.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    child.start();
    expect(child.tools).toEqual([]);
    expect(child.activeTools()).toEqual(["read"]);
  });

  it("does not override configured inactive tools during finalization", () => {
    const harness = fakePi(["read", "inactive_agent"]);
    harness.api.events.on(SUBAGENT_PROFILE_CAPABILITY_EVENT, (data) => {
      (data as ProfileCapability).register({
        registrationId: "collision",
        profiles: [customProfile({ toolName: "inactive_agent" })],
        suppressDefault: true,
      });
    });
    createSubagentToolkit(harness.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    harness.start();
    expect(harness.tools.map((tool) => tool.name)).toEqual(["subagent"]);
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
