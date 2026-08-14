import type {
  ProfileCapability,
  ProfileDefinition,
  ProfileRegistration,
} from "pi-tools/subagent-profile";
import { Type } from "typebox";
import { describe, expect, expectTypeOf, it } from "vitest";

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

describe("subagent profile package contract", () => {
  it("type-checks a consumer-owned atomic replacement without a runtime import", () => {
    const batch: ProfileRegistration = { profiles: [consumerProfile], suppressDefault: true };
    const capability: Pick<ProfileCapability, "protocolVersion" | "register"> = {
      protocolVersion: 1,
      register: () => ({ state: "pending" }),
    };
    expect(capability.register(batch).state).toBe("pending");
    expectTypeOf(consumerProfile).toMatchTypeOf<ProfileDefinition>();
  });
});
