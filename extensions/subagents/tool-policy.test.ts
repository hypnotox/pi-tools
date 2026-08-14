import { describe, expect, it } from "vitest";
import { resolveTools } from "./tool-policy.js";

describe("resolveTools", () => {
  it("applies recursion denial after either consumer policy", () => {
    expect(
      resolveTools(
        { mode: "allowlist", tools: ["read", "subagent"] },
        ["bash"],
        new Set(["subagent"]),
      ),
    ).toEqual(["read"]);
    expect(
      resolveTools(
        { mode: "inherit", deny: ["bash"] },
        ["read", "bash", "subagent"],
        new Set(["subagent"]),
      ),
    ).toEqual(["read"]);
  });
});
