import { createExtensionHarness } from "pi-tools/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardRuntime, versionSupported } from "./runtime-guard.js";

const NOTICE_KEY = Symbol.for("pi-tools.minimum-runtime-notified");
const REQUIRED_APIS = [
  "on",
  "registerTool",
  "registerCommand",
  "queueCommand",
  "getAllTools",
] as const;

afterEach(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[NOTICE_KEY];
});

describe("runtime compatibility guard", () => {
  it("recognizes the version floor and semantic version suffixes", () => {
    expect(versionSupported("0.81.0")).toBe(false);
    expect(versionSupported("0.81.1")).toBe(true);
    expect(versionSupported("0.81.1-beta.1")).toBe(true);
    expect(versionSupported("0.82.0")).toBe(true);
    expect(versionSupported("invalid")).toBe(false);
  });

  it.each(REQUIRED_APIS)("refuses registration when %s is missing", async (missingApi) => {
    const harness = createExtensionHarness(
      (pi) => {
        guardRuntime(pi, [missingApi]);
      },
      { omit: [missingApi] },
    );

    expect(await harness.ready).toBeUndefined();
    if (missingApi === "on") {
      expect(harness.handlers.get("session_start")).toBeUndefined();
      return;
    }

    const notify = vi.fn();
    const context = harness.makeContext({ ui: { notify } } as never);
    await harness.invokeRaw("session_start", {}, context);
    await harness.invokeRaw("session_start", {}, context);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining(missingApi), "error");
  });

  it.each(["0.81.0", "invalid"])(
    "refuses registration and notifies once for unsupported runtime %s",
    async (runtimeVersion) => {
      const harness = createExtensionHarness((pi) => {
        guardRuntime(pi, REQUIRED_APIS, runtimeVersion);
      });
      const notify = vi.fn();
      const context = harness.makeContext({ ui: { notify } } as never);
      await harness.invokeRaw("session_start", {}, context);
      await harness.invokeRaw("session_start", {}, context);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining(`found ${runtimeVersion}`),
        "error",
      );
    },
  );

  it("accepts the installed runtime when requested APIs are present", async () => {
    const harness = createExtensionHarness((pi) => {
      guardRuntime(pi, REQUIRED_APIS);
    });

    expect(await harness.ready).toBeUndefined();
    expect(harness.handlers.get("session_start")).toBeUndefined();
  });
});
