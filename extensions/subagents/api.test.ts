import { Type } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ConcreteModelSchema,
  ExecutionDetailsSchema,
  ExecutionProjectionSchema,
  isExecutionDetails,
  JsonValueSchema,
  MAX_EXECUTION_ACTIVITY_CHARACTERS,
  MAX_EXECUTION_FACT_BYTES,
  MAX_TOOL_RESULT_BYTES,
  PostRunResultSchema,
  PreparedRunSchema,
  type ProfileContext,
  type ProfileDefinition,
  SUBAGENT_PROFILE_PROTOCOL_VERSION,
  type ThinkingLevel,
} from "./api.js";

describe("profile API", () => {
  it("preserves TypeBox parameter inference in callbacks", () => {
    const parameters = Type.Object({ task: Type.String(), count: Type.Optional(Type.Number()) });
    const profileData = Type.Object({ summary: Type.String() });
    const definition: ProfileDefinition<typeof parameters, typeof profileData, { token: string }> =
      {
        id: "typed",
        toolName: "typed",
        label: "Typed",
        description: "Typed profile",
        parameters,
        profileDataSchema: profileData,
        selectModel(context) {
          expectTypeOf(context).toMatchTypeOf<ProfileContext<{ task: string; count?: number }>>();
          return { provider: "p", id: "m", thinkingLevels: ["off"] };
        },
        prepare(context) {
          expectTypeOf(context.args.task).toEqualTypeOf<string>();
          return {
            cwd: "/tmp",
            systemPrompt: "system",
            prompt: context.args.task,
            toolPolicy: { mode: "allowlist", tools: [] },
          };
        },
        beforeRun() {
          return { token: "state" };
        },
        afterRun(_outcome, state) {
          expectTypeOf(state).toEqualTypeOf<{ token: string } | undefined>();
          return { report: state?.token ?? "done", profileData: { summary: "typed" } };
        },
      };
    const asyncDefinition: ProfileDefinition<typeof parameters, typeof profileData> = {
      ...definition,
      async selectModel(context) {
        expectTypeOf(context).toMatchTypeOf<ProfileContext<{ task: string; count?: number }>>();
        return { provider: "p", id: "async", thinkingLevels: ["off"] };
      },
    };
    expect([definition.toolName, asyncDefinition.toolName]).toEqual(["typed", "typed"]);
  });

  it("validates concrete thinking levels and post-run shape", () => {
    expect(
      Value.Check(ConcreteModelSchema, {
        provider: "p",
        id: "m",
        thinkingLevels: ["off", "high"],
      }),
    ).toBe(true);
    expect(
      Value.Check(ConcreteModelSchema, { provider: "p", id: "m", thinkingLevels: ["invalid"] }),
    ).toBe(false);
    expect(Value.Check(PostRunResultSchema, { report: "done", profileData: { ok: true } })).toBe(
      true,
    );
    expect(Value.Check(PostRunResultSchema, { report: "done", extra: true })).toBe(false);
    expect(Value.Check(JsonValueSchema, () => undefined)).toBe(false);
    expect(
      Value.Check(PreparedRunSchema, {
        cwd: "/tmp",
        systemPrompt: "system",
        prompt: "task",
        toolPolicy: { mode: "inherit", deny: [] },
      }),
    ).toBe(true);
    expect(
      Value.Check(PreparedRunSchema, {
        cwd: "/tmp",
        prompt: "task",
        toolPolicy: { mode: "inherit", deny: [] },
      }),
    ).toBe(false);
    expectTypeOf<ThinkingLevel>().toEqualTypeOf<
      "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
    >();
    expect(SUBAGENT_PROFILE_PROTOCOL_VERSION).toBe(2);
    expect(
      Value.Check(PostRunResultSchema, {
        failure: "policy rejected result",
        profileData: { audit: true },
      }),
    ).toBe(true);
    expect(Value.Check(PostRunResultSchema, { failure: "" })).toBe(false);
    expect(Value.Check(PostRunResultSchema, { failure: " \t" })).toBe(false);
    const execution = {
      prompt: "task",
      activity: [
        { kind: "thinking", text: "considering" },
        {
          kind: "tool",
          toolCallId: "call",
          summary: "read src",
          state: "success",
          durationMs: 42,
        },
      ],
      omittedActivity: 0,
      unfinishedThinking: "still considering",
      elapsedMs: 100,
      turns: 1,
      activeUsage: {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        totalTokens: 10,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    expect(Value.Check(ExecutionProjectionSchema, execution)).toBe(true);
    expect(Value.Check(ExecutionProjectionSchema, { ...execution, activity: [] })).toBe(true);
    expect(
      Value.Check(ExecutionProjectionSchema, {
        ...execution,
        prompt: "x".repeat(MAX_EXECUTION_FACT_BYTES + 1),
      }),
    ).toBe(false);
    expect(
      Value.Check(ExecutionProjectionSchema, {
        ...execution,
        activity: [
          {
            kind: "thinking",
            text: "x".repeat(MAX_EXECUTION_ACTIVITY_CHARACTERS + 1),
          },
        ],
      }),
    ).toBe(false);
    expect(
      Value.Check(ExecutionProjectionSchema, {
        ...execution,
        unfinishedThinking: "x".repeat(MAX_EXECUTION_ACTIVITY_CHARACTERS + 1),
      }),
    ).toBe(false);
    const oversizedTool = {
      kind: "tool",
      toolCallId: "x".repeat(MAX_EXECUTION_ACTIVITY_CHARACTERS + 1),
      summary: "read src",
      state: "running",
      durationMs: 0,
    };
    expect(
      Value.Check(ExecutionProjectionSchema, { ...execution, activity: [oversizedTool] }),
    ).toBe(false);
    expect(
      Value.Check(ExecutionProjectionSchema, {
        ...execution,
        activity: [
          {
            ...oversizedTool,
            toolCallId: "call",
            summary: "x".repeat(MAX_EXECUTION_ACTIVITY_CHARACTERS + 1),
          },
        ],
      }),
    ).toBe(false);
    expect(
      Value.Check(ExecutionProjectionSchema, { ...execution, rawArgs: { secret: true } }),
    ).toBe(false);
    const details = {
      profileId: "profile",
      state: "completed",
      cwd: "/tmp",
      model: { provider: "p", id: "m", thinkingLevels: ["off"] },
      thinkingLevel: "off",
      retryActive: false,
      retries: 0,
      activity: [],
      omittedActivity: 0,
      usage: execution.activeUsage,
      execution,
    };
    expect(Value.Check(ExecutionDetailsSchema, details)).toBe(true);
    expect(
      isExecutionDetails({
        ...details,
        execution: {
          ...execution,
          activity: [
            {
              kind: "tool",
              toolCallId: "call",
              summary: "read",
              state: "success",
              durationMs: 1,
              result: "x".repeat(MAX_TOOL_RESULT_BYTES),
            },
          ],
        },
      }),
    ).toBe(true);
    expect(
      isExecutionDetails({
        ...details,
        execution: {
          ...execution,
          activity: [
            {
              kind: "tool",
              toolCallId: "call",
              summary: "read",
              state: "success",
              durationMs: 1,
              result: "😀".repeat(MAX_TOOL_RESULT_BYTES / 2),
            },
          ],
        },
      }),
    ).toBe(false);
  });
});
