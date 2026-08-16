import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { createExtensionRecorder, createModelRegistryFixture, createRecordingUi } from "./index.js";

describe("createExtensionRecorder", () => {
  it("configures before synchronous and asynchronous installations and records ordered calls", async () => {
    const recorder = createExtensionRecorder({
      omit: ["getActiveTools"],
      additions: { custom: vi.fn() },
    });
    const first = recorder.install((pi) => {
      pi.on("session_start", () => {
        return undefined;
      });
      pi.registerCommand("command", { handler: async () => undefined });
    });
    let release!: () => void;
    const second = recorder.install(async (pi) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      pi.on("session_start", () => {
        return undefined;
      });
    });
    expect("getActiveTools" in recorder.api).toBe(false);
    expect("custom" in recorder.api).toBe(true);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    await expect(recorder.invokeRaw("session_start")).resolves.toEqual([undefined, undefined]);
    expect(recorder.apiCalls.map(({ name }) => name)).toEqual(["on", "registerCommand", "on"]);
  });

  it("waits for prior installs, propagates rejection, and shares synchronous factory negotiation", async () => {
    const recorder = createExtensionRecorder();
    const seen: string[] = [];
    recorder.install((pi) => {
      pi.events.on("negotiate", (value) => seen.push(String(value)));
      pi.events.emit("negotiate", "now");
    });
    await recorder.install((pi) => {
      pi.events.emit("negotiate", "again");
    });
    expect(seen).toEqual(["now", "again"]);
    const rejection = recorder.install(async () => {
      throw new Error("install failed");
    });
    await expect(recorder.invokeRaw("none")).rejects.toThrow("install failed");
    await expect(rejection).rejects.toThrow("install failed");
  });

  it("preserves duplicate event listeners, nested order, unsubscription, emission history, and errors", () => {
    const recorder = createExtensionRecorder();
    const order: string[] = [];
    const listener = () => {
      order.push("first");
      recorder.api.events.emit("nested", 2);
    };
    recorder.api.events.on("event", listener);
    recorder.api.events.on("event", listener);
    recorder.api.events.on("nested", () => order.push("nested"));
    recorder.api.events.emit("event", 1);
    const unsubscribe = recorder.api.events.on("event", () => {
      throw new Error("raw error");
    });
    expect(order).toEqual(["first", "nested", "first", "nested"]);
    expect(recorder.emissions).toEqual([
      ["event", 1],
      ["nested", 2],
      ["nested", 2],
    ]);
    expect(() => recorder.api.events.emit("event", undefined)).toThrow("raw error");
    unsubscribe();
  });

  it("records injected exec outcomes and direct tool and command calls", async () => {
    const killed = { stdout: "", stderr: "", code: 0, killed: true };
    const recorder = createExtensionRecorder({
      exec: async (command, args, options) => {
        expect([command, args, options]).toEqual(["echo", ["ok"], { timeout: 1 }]);
        return killed;
      },
    });
    await recorder.install((pi) => {
      pi.registerTool({
        name: "tool",
        label: "Tool",
        description: "",
        parameters: Type.Object({}),
        execute: async (id, params, signal, onUpdate, context) => ({
          content: [
            {
              type: "text",
              text: `${id}:${String(params)}:${Boolean(signal)}:${Boolean(onUpdate)}:${context.cwd}`,
            },
          ],
          details: undefined,
        }),
      });
      pi.registerCommand("duplicate", { handler: async () => undefined });
      pi.registerCommand("duplicate", { handler: async () => undefined });
    });
    await expect(recorder.api.exec("echo", ["ok"], { timeout: 1 })).resolves.toEqual(killed);
    await expect(
      recorder.invokeToolDirect(
        "tool",
        {},
        { id: "id", signal: new AbortController().signal, onUpdate: () => undefined },
      ),
    ).resolves.toMatchObject({ content: [{ text: expect.stringContaining("id") }] });
    await expect(recorder.invokeCommandDirect("missing")).rejects.toThrow("exactly one");
    await expect(recorder.invokeCommandDirect("duplicate")).rejects.toThrow("exactly one");
    await expect(
      recorder.invokeCommandDirect("duplicate", "", undefined, 1),
    ).resolves.toBeUndefined();
    await expect(recorder.invokeCommandDirect("duplicate", "", undefined, 4)).rejects.toThrow(
      "registration index",
    );
  });

  it("fails clearly when exec is unconfigured", async () => {
    await expect(createExtensionRecorder().api.exec("echo", [])).rejects.toThrow(
      "No exec behavior configured",
    );
  });

  it("supports a manually deferred exec outcome", async () => {
    let resolve!: (value: {
      stdout: string;
      stderr: string;
      code: number;
      killed: boolean;
    }) => void;
    const deferred = new Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>(
      (next) => {
        resolve = next;
      },
    );
    const recorder = createExtensionRecorder({ exec: async () => deferred });
    const result = recorder.api.exec("wait", []);
    resolve({ stdout: "done", stderr: "", code: 0, killed: false });
    await expect(result).resolves.toMatchObject({ stdout: "done" });
  });

  it("composes recording UI, mutable registry, and fresh command replacement contexts", async () => {
    const ui = createRecordingUi();
    ui.selectResponses.push("yes");
    ui.confirmResponses.push(true);
    ui.inputResponses.push("input");
    const registry = createModelRegistryFixture();
    registry.add({ provider: "p", id: "m" });
    registry.configuredAuth = true;
    const recorder = createExtensionRecorder({ ui, modelRegistry: registry });
    const context = recorder.makeContext();
    await context.ui.select("title", ["yes"]);
    await context.ui.confirm("title", "message");
    await context.ui.input("title");
    context.ui.notify("notice");
    expect(ui.calls.map(({ name }) => name)).toEqual(["select", "confirm", "input", "notify"]);
    expect(context.modelRegistry.getAvailable()).toHaveLength(1);
    expect(context.modelRegistry.hasConfiguredAuth({} as never)).toBe(true);
    expect("newSession" in context).toBe(false);
    const command = recorder.makeCommandContext();
    let setup: string | undefined;
    let replacement: string | undefined;
    await command.newSession({
      setup: async (session) => {
        setup = session.getSessionId();
      },
      withSession: async (next) => {
        replacement = next.sessionManager.getSessionId();
      },
    });
    expect(replacement).toBe(setup);
  });
});
