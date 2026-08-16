import type {
  ExecutionDetails,
  ProfileCapability,
  ProfileDefinition,
  ProfileRegistration,
} from "pi-tools/subagent-profile";
import { createExtensionHarness } from "pi-tools/testing";
import { Type } from "typebox";
import { Value } from "typebox/value";
import ts from "typescript";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ExecutionDetailsSchema,
  SUBAGENT_PROFILE_CAPABILITY_EVENT,
  SUBAGENT_PROFILE_PROTOCOL_VERSION,
} from "../extensions/subagents/api.js";
import { createSubagentToolkit } from "../extensions/subagents/index.js";

const parameters = Type.Object({ task: Type.String() });
const profileData = Type.Object({ summary: Type.String() });

const consumerProfile: ProfileDefinition<
  typeof parameters,
  typeof profileData,
  { prepared: true }
> = {
  id: "consumer-review",
  toolName: "consumer_review",
  label: "Consumer review",
  description: "Review a focused task.",
  parameters,
  profileDataSchema: profileData,
  selectModel: ({ parent }) => parent.model,
  prepare: ({ args, parent }) => ({
    cwd: parent.cwd,
    systemPrompt: "Review only the requested task.",
    prompt: args.task,
    toolPolicy: { mode: "inherit", deny: [] },
  }),
  beforeRun: () => ({ prepared: true }),
  afterRun: (_outcome, state) => ({
    report: state?.prepared ? "reviewed" : "not prepared",
    profileData: { summary: "bounded consumer result" },
  }),
};

interface RegisteredTool {
  name: string;
  execute: (
    id: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: unknown,
  ) => Promise<{ content: unknown; details: ExecutionDetails }>;
  renderResult: (
    result: { details: ExecutionDetails },
    options: { expanded: boolean },
    theme: { fg: (_color: string, text: string) => string; bold: (text: string) => string },
  ) => { render(width: number): string[] };
}

function integrationHarness() {
  const harness = createExtensionHarness(() => undefined);
  harness.activeTools.push("read");
  harness.allTools.push({ name: "read" });
  const context = harness.makeContext({
    cwd: "/consumer/project",
    model: { provider: "provider", id: "model", reasoning: false, thinkingLevelMap: {} },
    thinkingLevel: "off",
    isProjectTrusted: () => true,
    modelRegistry: {
      find: (provider: string, id: string) =>
        provider === "provider" && id === "model"
          ? { provider, id, reasoning: false, thinkingLevelMap: {} }
          : undefined,
    } as never,
    sessionManager: { getBranch: () => [] } as never,
  } as never);
  return {
    ...harness,
    tools: harness.tools as unknown as RegisteredTool[],
    context,
    start: () => {
      for (const handler of harness.handlers.get("session_start") ?? [])
        handler({} as never, context);
    },
  };
}

describe("subagent profile package contract", () => {
  it("negotiates an independently typed replacement, executes hooks, and restores details", async () => {
    const harness = integrationHarness();
    const batch: ProfileRegistration = {
      registrationId: "consumer-package:review",
      profiles: [consumerProfile],
      suppressDefault: true,
    };
    let receipt: ReturnType<ProfileCapability["register"]> | undefined;
    harness.api.events.on(SUBAGENT_PROFILE_CAPABILITY_EVENT, (data) => {
      const capability = data as ProfileCapability;
      if (capability.protocolVersion !== SUBAGENT_PROFILE_PROTOCOL_VERSION) return;
      receipt = capability.register(batch);
    });
    await harness.install((api) =>
      createSubagentToolkit(api, {
        runner: {
          run: vi.fn(async () => ({
            state: "completed" as const,
            report: "raw",
            usage: {
              input: 1,
              output: 2,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 3,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            activity: [],
            omittedActivity: 0,
            retries: 0,
            retryActive: false,
          })),
          shutdown: vi.fn(async () => undefined),
        },
      }),
    );
    expect(receipt?.state).toBe("pending");
    harness.start();
    expect(receipt?.state).toBe("registered");
    expect(harness.tools.map(({ name }) => name)).toEqual(["consumer_review"]);

    const result = await harness.tools[0]?.execute(
      "call",
      { task: "review this" },
      undefined,
      undefined,
      harness.context,
    );
    expect(result?.content).toEqual([{ type: "text", text: "reviewed" }]);
    expect(result?.details.profileData).toEqual({ summary: "bounded consumer result" });

    const restored = JSON.parse(JSON.stringify(result?.details)) as ExecutionDetails;
    expect(Value.Check(ExecutionDetailsSchema, restored)).toBe(true);
    const rendered = harness.tools[0]
      ?.renderResult(
        { details: restored },
        { expanded: true },
        { fg: (_color, text) => text, bold: (text) => text },
      )
      .render(120)
      .join("\n");
    expect(rendered).toContain("bounded consumer result");
    expectTypeOf(consumerProfile).toMatchTypeOf<ProfileDefinition>();
  });

  it("erases the canonical type-only package import from emitted JavaScript", () => {
    const emitted = ts.transpileModule(
      'import type { ProfileDefinition } from "pi-tools/subagent-profile";\nconst value: ProfileDefinition | undefined = undefined;\nexport { value };',
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    expect(emitted).not.toContain("pi-tools/subagent-profile");
    expect(emitted).not.toContain("ProfileDefinition");
  });
});
