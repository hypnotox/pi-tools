import { Type } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ConcreteModelSchema,
  JsonValueSchema,
  PostRunResultSchema,
  PreparedRunSchema,
  type ProfileContext,
  type ProfileDefinition,
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
    expect(definition.toolName).toBe("typed");
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
  });
});
