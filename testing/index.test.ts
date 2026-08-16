import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { createExtensionHarness } from "./index.js";

describe("createExtensionHarness", () => {
  it("records registrations, calls, and raw handler order", async () => {
    const order: string[] = [];
    const first = vi.fn(() => void order.push("first"));
    const second = vi.fn(() => void order.push("second"));
    const renderer = vi.fn();
    const harness = createExtensionHarness((pi) => {
      pi.on("session_start", first);
      pi.on("session_start", second);
      pi.registerCommand("example", { handler: async () => undefined });
      pi.registerEntryRenderer("example", renderer);
      pi.appendEntry("state", { value: 1 });
      pi.setActiveTools(["read"]);
      pi.getActiveTools();
      pi.getAllTools();
    });

    await expect(harness.invokeRaw("session_start", { source: "test" })).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(order).toEqual(["first", "second"]);
    expect(harness.apiCalls.map((call) => call.name)).toEqual([
      "on",
      "on",
      "registerCommand",
      "registerEntryRenderer",
      "appendEntry",
      "setActiveTools",
      "getActiveTools",
      "getAllTools",
    ]);
    expect(harness.appendEntries).toEqual([["state", { value: 1 }]]);
    expect(harness.activeTools).toEqual(["read"]);
    expect(harness.entryRenderers.get("example")?.renderer).toBe(renderer);
  });

  it("exposes readiness for asynchronous extension factories", async () => {
    let release: (() => void) | undefined;
    const harness = createExtensionHarness(async (pi) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      pi.on("session_start", () => undefined);
    });

    expect(harness.handlers.size).toBe(0);
    release?.();
    await expect(harness.ready).resolves.toBeUndefined();
    await expect(harness.invokeRaw("session_start")).resolves.toEqual([undefined]);
  });

  it("supports explicit capability omission", async () => {
    let present = true;
    const harness = createExtensionHarness(
      (pi) => {
        present = "getActiveTools" in pi;
      },
      { omit: ["getActiveTools"] },
    );

    await harness.ready;
    expect(present).toBe(false);
    expect("getActiveTools" in harness.api).toBe(false);
  });

  it("delivers event-bus traffic until the listener unsubscribes", () => {
    const harness = createExtensionHarness(() => undefined);
    const listener = vi.fn();
    const unsubscribe = harness.api.events.on("example", listener);

    harness.api.events.emit("example", 1);
    unsubscribe();
    harness.api.events.emit("example", 2);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(1);
    expect(harness.apiCalls.map((call) => call.name)).toEqual([
      "events.on",
      "events.emit",
      "events.emit",
    ]);
  });

  it("keeps command controls out of ordinary contexts and creates fresh replacements", async () => {
    const harness = createExtensionHarness(() => undefined);
    const ordinary = harness.makeContext();
    const command = harness.makeCommandContext();
    const replacements: unknown[] = [];

    expect("newSession" in ordinary).toBe(false);
    expect(ordinary.sessionManager.getCwd()).toBe(process.cwd());
    expect(ordinary.ui.getEditorText()).toBe("");
    expect(ordinary.ui.theme.fg("accent", "plain")).toBe("plain");
    expect(ordinary.modelRegistry.getAll()).toEqual([]);

    let setupSessionId: string | undefined;
    let replacementSessionId: string | undefined;
    await command.newSession({
      setup: async (sessionManager) => {
        setupSessionId = sessionManager.getSessionId();
      },
      withSession: async (context) => {
        replacementSessionId = context.sessionManager.getSessionId();
        replacements.push(context);
      },
    });
    await command.fork("entry-id", {
      withSession: async (context) => void replacements.push(context),
    });
    await command.switchSession("other.jsonl", {
      withSession: async (context) => void replacements.push(context),
    });

    expect(replacementSessionId).toBe(setupSessionId);
    expect(replacements).toHaveLength(3);
    expect(new Set(replacements).size).toBe(3);
    for (const replacement of replacements) {
      expect(replacement).toMatchObject({
        sendMessage: expect.any(Function),
        sendUserMessage: expect.any(Function),
        newSession: expect.any(Function),
      });
    }
  });

  it("invokes tools directly with all five arguments and preserves thrown errors", async () => {
    const execute = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      details: undefined,
    }));
    const harness = createExtensionHarness((pi) => {
      pi.registerTool({
        name: "example",
        label: "Example",
        description: "Example tool",
        parameters: Type.Object({ value: Type.String() }),
        execute,
      });
      pi.registerTool({
        name: "failure",
        label: "Failure",
        description: "Failing tool",
        parameters: Type.Object({}),
        execute: async () => {
          throw new Error("direct failure");
        },
      });
    });
    const controller = new AbortController();
    const onUpdate = vi.fn();
    const context = harness.makeContext();

    await harness.invokeToolDirect(
      "example",
      { value: "input" },
      { id: "call-id", signal: controller.signal, onUpdate, context },
    );

    expect(execute).toHaveBeenCalledWith(
      "call-id",
      { value: "input" },
      controller.signal,
      onUpdate,
      context,
    );
    await expect(harness.invokeToolDirect("failure", {})).rejects.toThrow("direct failure");
  });

  it("keeps mutable tool discovery separate from registered tool recording", async () => {
    const harness = createExtensionHarness((pi) => {
      pi.registerTool({
        name: "registered",
        label: "Registered",
        description: "Registered tool",
        parameters: Type.Object({}),
        execute: async () => ({ content: [], details: undefined }),
      });
    });
    await harness.ready;

    harness.allTools.push({ name: "external" });
    harness.api.setActiveTools(["external"]);

    expect(harness.api.getAllTools()).toEqual([{ name: "registered" }, { name: "external" }]);
    expect(harness.api.getActiveTools()).toEqual(["external"]);
  });
});
