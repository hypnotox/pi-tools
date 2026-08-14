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
  selectModel: () => ({ provider: "p", id: "m", thinkingLevels: ["off"] }),
  prepare: () => ({ cwd: "/tmp", prompt: "x", toolPolicy: { mode: "allowlist", tools: [] } }),
});

describe("ProfileRegistry", () => {
  it("uses the default through the same registry and suppresses it atomically", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    registry.register({ profiles: [profile("review")], suppressDefault: true });
    expect(registry.profiles().map((entry) => entry.toolName)).toEqual(["review"]);
  });
  it("rejects duplicates without mutating", () => {
    const registry = new ProfileRegistry(profile("default", "subagent"));
    expect(() => registry.register({ profiles: [profile("a"), profile("a", "other")] })).toThrow(
      "Duplicate profile id",
    );
    expect(registry.profiles()).toHaveLength(1);
  });
});
