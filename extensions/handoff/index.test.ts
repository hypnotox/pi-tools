import { createExtensionRecorder } from "pi-tools/testing";
import { describe, expect, it, vi } from "vitest";
import { type HandoffDependencies, handoffEnvelope, registerHandoff } from "./index.js";

type CountdownComponent = { handleInput(data: string): void };

async function createHarness(
  options: {
    queueFails?: boolean;
    sendFails?: boolean;
    newFails?: boolean;
    newCancelled?: boolean;
    staleAfterFailure?: boolean;
    replacementEditorFails?: boolean;
    existingTools?: string[];
  } = {},
) {
  const clearInterval = vi.fn();
  const clearTimeout = vi.fn();
  let intervalCallback: (() => void) | undefined;
  let timeoutCallback: (() => void) | undefined;
  const dependencies: HandoffDependencies = {
    randomUUID: () => "request-id",
    setInterval: vi.fn((callback) => {
      intervalCallback = callback;
      return "interval";
    }),
    clearInterval,
    setTimeout: vi.fn((callback) => {
      timeoutCallback = callback;
      return "timeout";
    }),
    clearTimeout,
  };
  const shared = createExtensionRecorder();
  void shared.install((pi) => registerHandoff(pi, dependencies));
  shared.allTools.push(...(options.existingTools ?? []).map((name) => ({ name })));
  const notices: unknown[][] = [];
  const editor: string[] = [];
  const replacementEditor: string[] = [];
  const sent: unknown[][] = [];
  const sessions: Array<{ parentSession?: string }> = [];
  let oldContextStale = false;
  let oldUiCalls = 0;
  let done: ((result: boolean) => void) | undefined;
  let component: CountdownComponent | undefined;
  let queueFails = options.queueFails ?? false;
  let sessionFile: string | undefined = "parent.jsonl";
  let leaf: unknown = {
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: "call", name: "handoff_session" }],
    },
  };
  const context = shared.makeCommandContext({
    sessionManager: { getSessionFile: () => sessionFile, getLeafEntry: () => leaf } as never,
    ui: {
      notify: (...args: unknown[]) => {
        oldUiCalls += 1;
        if (oldContextStale) throw new Error("stale context");
        notices.push(args);
      },
      setEditorText: (text: string) => {
        oldUiCalls += 1;
        if (oldContextStale) throw new Error("stale context");
        editor.push(text);
      },
      custom: (factory: unknown) =>
        new Promise<boolean>((resolve) => {
          const make = factory as (
            tui: { requestRender(): void },
            theme: unknown,
            keys: { matches(data: string, binding: string): boolean },
            finish: (result: boolean) => void,
          ) => CountdownComponent;
          done = resolve;
          component = make(
            { requestRender: vi.fn() },
            {},
            { matches: (data) => data === "escape" },
            resolve,
          );
        }),
    } as never,
    newSession: async (request) => {
      sessions.push(request as { parentSession?: string });
      if (options.newCancelled) return { cancelled: true };
      if (options.newFails) {
        oldContextStale = options.staleAfterFailure ?? false;
        throw new Error("new session failed");
      }
      const replacement = shared.makeCommandContext({
        sendMessage: async (...args: unknown[]) => {
          sent.push(args);
          if (options.sendFails) throw new Error("send failed");
        },
        ui: {
          notify: (...args: unknown[]) => notices.push(args),
          setEditorText: (text: string) => {
            if (options.replacementEditorFails) throw new Error("replacement editor failed");
            replacementEditor.push(text);
          },
        } as never,
      } as never) as never;
      await request?.withSession?.(replacement);
      return { cancelled: false };
    },
  });
  const queueCommand = shared.api.queueCommand.bind(shared.api);
  shared.api.queueCommand = (name, token) => {
    if (queueFails) throw new Error("queue failed");
    queueCommand(name, token);
  };
  await shared.ready;
  await shared.invokeRaw("session_start", {}, context);
  return {
    ...shared,
    context,
    notices,
    editor,
    replacementEditor,
    sent,
    sessions,
    execute: (kickoff = "Continue.") =>
      shared.invokeToolDirect("handoff_session", { kickoff }, { id: "call", context }),
    continue: () => shared.invokeCommandDirect("handoff-session-continue", "request-id", context),
    finish: (value = true) => done?.(value),
    expireCountdown: () => timeoutCallback?.(),
    tickCountdown: () => intervalCallback?.(),
    cancel: () => component?.handleInput("escape"),
    clearInterval,
    clearTimeout,
    get oldUiCalls() {
      return oldUiCalls;
    },
    setQueueFails: (value: boolean) => {
      queueFails = value;
    },
    setLeaf: (value: unknown) => {
      leaf = value;
    },
    dropSession: () => {
      sessionFile = undefined;
    },
  };
}

