import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExecutionDetails,
  ExecutionOutcome,
  ExecutionUsage,
  ProfileCapability,
  ProfileDefinition,
  ProfileRegistrationResult,
  ToolSummaryCapability,
  ToolSummaryRegistrationResult,
} from "./api.js";
import {
  CHILD_MARKER,
  MAX_EXECUTION_FACT_BYTES,
  MAX_EXECUTION_FACT_CHARACTERS,
  SUBAGENT_PROFILE_CAPABILITY_EVENT,
  SUBAGENT_PROFILE_PROTOCOL_VERSION,
  SUBAGENT_PROFILE_REGISTRATION_RESULT_EVENT,
  SUBAGENT_PROFILE_REQUEST_EVENT,
  SUBAGENT_TOOL_SUMMARY_CAPABILITY_EVENT,
  SUBAGENT_TOOL_SUMMARY_PROTOCOL_VERSION,
  SUBAGENT_TOOL_SUMMARY_REGISTRATION_RESULT_EVENT,
  SUBAGENT_TOOL_SUMMARY_REQUEST_EVENT,
} from "./api.js";
import { createSubagentToolkit, validateProfileData } from "./index.js";

interface RegisteredTool {
  name: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  renderResult?: (
    result: { details: ExecutionDetails },
    options: { expanded: boolean },
    theme: { fg(color: string, text: string): string; bold(text: string): string },
  ) => { render(width: number): string[] };
  execute: (
    id: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: ((result: unknown) => void) | undefined,
    context: unknown,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: ExecutionDetails;
    usage?: ExecutionUsage;
  }>;
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
    usage: {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      reasoning: 1,
      totalTokens: 10,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.1, cacheWrite: 0.1, total: 0.5 },
    },
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
    let summaryAnnouncements = 0;
    child.api.events.on(SUBAGENT_TOOL_SUMMARY_CAPABILITY_EVENT, () => {
      summaryAnnouncements++;
    });
    createSubagentToolkit(child.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    child.start();
    expect(child.tools).toHaveLength(0);
    expect(summaryAnnouncements).toBe(0);
    expect(child.eventHandlers.get(SUBAGENT_TOOL_SUMMARY_REQUEST_EVENT)).toBeUndefined();
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
      usage: { input: 1, output: 2, reasoning: 1, cost: { total: 0.5 } },
    });
    expect(result?.usage).toEqual(result?.details.usage);
    expect(updates).toHaveLength(1);
  });

  it.each([
    ["synchronous", () => ({ provider: "p", id: "m", thinkingLevels: ["off"] as ["off"] })],
    ["asynchronous", async () => ({ provider: "p", id: "m", thinkingLevels: ["off"] as ["off"] })],
  ])("awaits %s model selection before validation and lookup", async (_kind, selectModel) => {
    const harness = fakePi();
    const run = vi.fn(async () => completedOutcome());
    createSubagentToolkit(harness.api, {
      runner: { run, shutdown: vi.fn(async () => undefined) },
      profiles: [customProfile({ selectModel })],
    });
    harness.start();
    const result = await harness.tools[0]?.execute(
      "call",
      { task: "focus" },
      undefined,
      undefined,
      context(),
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.objectContaining({ provider: "p", id: "m" }) }),
    );
    expect(result?.details).toMatchObject({
      state: "completed",
      model: { provider: "p", id: "m" },
    });
  });

  it("rejects an invalid asynchronously selected model before registry lookup", async () => {
    const harness = fakePi();
    const run = vi.fn();
    createSubagentToolkit(harness.api, {
      runner: { run, shutdown: vi.fn(async () => undefined) },
      profiles: [customProfile({ selectModel: async () => ({ provider: "p" }) as never })],
    });
    harness.start();
    const toolContext = context();
    const find = vi.fn();
    toolContext.modelRegistry.find = find;
    const result = await harness.tools[0]?.execute(
      "call",
      { task: "focus" },
      undefined,
      undefined,
      toolContext,
    );
    expect(result?.details).toMatchObject({
      state: "failed",
      failure: "Profile selected an invalid model",
    });
    expect(find).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
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
    const originalOutcome = completedOutcome();
    let callbackOutcome: ExecutionOutcome | undefined;
    const retained = { summary: "bounded", nested: { value: "original" } };
    createSubagentToolkit(harness.api, {
      runner: {
        run: vi.fn(async () => originalOutcome),
        shutdown: vi.fn(async () => undefined),
      },
      profiles: [
        customProfile({
          profileDataSchema: Type.Object({
            summary: Type.String(),
            nested: Type.Object({ value: Type.String() }),
          }),
          afterRun: (outcome) => {
            callbackOutcome = outcome;
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
    expect(callbackOutcome).not.toBe(originalOutcome);
    expect(Object.isFrozen(callbackOutcome)).toBe(true);
    expect(Object.isFrozen(callbackOutcome?.activity)).toBe(true);
    expect(Object.isFrozen(callbackOutcome?.activity[0])).toBe(true);
    originalOutcome.report = "runner remains mutable";
    if (originalOutcome.activity[0]) originalOutcome.activity[0].text = "runner remains mutable";
    retained.summary = "mutated later";
    retained.nested.value = "mutated later";
    expect(result?.details).toMatchObject({
      report: "done",
      activity: [{ kind: "tool_end", text: "read" }],
      profileData: { summary: "bounded", nested: { value: "original" } },
    });
    const persisted = result?.details.profileData as typeof retained | undefined;
    expect(Object.isFrozen(persisted)).toBe(true);
    expect(Object.isFrozen(persisted?.nested)).toBe(true);
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
      usage: {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        cost: { total: 0.5 },
      },
      failure: "Profile returned data that does not match its schema",
    });
    expect(invalid?.usage).toEqual(invalid?.details.usage);

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
    expect(failed?.usage).toBeUndefined();
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
    expect(result?.usage).toBeUndefined();
  });

  it("rejects invalid thinking callback output before launching", async () => {
    const harness = fakePi();
    const run = vi.fn(async () => completedOutcome());
    createSubagentToolkit(harness.api, {
      runner: { run, shutdown: vi.fn(async () => undefined) },
      profiles: [customProfile({ selectThinkingLevel: () => "invalid" as never })],
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
      failure: "Profile selected an invalid thinking level",
    });
    expect(run).not.toHaveBeenCalled();
    expect(result?.usage).toBeUndefined();
  });

  it("bounds persisted profile and CWD execution facts", async () => {
    const harness = fakePi();
    const oversized = "é".repeat(MAX_EXECUTION_FACT_BYTES);
    const characterBoundary = `${"a".repeat(MAX_EXECUTION_FACT_CHARACTERS - 1)}😀z`;
    createSubagentToolkit(harness.api, {
      runner: {
        run: vi.fn(async () => completedOutcome()),
        shutdown: vi.fn(async () => undefined),
      },
      profiles: [
        customProfile({
          id: characterBoundary,
          prepare: ({ args }) => ({
            cwd: oversized,
            systemPrompt: "system",
            prompt: (args as { task: string }).task,
            toolPolicy: { mode: "allowlist", tools: [] },
          }),
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
    expect(Buffer.byteLength(result?.details.profileId ?? "", "utf8")).toBeLessThanOrEqual(
      MAX_EXECUTION_FACT_BYTES,
    );
    expect(result?.details.profileId.endsWith("😀")).toBe(true);
    expect(Buffer.byteLength(result?.details.cwd ?? "", "utf8")).toBeLessThanOrEqual(
      MAX_EXECUTION_FACT_BYTES,
    );
  });

  it("retains usage on terminal cancellation after child launch", async () => {
    const harness = fakePi();
    createSubagentToolkit(harness.api, {
      runner: {
        run: vi.fn(async () => ({
          ...completedOutcome(),
          state: "cancelled" as const,
          failure: "cancelled",
        })),
        shutdown: vi.fn(async () => undefined),
      },
    });
    harness.start();
    const result = await harness.tools[0]?.execute(
      "call",
      { task: "focus" },
      undefined,
      undefined,
      context(),
    );
    expect(result?.details.state).toBe("cancelled");
    expect(result?.usage).toEqual(result?.details.usage);
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
    expect(result?.usage).toBeUndefined();
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

  it("forwards prompt metadata and publishes finalization only after tool installation", () => {
    const harness = fakePi();
    const results: ProfileRegistrationResult[] = [];
    harness.api.events.on(SUBAGENT_PROFILE_CAPABILITY_EVENT, (data) => {
      (data as ProfileCapability).register({
        registrationId: "prompt-guided",
        profiles: [
          customProfile({
            promptSnippet: "Use custom_agent for focused review.",
            promptGuidelines: ["Use custom_agent only for focused review."],
          }),
        ],
        suppressDefault: true,
      });
    });
    harness.api.events.on(SUBAGENT_PROFILE_REGISTRATION_RESULT_EVENT, (data) => {
      results.push(data as ProfileRegistrationResult);
      expect(harness.tools.map((tool) => tool.name)).toContain("custom_agent");
    });
    createSubagentToolkit(harness.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    harness.start();
    expect(harness.tools[0]).toMatchObject({
      name: "custom_agent",
      promptSnippet: "Use custom_agent for focused review.",
      promptGuidelines: ["Use custom_agent only for focused review."],
    });
    expect(results).toEqual([
      { protocolVersion: 2, registrationId: "prompt-guided", state: "registered" },
    ]);
  });

  it("turns a returned policy failure into a failed result while cancellation remains authoritative", async () => {
    const policyFailure = fakePi();
    createSubagentToolkit(policyFailure.api, {
      runner: {
        run: vi.fn(async () => completedOutcome()),
        shutdown: vi.fn(async () => undefined),
      },
      profiles: [
        customProfile({
          afterRun: () => ({ failure: "commit policy failed", profileData: { summary: "audit" } }),
        }),
      ],
    });
    policyFailure.start();
    const failed = await policyFailure.tools[0]?.execute(
      "call",
      { task: "focus" },
      undefined,
      undefined,
      context(),
    );
    expect(failed?.content).toEqual([{ type: "text", text: "commit policy failed" }]);
    expect(failed?.details).toMatchObject({
      state: "failed",
      failure: "commit policy failed",
      profileData: { summary: "audit" },
      retries: 1,
      usage: { input: 1 },
    });

    const cancelled = fakePi();
    const controller = new AbortController();
    createSubagentToolkit(cancelled.api, {
      runner: {
        run: vi.fn(async () => completedOutcome()),
        shutdown: vi.fn(async () => undefined),
      },
      profiles: [
        customProfile({
          afterRun: () => {
            controller.abort();
            return { failure: "commit policy failed", profileData: { summary: "audit" } };
          },
        }),
      ],
    });
    cancelled.start();
    const result = await cancelled.tools[0]?.execute(
      "call",
      { task: "focus" },
      controller.signal,
      undefined,
      context(),
    );
    expect(result?.details).toMatchObject({
      state: "cancelled",
      profileData: { summary: "audit" },
    });
    expect(result?.details.failure).not.toBe("commit policy failed");

    const failedChild = fakePi();
    createSubagentToolkit(failedChild.api, {
      runner: {
        run: vi.fn(async () => ({
          ...completedOutcome(),
          state: "failed" as const,
          failure: "child failed",
        })),
        shutdown: vi.fn(async () => undefined),
      },
      profiles: [
        customProfile({
          afterRun: () => ({ failure: "commit policy failed", profileData: { summary: "audit" } }),
        }),
      ],
    });
    failedChild.start();
    const failedResult = await failedChild.tools[0]?.execute(
      "call",
      { task: "focus" },
      undefined,
      undefined,
      context(),
    );
    expect(failedResult?.content).toEqual([{ type: "text", text: "commit policy failed" }]);
    expect(failedResult?.details).toMatchObject({
      profileId: "custom",
      cwd: "/parent",
      model: { provider: "p", id: "m" },
      state: "failed",
      failure: "commit policy failed",
      profileData: { summary: "audit" },
      retries: 1,
      activity: [{ kind: "tool_end", text: "read" }],
      usage: { input: 1 },
    });
  });

  it("fails closed only for uncorrelated exclusive calls", () => {
    const harness = fakePi();
    createSubagentToolkit(harness.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    harness.start();
    const preflight = harness.handlers.get("tool_call")?.[0];
    expect(preflight?.({ toolCallId: "missing", toolName: "subagent" }, context())).toEqual({
      block: true,
      reason: "Cannot verify this exclusive subagent call is alone; retry this tool alone",
    });
    expect(preflight?.({ toolCallId: "missing", toolName: "read" }, context())).toBeUndefined();
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
    const consumerFirstResults: ProfileRegistrationResult[] = [];
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
    consumerFirst.api.events.on(SUBAGENT_PROFILE_REGISTRATION_RESULT_EVENT, (data) => {
      consumerFirstResults.push(data as ProfileRegistrationResult);
      expect(consumerFirst.tools.map((tool) => tool.name)).toContain("custom_agent");
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
    expect(consumerFirstResults).toEqual([
      { protocolVersion: 2, registrationId: "consumer:review", state: "registered" },
    ]);

    const toolkitFirst = fakePi();
    createSubagentToolkit(toolkitFirst.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    const toolkitFirstReceipts: unknown[] = [];
    const toolkitFirstResults: ProfileRegistrationResult[] = [];
    toolkitFirst.api.events.on(SUBAGENT_PROFILE_REGISTRATION_RESULT_EVENT, (data) => {
      toolkitFirstResults.push(data as ProfileRegistrationResult);
      expect(toolkitFirst.tools.map((tool) => tool.name)).toContain("custom_agent");
    });
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
    expect(toolkitFirstResults).toEqual([
      { protocolVersion: 2, registrationId: "consumer:review", state: "registered" },
    ]);
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

  it("removes discovered profile names and releases marked-child bus listeners", async () => {
    process.env[CHILD_MARKER] = "1";
    const sharedBus = new Map<string, Array<(data: unknown) => void>>();
    const child = fakePi(["read", "subagent", "custom_agent"], sharedBus);
    let correlatedReplies = 0;
    child.api.events.on(SUBAGENT_PROFILE_CAPABILITY_EVENT, (data) => {
      const capability = data as ProfileCapability;
      if (capability.correlationId === "after-child-shutdown") correlatedReplies++;
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
    await child.shutdown();

    delete process.env[CHILD_MARKER];
    const replacement = fakePi(["read"], sharedBus);
    createSubagentToolkit(replacement.api, {
      runner: { run: vi.fn(), shutdown: vi.fn(async () => undefined) },
    });
    replacement.api.events.emit(SUBAGENT_PROFILE_REQUEST_EVENT, {
      protocolVersion: SUBAGENT_PROFILE_PROTOCOL_VERSION,
      correlationId: "after-child-shutdown",
    });
    expect(correlatedReplies).toBe(1);
  });

  it("does not override configured inactive tools during finalization", () => {
    const harness = fakePi(["read", "inactive_agent"]);
    const results: ProfileRegistrationResult[] = [];
    harness.api.events.on(SUBAGENT_PROFILE_REGISTRATION_RESULT_EVENT, (data) => {
      results.push(data as ProfileRegistrationResult);
    });
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
    expect(results).toEqual([
      {
        protocolVersion: 2,
        registrationId: "collision",
        state: "rejected",
        reason: "Profile tool collision: inactive_agent",
      },
    ]);
  });

  it("replays and applies exclusive custom tool summaries across persisted surfaces", async () => {
    const secret = "RAW_ARGUMENT_SENTINEL";
    const run = vi.fn(
      async (request: { summarizeTool?: (toolName: string, args: unknown) => string }) => ({
        ...completedOutcome(),
        activity: [
          {
            kind: "tool_start" as const,
            text: request.summarizeTool?.("read", { path: "safe.ts" }) ?? "missing",
          },
          {
            kind: "tool_start" as const,
            text:
              request.summarizeTool?.("custom_tool", { secret, nested: { value: 1 } }) ?? "missing",
          },
          {
            kind: "tool_start" as const,
            text: request.summarizeTool?.("invalid_tool", {}) ?? "missing",
          },
          {
            kind: "tool_start" as const,
            text: request.summarizeTool?.("throwing_tool", {}) ?? "missing",
          },
          {
            kind: "tool_start" as const,
            text: request.summarizeTool?.("unknown_tool", { secret }) ?? "missing",
          },
        ],
      }),
    );
    const harness = fakePi();
    const results: ToolSummaryRegistrationResult[] = [];
    createSubagentToolkit(harness.api, {
      runner: { run, shutdown: vi.fn(async () => undefined) },
    });

    let capability: ToolSummaryCapability | undefined;
    harness.api.events.on(SUBAGENT_TOOL_SUMMARY_CAPABILITY_EVENT, (data) => {
      const candidate = data as ToolSummaryCapability;
      if (
        candidate.protocolVersion === SUBAGENT_TOOL_SUMMARY_PROTOCOL_VERSION &&
        candidate.correlationId === "late-consumer"
      )
        capability = candidate;
    });
    harness.api.events.on(SUBAGENT_TOOL_SUMMARY_REGISTRATION_RESULT_EVENT, (data) => {
      results.push(data as ToolSummaryRegistrationResult);
    });
    harness.api.events.emit(SUBAGENT_TOOL_SUMMARY_REQUEST_EVENT, {
      protocolVersion: SUBAGENT_TOOL_SUMMARY_PROTOCOL_VERSION,
      correlationId: "late-consumer",
    });
    const registration = {
      registrationId: "custom",
      resolvers: [
        {
          toolName: "custom_tool",
          resolve: (args: unknown) =>
            (args as { secret?: string }).secret === secret ? "custom safe" : "wrong",
        },
      ],
    };
    const receipt = capability?.register(registration);
    expect(receipt?.state).toBe("pending");
    expect(capability?.register(registration)).toBe(receipt);
    capability?.register({
      registrationId: "invalid",
      resolvers: [{ toolName: "invalid_tool", resolve: () => "bad\nvalue" }],
    });
    capability?.register({
      registrationId: "throws",
      resolvers: [
        {
          toolName: "throwing_tool",
          resolve: () => {
            throw new Error("resolver failed");
          },
        },
      ],
    });
    capability?.register({
      registrationId: "built-in",
      resolvers: [{ toolName: "read", resolve: () => "unsafe" }],
    });

    harness.start();
    expect(results).toEqual([
      { protocolVersion: 1, registrationId: "custom", state: "registered" },
      { protocolVersion: 1, registrationId: "invalid", state: "registered" },
      { protocolVersion: 1, registrationId: "throws", state: "registered" },
      {
        protocolVersion: 1,
        registrationId: "built-in",
        state: "rejected",
        reason: "Reserved tool summary: read",
      },
    ]);
    const result = await harness.tools[0]?.execute(
      "call",
      { task: "focus" },
      undefined,
      undefined,
      context(),
    );
    expect(result?.details.activity.map((entry) => entry.text)).toEqual([
      "read safe.ts",
      "custom safe",
      "invalid_tool",
      "throwing_tool",
      "unknown_tool",
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
    const reconstructed = JSON.parse(JSON.stringify(result?.details)) as ExecutionDetails;
    const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
    for (const expanded of [false, true]) {
      const rendered = harness.tools[0]
        ?.renderResult?.({ details: reconstructed }, { expanded }, theme)
        .render(120)
        .join("\n");
      expect(rendered).not.toContain(secret);
      if (expanded) expect(rendered).toContain("custom safe");
    }
    expect(
      capability?.register({
        registrationId: "late",
        resolvers: [{ toolName: "late", resolve: () => "late" }],
      }),
    ).toMatchObject({ state: "late" });
    await harness.shutdown();
    expect(harness.eventHandlers.get(SUBAGENT_TOOL_SUMMARY_REQUEST_EVENT)).toEqual([]);
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
