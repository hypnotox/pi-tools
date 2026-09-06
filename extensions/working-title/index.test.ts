import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtensionHarness } from "../../tests/extension-harness.js";
import { registerWorkingTitle, SPINNER_FRAMES, SPINNER_INTERVAL_MS } from "./index.js";

function setup(mode: ExtensionContext["mode"] = "tui") {
  const harness = createExtensionHarness();
  let sessionName: string | undefined;
  Object.assign(harness.api, { getSessionName: () => sessionName });
  registerWorkingTitle(harness.api);
  const setTitle = vi.fn();
  const ui = { setTitle } as unknown as ExtensionUIContext;
  const context = { mode, cwd: "/work/project", ui } as ExtensionContext;
  return {
    ...harness,
    context,
    setTitle,
    setSessionName(name: string | undefined) {
      sessionName = name;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("working title", () => {
  it("animates in front of a title supplied by another extension and restores it when settled", async () => {
    vi.useFakeTimers();
    const harness = setup();
    await harness.invoke(
      "session_start",
      { type: "session_start", reason: "startup" },
      harness.context,
    );

    harness.context.ui.setTitle("agent · On");
    harness.setTitle.mockClear();
    await harness.invoke("agent_start", { type: "agent_start" }, harness.context);
    expect(harness.setTitle).toHaveBeenLastCalledWith(`${SPINNER_FRAMES[0]} agent · On`);

    await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL_MS);
    expect(harness.setTitle).toHaveBeenLastCalledWith(`${SPINNER_FRAMES[1]} agent · On`);

    harness.context.ui.setTitle("agent · Off");
    expect(harness.setTitle).toHaveBeenLastCalledWith(`${SPINNER_FRAMES[1]} agent · Off`);

    await harness.invoke("agent_settled", { type: "agent_settled" }, harness.context);
    expect(harness.setTitle).toHaveBeenLastCalledWith("agent · Off");
    const settledCalls = harness.setTitle.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SPINNER_INTERVAL_MS * 2);
    expect(harness.setTitle).toHaveBeenCalledTimes(settledCalls);
  });

  it("uses Pi's ordinary title until another extension supplies one", async () => {
    const harness = setup();
    harness.setSessionName("named session");
    await harness.invoke(
      "session_start",
      { type: "session_start", reason: "startup" },
      harness.context,
    );
    await harness.invoke("agent_start", { type: "agent_start" }, harness.context);
    expect(harness.setTitle).toHaveBeenLastCalledWith(
      `${SPINNER_FRAMES[0]} π - named session - project`,
    );
  });

  it("keeps working across overlapping agent and compaction activity", async () => {
    vi.useFakeTimers();
    const harness = setup();
    await harness.invoke(
      "session_start",
      { type: "session_start", reason: "startup" },
      harness.context,
    );
    await harness.invoke("agent_start", { type: "agent_start" }, harness.context);
    await harness.invoke(
      "session_before_compact",
      { type: "session_before_compact" },
      harness.context,
    );
    await harness.invoke("agent_settled", { type: "agent_settled" }, harness.context);
    expect(harness.setTitle.mock.calls.at(-1)?.[0]).toMatch(/^⠋ /u);

    await harness.invoke("session_compact", { type: "session_compact" }, harness.context);
    expect(harness.setTitle).toHaveBeenLastCalledWith("π - project");
  });

  it("ends compaction activity after failure and cleans up a working shutdown", async () => {
    vi.useFakeTimers();
    const harness = setup();
    const originalSetTitle = harness.context.ui.setTitle;
    await harness.invoke(
      "session_start",
      { type: "session_start", reason: "startup" },
      harness.context,
    );
    await harness.invoke(
      "session_before_compact",
      { type: "session_before_compact" },
      harness.context,
    );
    await harness.invoke(
      "session_compact_failed",
      { type: "session_compact_failed" },
      harness.context,
    );
    expect(harness.setTitle).toHaveBeenLastCalledWith("π - project");

    await harness.invoke("agent_start", { type: "agent_start" }, harness.context);
    await harness.invoke(
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" },
      harness.context,
    );
    expect(harness.context.ui.setTitle).toBe(originalSetTitle);
    expect(harness.setTitle).toHaveBeenLastCalledWith("π - project");
  });

  it("does not patch titles outside interactive mode", async () => {
    const harness = setup("rpc");
    const originalSetTitle = harness.context.ui.setTitle;
    await harness.invoke(
      "session_start",
      { type: "session_start", reason: "startup" },
      harness.context,
    );
    await harness.invoke("agent_start", { type: "agent_start" }, harness.context);
    expect(harness.context.ui.setTitle).toBe(originalSetTitle);
    expect(harness.setTitle).not.toHaveBeenCalled();
  });
});
