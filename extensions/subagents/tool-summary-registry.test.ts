import { describe, expect, it } from "vitest";
import { ToolSummaryRegistry } from "./tool-summary-registry.js";

const batch = (
  registrationId: string,
  toolName: string,
  resolve = (_args: unknown) => "summary",
) => ({
  registrationId,
  resolvers: [{ toolName, resolve }],
});

describe("ToolSummaryRegistry", () => {
  it("is replay-idempotent, reserves built-ins, and rejects conflicting batches atomically", () => {
    const registry = new ToolSummaryRegistry();
    const first = registry.collect(batch("first", "custom"));
    expect(registry.collect(batch("first", "other"))).toBe(first);
    const reserved = registry.collect(batch("reserved", "read"));
    const conflict = registry.collect({
      registrationId: "conflict",
      resolvers: [
        { toolName: "other", resolve: () => "other" },
        { toolName: "custom", resolve: () => "bad" },
      ],
    });
    expect(registry.finalize()).toEqual([
      { protocolVersion: 1, registrationId: "first", state: "registered" },
      {
        protocolVersion: 1,
        registrationId: "reserved",
        state: "rejected",
        reason: "Reserved tool summary: read",
      },
      {
        protocolVersion: 1,
        registrationId: "conflict",
        state: "rejected",
        reason: "Duplicate tool summary: custom",
      },
    ]);
    expect(first.state).toBe("registered");
    expect(reserved.state).toBe("rejected");
    expect(conflict.state).toBe("rejected");
    expect(registry.resolve("custom", { value: 1 })).toBe("summary");
    expect(registry.resolve("other", {})).toBe("other");
    expect(registry.collect(batch("late", "late"))).toMatchObject({ state: "late" });
  });

  it("gives resolvers immutable snapshots and contains invalid output and errors", () => {
    const registry = new ToolSummaryRegistry();
    let received: unknown;
    registry.collect(
      batch("frozen", "frozen", (args) => {
        received = args;
        return "okay";
      }),
    );
    registry.collect(batch("invalid", "invalid", () => "bad\nvalue"));
    registry.collect(
      batch("throws", "throws", () => {
        throw new Error("unsafe");
      }),
    );
    registry.finalize();
    expect(registry.resolve("frozen", { nested: { value: 1 } })).toBe("okay");
    expect(Object.isFrozen(received)).toBe(true);
    expect(Object.isFrozen((received as { nested: object }).nested)).toBe(true);
    expect(registry.resolve("invalid", {})).toBe("invalid");
    expect(registry.resolve("throws", {})).toBe("throws");
  });
});
