import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
type Handler = (
  event: unknown,
  context: { ui: { notify(message: string, level: string): void } },
) => void;

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

  it.each(REQUIRED_APIS)("refuses registration when %s is missing", (missingApi) => {
    let sessionStart: Handler | undefined;
    const pi = {
      on(name: string, handler: Handler) {
        if (name === "session_start") sessionStart = handler;
      },
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      queueCommand: vi.fn(),
      getAllTools: vi.fn(() => []),
    };
    delete pi[missingApi];

    expect(guardRuntime(pi as unknown as ExtensionAPI, [missingApi])).toBe(false);
    if (missingApi === "on") {
      expect(sessionStart).toBeUndefined();
      return;
    }

    const notify = vi.fn();
    sessionStart?.({}, { ui: { notify } });
    sessionStart?.({}, { ui: { notify } });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining(missingApi), "error");
  });

  it.each(["0.81.0", "invalid"])(
    "refuses registration and notifies once for unsupported runtime %s",
    (runtimeVersion) => {
      let sessionStart: Handler | undefined;
      const pi = {
        on(name: string, handler: Handler) {
          if (name === "session_start") sessionStart = handler;
        },
        registerTool: vi.fn(),
        registerCommand: vi.fn(),
        queueCommand: vi.fn(),
        getAllTools: vi.fn(() => []),
      } as unknown as ExtensionAPI;

      expect(guardRuntime(pi, REQUIRED_APIS, runtimeVersion)).toBe(false);
      const notify = vi.fn();
      sessionStart?.({}, { ui: { notify } });
      sessionStart?.({}, { ui: { notify } });
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining(`found ${runtimeVersion}`),
        "error",
      );
    },
  );

  it("accepts the installed runtime when requested APIs are present", () => {
    const pi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      queueCommand: vi.fn(),
      getAllTools: vi.fn(() => []),
    } as unknown as ExtensionAPI;

    expect(guardRuntime(pi, REQUIRED_APIS)).toBe(true);
    expect(pi.on).not.toHaveBeenCalled();
  });
});
