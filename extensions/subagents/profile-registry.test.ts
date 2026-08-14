import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { ProfileDefinition } from "./api.js";
import { ProfileRegistry } from "./profile-registry.js";

const profile = (id: string, toolName = id): ProfileDefinition => ({
  id,
  toolName,
  label: id,
  description: id,
  parameters: Type.Object({}),
  profileDataSchema: Type.Object({}, { additionalProperties: false }),
  selectModel: () => ({ provider: "p", id: "m", thinkingLevels: ["off"] }),
  prepare: () => ({
    cwd: "/tmp",
    systemPrompt: "system",
    prompt: "x",
    toolPolicy: { mode: "allowlist", tools: [] },
  }),
});

describe("ProfileRegistry", () => {
  it("uses the default through the same registry and suppresses it atomically", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    const receipt = registry.collect({ profiles: [profile("review")], suppressDefault: true });
    expect(receipt.state).toBe("pending");
    registry.finalize();
    expect(receipt.state).toBe("registered");
    expect(registry.profiles().map((entry) => entry.toolName)).toEqual(["review"]);
    expect(registry.profileTools()).toEqual(new Set(["subagent", "review"]));
  });

  it("rejects duplicate ids and tools without mutating", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    expect(() => registry.register({ profiles: [profile("a"), profile("a", "other")] })).toThrow(
      "Duplicate profile id",
    );
    expect(() => registry.register({ profiles: [profile("a"), profile("b", "a")] })).toThrow(
      "Duplicate profile tool",
    );
    expect(registry.profiles()).toHaveLength(1);
  });

  it("rejects collisions with a visible default but permits atomic replacement", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    const rejected = registry.collect({ profiles: [profile("other", "subagent")] });
    registry.finalize();
    expect(rejected).toMatchObject({
      state: "rejected",
      reason: "Profile tool collision: subagent",
    });

    const replacement = new ProfileRegistry(profile("default", "subagent"));
    const receipt = replacement.collect({
      profiles: [profile("other", "subagent")],
      suppressDefault: true,
    });
    replacement.finalize();
    expect(receipt.state).toBe("registered");
    expect(replacement.profiles().map((entry) => entry.id)).toEqual(["other"]);
  });

  it("rejects malformed batches, callbacks, and concurrency before mutation", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    expect(() => registry.register({ profiles: [] })).toThrow("contain profiles");
    expect(() => registry.register({ profiles: [{ ...profile("bad"), concurrency: 0 }] })).toThrow(
      "positive integer",
    );
    expect(() =>
      registry.register({ profiles: [{ ...profile("bad"), prepare: undefined as never }] }),
    ).toThrow("invalid callbacks");
    expect(registry.profiles()).toHaveLength(1);
  });
});
