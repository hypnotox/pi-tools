import { describe, expect, it } from "vitest";
import { extensionContext } from "./extension-context.js";
import { handoffEnvelope } from "./handoff/index.js";

describe("extension context", () => {
  it("labels the source and delimits the complete payload", () => {
    expect(extensionContext("example", "A fact.\nA next action.")).toBe(
      '<extension-context source="pi-tools/example">\nA fact.\nA next action.\n</extension-context>',
    );
  });

  it("preserves handoff content inside its source-specific envelope", () => {
    const kickoff = "\nObjective: finish the change.\n\nNext: run tests.\n";
    expect(handoffEnvelope(kickoff)).toBe(
      `<extension-context source="pi-tools/handoff">\n${kickoff}\n</extension-context>`,
    );
  });
});
