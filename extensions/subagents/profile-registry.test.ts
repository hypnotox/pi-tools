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

const batch = (
  registrationId: string,
  profiles: ProfileDefinition[],
  suppressDefault?: boolean,
) => ({
  registrationId,
  profiles,
  ...(suppressDefault === undefined ? {} : { suppressDefault }),
});

describe("ProfileRegistry", () => {
  it("uses the default through the same registry and suppresses it atomically", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    const receipt = registry.collect(batch("consumer", [profile("review")], true));
    expect(receipt.state).toBe("pending");
    registry.finalize();
    expect(receipt.state).toBe("registered");
    expect(registry.profiles().map((entry) => entry.toolName)).toEqual(["review"]);
    expect(registry.profileTools()).toEqual(new Set(["subagent", "review"]));
  });

  it("deduplicates replayed registration ids and rejects late delivery", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    const first = registry.collect(batch("consumer", [profile("review")], true));
    const replay = registry.collect(batch("consumer", [profile("different")], false));
    expect(replay).toBe(first);
    registry.finalize();
    expect(first.state).toBe("registered");
    expect(registry.profiles().map((entry) => entry.toolName)).toEqual(["review"]);
    expect(registry.collect(batch("late", [profile("late")]))).toMatchObject({ state: "late" });
  });

  it("rejects duplicate ids and tools without mutating", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    expect(() =>
      registry.register(batch("duplicate-id", [profile("a"), profile("a", "other")])),
    ).toThrow("Duplicate profile id");
    expect(() =>
      registry.register(batch("duplicate-tool", [profile("a"), profile("b", "a")])),
    ).toThrow("Duplicate profile tool");
    expect(registry.profiles()).toHaveLength(1);
  });

  it("rejects collisions as whole batches and permits explicit atomic replacement", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    const accepted = registry.collect(batch("accepted", [profile("first")]));
    const rejected = registry.collect(
      batch("colliding", [profile("second"), profile("third", "first")], true),
    );
    registry.finalize();
    expect(accepted.state).toBe("registered");
    expect(rejected).toMatchObject({
      state: "rejected",
      reason: "Profile tool collision: first",
    });
    expect(registry.profiles().map((entry) => entry.toolName)).toEqual(["subagent", "first"]);

    const defaultId = new ProfileRegistry(profile("default", "subagent"));
    const defaultIdReceipt = defaultId.collect(batch("default-id", [profile("default", "other")]));
    defaultId.finalize();
    expect(defaultIdReceipt.state).toBe("rejected");
    expect(defaultId.profiles().map((entry) => entry.toolName)).toEqual(["subagent"]);

    const replacement = new ProfileRegistry(profile("default", "subagent"));
    const receipt = replacement.collect(batch("replacement", [profile("other", "subagent")], true));
    replacement.finalize();
    expect(receipt.state).toBe("registered");
    expect(replacement.profiles().map((entry) => entry.id)).toEqual(["other"]);
  });

  it("suppresses the default only through a successful batch", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    const failed = registry.collect(batch("failed", [profile("other", "read")], true));
    registry.finalize(["read"]);
    expect(failed.state).toBe("rejected");
    expect(registry.profiles().map((entry) => entry.toolName)).toEqual(["subagent"]);

    const several = new ProfileRegistry(profile("default", "subagent"));
    const one = several.collect(batch("one", [profile("one")], true));
    const two = several.collect(batch("two", [profile("two")], true));
    several.finalize();
    expect([one.state, two.state]).toEqual(["registered", "registered"]);
    expect(several.profiles().map((entry) => entry.toolName)).toEqual(["one", "two"]);
  });

  it("uses the complete configured snapshot and does not override an existing default name", () => {
    const inactiveCollision = new ProfileRegistry(profile("default", "subagent"));
    const receipt = inactiveCollision.collect(
      batch("consumer", [profile("review", "inactive")], true),
    );
    inactiveCollision.finalize(["inactive"]);
    expect(receipt.state).toBe("rejected");
    expect(inactiveCollision.profiles().map((entry) => entry.toolName)).toEqual(["subagent"]);

    const defaultCollision = new ProfileRegistry(profile("default", "subagent"));
    defaultCollision.finalize(["subagent"]);
    expect(defaultCollision.profiles()).toEqual([]);
  });

  it("snapshots collected profiles and revalidates them at finalization", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    const mutable = profile("review");
    const receipt = registry.collect(batch("consumer", [mutable], true));
    mutable.id = "changed";
    mutable.toolName = "changed_tool";
    (mutable.parameters as { type?: string }).type = "number";
    registry.finalize();
    expect(receipt.state).toBe("registered");
    expect(registry.profiles().map(({ id, toolName }) => ({ id, toolName }))).toEqual([
      { id: "review", toolName: "review" },
    ]);
  });

  it("rejects malformed batches, non-TypeBox schemas, callbacks, and concurrency", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    expect(() => registry.register({ registrationId: "empty", profiles: [] })).toThrow(
      "contain profiles",
    );
    expect(() =>
      registry.register(batch("schema", [{ ...profile("bad"), parameters: {} as never }])),
    ).toThrow("TypeBox parameter schema");
    expect(() =>
      registry.register(batch("concurrency", [{ ...profile("bad"), concurrency: 0 }])),
    ).toThrow("positive integer");
    expect(() =>
      registry.register(batch("callbacks", [{ ...profile("bad"), prepare: undefined as never }])),
    ).toThrow("invalid callbacks");
    expect(registry.profiles()).toHaveLength(1);
  });
});
