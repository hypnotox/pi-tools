import type { Api, Model } from "@earendil-works/pi-ai";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import {
  createExtensionRecorder,
  createModelRegistryFixture,
  createRecordingEventBus,
  createRecordingUi,
} from "./index.js";

function model(provider: string, id: string): Model<Api> {
  return {
    provider,
    id,
    name: id,
    api: "anthropic-messages",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1,
    maxTokens: 1,
  } as Model<Api>;
}

function toolInfo(name: string): ToolInfo {
  return {
    name,
    description: `${name} description`,
    parameters: Type.Object({}),
    sourceInfo: {
      path: `<test:${name}>`,
      source: "test",
      scope: "temporary",
      origin: "top-level",
    },
  };
}

describe("createExtensionRecorder", () => {
  it("configures typed additions and omissions before ordered installations", async () => {
    const custom = vi.fn((value: string) => value.length);
    const recorder = createExtensionRecorder({
      omit: ["getActiveTools"] as const,
      additions: { custom },
    });
    const first = recorder.install((pi) => {
      pi.on("session_start", () => undefined);
      pi.registerCommand("command", { handler: async () => undefined });
    });
    let release!: () => void;
    const second = recorder.install(async (pi) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      pi.on("session_start", () => undefined);
    });

    expect("getActiveTools" in recorder.api).toBe(false);
    expect(recorder.api.custom("typed")).toBe(5);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    await expect(recorder.invokeRaw("session_start")).resolves.toEqual([undefined, undefined]);
    expect(recorder.apiCalls.map(({ name }) => name)).toEqual(["on", "registerCommand", "on"]);
  });

  it("rejects additions that replace supported recording methods", () => {
    expect(() => createExtensionRecorder({ additions: { exec: vi.fn() } as never })).toThrow(
      "supported recorder method",
    );
  });

  it("retains settled install failures and dynamically awaits late installations", async () => {
    const recorder = createExtensionRecorder();
    const failure = recorder.install(async () => {
      throw new Error("settled failure");
    });
    await expect(failure).rejects.toThrow("settled failure");
    await expect(recorder.invokeRaw("none")).rejects.toThrow("settled failure");

    const late = createExtensionRecorder();
    await late.install(() => undefined);
    let release!: () => void;
    const installation = late.install(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    let ready = false;
    const readiness = late.ready.then(() => {
      ready = true;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    release();
    await expect(Promise.all([installation, readiness])).resolves.toEqual([undefined, undefined]);
    expect(ready).toBe(true);
    expect(late.installations).toHaveLength(2);
  });

  it("shares synchronous factory-time negotiation and propagates async rejection", async () => {
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

  it("shares a duplicate-preserving event bus across recorders", () => {
    const bus = createRecordingEventBus();
    const first = createExtensionRecorder({ eventBus: bus });
    const second = createExtensionRecorder({ eventBus: bus });
    const listener = vi.fn();
    first.api.events.on("shared", listener);
    first.api.events.on("shared", listener);
    second.api.events.emit("shared", 1);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(bus.emissions).toEqual([["shared", 1]]);
  });

  it("preserves duplicate listeners, nested order, exact unsubscribe, history, and errors", () => {
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

    const unsubscribeError = recorder.api.events.on("event", () => {
      throw new Error("raw error");
    });
    expect(order).toEqual(["first", "nested", "first", "nested"]);
    expect(recorder.emissions).toEqual([
      ["event", 1],
      ["nested", 2],
      ["nested", 2],
    ]);
    expect(() => recorder.api.events.emit("event", undefined)).toThrow("raw error");
    unsubscribeError();

    const exactOrder: string[] = [];
    const repeated = () => exactOrder.push("repeated");
    recorder.api.events.on("exact", repeated);
    recorder.api.events.on("exact", () => exactOrder.push("middle"));
    const unsubscribeFinal = recorder.api.events.on("exact", repeated);
    unsubscribeFinal();
    recorder.api.events.emit("exact", undefined);
    expect(exactOrder).toEqual(["repeated", "middle"]);

    const mutationOrder: string[] = [];
    let unsubscribeSelf!: () => void;
    unsubscribeSelf = recorder.api.events.on("mutation", () => {
      mutationOrder.push("self");
      unsubscribeSelf();
    });
    recorder.api.events.on("mutation", () => mutationOrder.push("following"));
    recorder.api.events.emit("mutation", undefined);
    recorder.api.events.emit("mutation", undefined);
    expect(mutationOrder).toEqual(["self", "following", "following"]);
  });

  it("records setActiveTools before injected behavior and exposes exact ToolInfo values", () => {
    const activeCalls: string[][] = [];
    const discovered = toolInfo("read");
    const recorder = createExtensionRecorder({
      allTools: [discovered],
      setActiveTools: (names) => {
        activeCalls.push(names);
        throw new Error("active failure");
      },
    });

    expect(recorder.api.getAllTools()).toEqual([discovered]);
    expect(() => recorder.api.setActiveTools(["read"])).toThrow("active failure");
    expect(activeCalls).toEqual([["read"]]);
    expect(recorder.apiCalls.at(-1)).toEqual({ name: "setActiveTools", args: [["read"]] });
    expect(recorder.activeTools).toEqual([]);
  });

  it("records exact exec options and forwards all direct tool and command arguments", async () => {
    const killed = { stdout: "", stderr: "", code: 0, killed: true };
    const exec = vi.fn(async () => killed);
    const execute = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      details: undefined,
    }));
    const firstCommand = vi.fn(async () => undefined);
    const secondCommand = vi.fn(async () => undefined);
    const recorder = createExtensionRecorder({ exec });
    await recorder.install((pi) => {
      pi.registerTool({
        name: "tool",
        label: "Tool",
        description: "Tool",
        parameters: Type.Object({}),
        execute,
      });
      pi.registerTool({
        name: "failure",
        label: "Failure",
        description: "Failure",
        parameters: Type.Object({}),
        execute: async () => {
          throw new Error("tool failure");
        },
      });
      pi.registerCommand("duplicate", { handler: firstCommand });
      pi.registerCommand("duplicate", { handler: secondCommand });
      pi.registerCommand("failure", {
        handler: async () => {
          throw new Error("command failure");
        },
      });
    });

    const controller = new AbortController();
    const onUpdate = vi.fn();
    const context = recorder.makeContext({ cwd: "/tool-cwd" });
    const commandContext = recorder.makeCommandContext({ cwd: "/command-cwd" });
    await expect(recorder.api.exec("echo", ["ok"], { timeout: 1 })).resolves.toEqual(killed);
    expect(exec).toHaveBeenCalledWith("echo", ["ok"], { timeout: 1 });
    await expect(
      recorder.invokeToolDirect(
        "tool",
        { value: 1 },
        { id: "id", signal: controller.signal, onUpdate, context },
      ),
    ).resolves.toMatchObject({ content: [{ text: "ok" }] });
    expect(execute).toHaveBeenCalledWith("id", { value: 1 }, controller.signal, onUpdate, context);
    await expect(recorder.invokeToolDirect("failure", {})).rejects.toThrow("tool failure");
    await expect(recorder.invokeToolDirect("missing", {})).rejects.toThrow("No registered tool");

    await expect(recorder.invokeCommandDirect("missing")).rejects.toThrow("exactly one");
    await expect(recorder.invokeCommandDirect("duplicate")).rejects.toThrow("exactly one");
    await recorder.invokeCommandDirect("duplicate", "args", commandContext, 1);
    expect(firstCommand).not.toHaveBeenCalled();
    expect(secondCommand).toHaveBeenCalledWith("args", commandContext);
    await expect(recorder.invokeCommandDirect("duplicate", "", undefined, 8)).rejects.toThrow(
      "registration index",
    );
    await expect(recorder.invokeCommandDirect("failure")).rejects.toThrow("command failure");
  });

  it("supports exec rejection, abort observation, deferred settlement, and default failure", async () => {
    const rejection = createExtensionRecorder({
      exec: async () => {
        throw new Error("exec failure");
      },
    });
    await expect(rejection.api.exec("fail", [])).rejects.toThrow("exec failure");

    const controller = new AbortController();
    controller.abort();
    const cancellation = createExtensionRecorder({
      exec: async (_command, _args, options) => ({
        stdout: "",
        stderr: "",
        code: 1,
        killed: options?.signal?.aborted === true,
      }),
    });
    await expect(
      cancellation.api.exec("cancel", [], { signal: controller.signal, cwd: "/cwd" }),
    ).resolves.toMatchObject({ killed: true });

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
    const waiting = createExtensionRecorder({ exec: async () => deferred });
    const result = waiting.api.exec("wait", []);
    resolve({ stdout: "done", stderr: "", code: 0, killed: false });
    await expect(result).resolves.toMatchObject({ stdout: "done" });

    await expect(createExtensionRecorder().api.exec("echo", [])).rejects.toThrow(
      "No exec behavior configured",
    );
  });

  it("records UI responses and mutates an exactly typed model registry", async () => {
    const ui = createRecordingUi();
    ui.selectResponses.push("yes");
    ui.confirmResponses.push(true);
    ui.inputResponses.push("input");
    const registry = createModelRegistryFixture();
    const available = model("p", "available");
    const unavailable = model("p", "unavailable");
    registry.add(available);
    registry.add(unavailable, false);
    registry.configuredAuth = true;
    const recorder = createExtensionRecorder({ ui, modelRegistry: registry });
    const context = recorder.makeContext();

    await expect(context.ui.select("title", ["yes"])).resolves.toBe("yes");
    await expect(context.ui.confirm("title", "message")).resolves.toBe(true);
    await expect(context.ui.input("title")).resolves.toBe("input");
    context.ui.notify("notice", "info");
    expect(ui.calls.map(({ name }) => name)).toEqual(["select", "confirm", "input", "notify"]);
    expect(context.modelRegistry.getAll()).toEqual([available, unavailable]);
    expect(context.modelRegistry.getAvailable()).toEqual([available]);
    expect(context.modelRegistry.find("p", "available")).toBe(available);
    expect(context.modelRegistry.hasConfiguredAuth(available)).toBe(true);
    registry.remove("p", "available");
    expect(context.modelRegistry.find("p", "available")).toBeUndefined();
    expect(context.modelRegistry.getAvailable()).toEqual([]);
    expect("newSession" in context).toBe(false);
  });

  it("preserves composed inputs across fresh replacement contexts and new-session identity", async () => {
    const ui = createRecordingUi();
    const registry = createModelRegistryFixture();
    const selectedModel = model("p", "m");
    registry.add(selectedModel);
    const recorder = createExtensionRecorder({ ui, modelRegistry: registry });
    const command = recorder.makeCommandContext({
      cwd: "/configured",
      model: selectedModel,
      ui: ui.ui,
    });
    const replacements: Array<{ context: unknown; id: string }> = [];
    let setupId: string | undefined;

    await command.newSession({
      setup: async (session) => {
        setupId = session.getSessionId();
      },
      withSession: async (next) => {
        replacements.push({ context: next, id: next.sessionManager.getSessionId() });
      },
    });
    await command.fork("entry", {
      withSession: async (next) => {
        replacements.push({ context: next, id: next.sessionManager.getSessionId() });
      },
    });
    await command.switchSession("session.jsonl", {
      withSession: async (next) => {
        replacements.push({ context: next, id: next.sessionManager.getSessionId() });
      },
    });

    expect(replacements[0]?.id).toBe(setupId);
    expect(new Set(replacements.map(({ context }) => context)).size).toBe(3);
    expect(new Set(replacements.map(({ id }) => id)).size).toBe(3);
    for (const { context } of replacements) {
      expect(context).toMatchObject({
        cwd: "/configured",
        model: selectedModel,
        ui: ui.ui,
        modelRegistry: registry.registry,
        sendMessage: expect.any(Function),
        sendUserMessage: expect.any(Function),
      });
      expect((context as { sessionManager: { getCwd(): string } }).sessionManager.getCwd()).toBe(
        "/configured",
      );
    }
  });
});
