import { createExtensionHarness } from "pi-tools/testing";
import { describe, expect, it } from "vitest";

describe("pi-tools/testing", () => {
  it("loads through the package export and records public seams", async () => {
    const harness = createExtensionHarness((pi) => {
      pi.on("session_start", () => undefined);
      pi.events.on("ready", () => undefined);
    });
    expect(await harness.invokeRaw("session_start")).toEqual([undefined]);
  });
});