describe("fresh-session handoff extension", () => {
  it("yields tool ownership when another extension already provides handoff_session", async () => {
    const h = await createHarness({ existingTools: ["handoff_session"] });

    await expect(
      h.invokeRaw("tool_call", { toolCallId: "call", toolName: "handoff_session" }, h.context),
    ).resolves.toEqual([undefined]);

    expect(h.tools).toHaveLength(0);
    expect(h.commands).toHaveLength(0);
  });

  it("suppresses only the imminent threshold compaction while handoff is pending", async () => {
    const h = await createHarness();
    await h.execute();
    const beforeCompact = h.invokeRaw.bind(h, "session_before_compact");

    expect(h.queuedCommands).toEqual([["handoff-session-continue", "request-id"]]);
    await expect(beforeCompact({ reason: "manual" }, h.context)).resolves.toEqual([undefined]);
    await expect(beforeCompact({ reason: "overflow" }, h.context)).resolves.toEqual([undefined]);
    await expect(beforeCompact({ reason: "threshold" }, h.context)).resolves.toEqual([
      { cancel: true },
    ]);
    await expect(beforeCompact({ reason: "threshold" }, h.context)).resolves.toEqual([undefined]);

    const continuation = h.continue();
    h.finish();
    await continuation;
    expect(h.sessions).toHaveLength(1);
  });

  it("preserves exact kickoff text and parent linkage in the replacement session", async () => {
    const h = await createHarness();
    const kickoff = "  keep this exact prose  ";
    await h.execute(kickoff);
    const pending = h.continue();
    h.finish();
    await pending;

    const envelope = handoffEnvelope(kickoff);
    expect(h.sessions[0]?.parentSession).toBe("parent.jsonl");
    expect(h.sent).toEqual([
      [{ customType: "session-handoff", content: envelope, display: true }, { triggerTurn: true }],
    ]);
    expect(envelope.endsWith(kickoff)).toBe(true);
  });

  it("cancels the countdown, clears pending state, and does not replace the session", async () => {
    const h = await createHarness();
    await h.execute();
    const pending = h.continue();
    h.cancel();
    await pending;

    expect(h.sessions).toHaveLength(0);
    expect(h.notices).toEqual([["Fresh-session handoff canceled."]]);
    await expect(h.execute()).resolves.toMatchObject({ terminate: true });
  });

  it("uses only the replacement context for delivery recovery", async () => {
    const h = await createHarness({ sendFails: true });
    await h.execute("recover exactly");
    const pending = h.continue();
    h.finish();
    await pending;

    expect(h.editor).toEqual([]);
    expect(h.replacementEditor).toEqual([handoffEnvelope("recover exactly")]);
    expect(h.notices).toEqual([
      ["Automatic kickoff failed; submit the prepared editor text.", "warning"],
    ]);
  });

  it("reports delivery failure when replacement editor recovery also fails", async () => {
    const h = await createHarness({ sendFails: true, replacementEditorFails: true });
    await h.execute("cannot recover");
    const pending = h.continue();
    h.finish();

    await expect(pending).rejects.toThrow("send failed");
    expect(h.replacementEditor).toEqual([]);
    expect(h.notices).toEqual([]);
  });

  it("recovers in the original editor when session replacement is cancelled", async () => {
    const h = await createHarness({ newCancelled: true });
    await h.execute("recover exactly");
    const pending = h.continue();
    h.finish();
    await pending;

    expect(h.editor).toEqual([handoffEnvelope("recover exactly")]);
    expect(h.notices).toEqual([
      ["Fresh-session handoff canceled; recovery text is in the editor.", "warning"],
    ]);
  });

  it("never touches the stale original context after replacement teardown", async () => {
    const h = await createHarness({ newFails: true, staleAfterFailure: true });
    await h.execute("recover exactly");
    const pending = h.continue();
    h.finish();
    await expect(pending).rejects.toThrow("new session failed");
    expect(h.oldUiCalls).toBe(0);
  });

  it("rejects invalid kickoff, unsupported context, mixed batches, and queue failures", async () => {
    const h = await createHarness({ queueFails: true });
    await expect(h.execute(" ")).rejects.toThrow("kickoff");
    await expect(h.execute()).rejects.toThrow("queue failed");
    h.setQueueFails(false);
    await expect(h.execute()).resolves.toMatchObject({ terminate: true });
    h.setLeaf({
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "call", name: "handoff_session" },
          { type: "toolCall", id: "other", name: "read" },
        ],
      },
    });
    expect(
      await h.invokeRaw("tool_call", { toolCallId: "other", toolName: "read" }, h.context),
    ).toMatchObject([{ block: true }]);
    h.dropSession();
    const fresh = await createHarness();
    fresh.dropSession();
    await expect(fresh.execute()).rejects.toThrow("persisted interactive");
  });

  it("completes automatically after five seconds and clears both timers", async () => {
    const h = await createHarness();
    await h.execute();
    const pending = h.continue();
    h.tickCountdown();
    h.expireCountdown();
    await pending;

    expect(h.sessions).toHaveLength(1);
    expect(h.clearInterval).toHaveBeenCalledWith("interval");
    expect(h.clearTimeout).toHaveBeenCalledWith("timeout");
  });

  it("enforces the 1,000 UTF-16 code-unit kickoff boundary", async () => {
    await expect((await createHarness()).execute("x".repeat(1_000))).resolves.toMatchObject({
      terminate: true,
    });
    await expect((await createHarness()).execute("x".repeat(1_001))).rejects.toThrow("1000");
    await expect((await createHarness()).execute("😀".repeat(501))).rejects.toThrow("1000");
  });

  it("clears pending state when shutdown or command completion occurs", async () => {
    const h = await createHarness();
    await h.execute();
    await h.invokeRaw("session_shutdown", {}, h.context);
    await expect(h.continue()).rejects.toThrow("matching pending");
    await h.execute();
    const pending = h.continue();
    h.finish();
    await pending;
    await expect(h.execute()).resolves.toMatchObject({ terminate: true });
  });
});
