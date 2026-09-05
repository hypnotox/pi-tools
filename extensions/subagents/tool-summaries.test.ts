import { describe, expect, it } from "vitest";
import { summarizeTool } from "./tool-summaries.js";

describe("subagent tool summaries", () => {
  it("never persists bash command text", () => {
    expect(
      summarizeTool("bash", {
        command: "API_TOKEN=secret curl -H 'Authorization: Bearer hidden' https://example.test",
      }),
    ).toBe("bash");
    expect(summarizeTool("bash", { command: "TOKEN=\\ EXAMPLE_SECRET" })).toBe("bash");
  });

  it("falls back to the tool name for unknown tools instead of retaining arguments", () => {
    expect(summarizeTool("custom_tool", { secret: "hidden" })).toBe("custom_tool");
  });
});
