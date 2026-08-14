import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { type HandoffDependencies, handoffEnvelope, registerHandoff } from "./index.js";

type Hook = (event: unknown, context: unknown) => unknown;
type Tool = { execute: (...args: unknown[]) => Promise<unknown> };
type CountdownComponent = { handleInput(data: string): void };
type NewSessionRequest = {
  parentSession?: string;
  setup?(manager: { cleanup(): Promise<void> }): Promise<void>;
  withSession(context: {
    ui: { notify(...args: unknown[]): void; setEditorText(text: string): void };
    sendMessage(...args: unknown[]): Promise<void>;
  }): Promise<void>;
};

function createHarness(
  options: {
    queueFails?: boolean;
    sendFails?: boolean;
    newFails?: boolean;
    newCancelled?: boolean;
    staleAfterFailure?: boolean;
  } = {},
) {
  const hooks = new Map<string, Hook>();
  const commands = new Map<string, { handler(token: string, context: unknown): Promise<void> }>();
  let tool: Tool | undefined;
  const queued: string[][] = [];
  const notices: unknown[][] = [];
  const editor: string[] = [];
  const replacementEditor: string[] = [];
  const sent: unknown[][] = [];
  const sessions: NewSessionRequest[] = [];
  const clearInterval = vi.fn();
  const clearTimeout = vi.fn();
  let intervalCallback: (() => void) | undefined;
  let timeoutCallback: (() => void) | undefined;
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
  const pi = {
    on(name: string, hook: Hook) {
      hooks.set(name, hook);
    },
    registerCommand(
      name: string,
      command: { handler(token: string, context: unknown): Promise<void> },
    ) {
      commands.set(name, command);
    },
    registerTool(next: Tool) {
      tool = next;
    },
    queueCommand(name: string, token: string) {
      if (queueFails) throw new Error("queue failed");
      queued.push([name, token]);
    },
  } as unknown as ExtensionAPI;
  const context = {
    mode: "tui",
    sessionManager: {
      getSessionFile: () => sessionFile,
      getLeafEntry: () => leaf,
    },
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
          const createComponent = factory as (
            tui: { requestRender(): void },
            theme: unknown,
            keybindings: { matches(data: string, binding: string): boolean },
            done: (result: boolean) => void,
          ) => CountdownComponent;
          done = resolve;
          component = createComponent(
            { requestRender: vi.fn() },
            {},
            { matches: (data: string) => data === "escape" },
            resolve,
          );
        }),
    },
    newSession: async (request: unknown) => {
      const handoffRequest = request as NewSessionRequest;
      sessions.push(handoffRequest);
      if (options.newCancelled) return { cancelled: true };
      await handoffRequest.setup?.({ cleanup: vi.fn(async () => undefined) });
      if (options.newFails) {
        oldContextStale = options.staleAfterFailure ?? false;
        throw new Error("new session failed");
      }
      await handoffRequest.withSession({
        ui: {
          notify: (...args: unknown[]) => notices.push(args),
          setEditorText: (text: string) => replacementEditor.push(text),
        },
        sendMessage: async (...args: unknown[]) => {
          sent.push(args);
          if (options.sendFails) throw new Error("send failed");
        },
      });
      return { cancelled: false };
    },
  };
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
  registerHandoff(pi, dependencies);
  return {
    hooks,
    commands,
    queued,
    notices,
    editor,
    replacementEditor,
    sent,
    sessions,
    context,
    execute: (kickoff = "Continue.") =>
      tool?.execute("call", { kickoff }, undefined, undefined, context),
    continue: () => commands.get("handoff-session-continue")?.handler("request-id", context),
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
  it("suppresses only the imminent threshold compaction while handoff is pending", async () => {
    const h = createHarness();
    await h.execute();
    const beforeCompact = h.hooks.get("session_before_compact");

    expect(h.queued).toEqual([["handoff-session-continue", "request-id"]]);
    expect(beforeCompact?.({ reason: "manual" }, h.context)).toBeUndefined();
    expect(beforeCompact?.({ reason: "overflow" }, h.context)).toBeUndefined();
    expect(beforeCompact?.({ reason: "threshold" }, h.context)).toEqual({ cancel: true });
    expect(beforeCompact?.({ reason: "threshold" }, h.context)).toBeUndefined();

    const continuation = h.continue();
    h.finish();
    await continuation;
    expect(h.sessions).toHaveLength(1);
  });

  it("preserves exact kickoff text and parent linkage in the replacement session", async () => {
    const h = createHarness();
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
    const h = createHarness();
    await h.execute();
    const pending = h.continue();
    h.cancel();
    await pending;

    expect(h.sessions).toHaveLength(0);
    expect(h.notices).toEqual([["Fresh-session handoff canceled."]]);
    await expect(h.execute()).resolves.toMatchObject({ terminate: true });
  });

  it("uses only the replacement context for delivery recovery", async () => {
    const h = createHarness({ sendFails: true });
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

  it("recovers in the original editor when session replacement is cancelled", async () => {
    const h = createHarness({ newCancelled: true });
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
    const h = createHarness({ newFails: true, staleAfterFailure: true });
    await h.execute("recover exactly");
    const pending = h.continue();
    h.finish();
    await expect(pending).rejects.toThrow("new session failed");
    expect(h.oldUiCalls).toBe(0);
  });

  it("rejects invalid kickoff, unsupported context, mixed batches, and queue failures", async () => {
    const h = createHarness({ queueFails: true });
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
      h.hooks.get("tool_call")?.({ toolCallId: "other", toolName: "read" }, h.context),
    ).toMatchObject({ block: true });
    h.dropSession();
    const fresh = createHarness();
    fresh.dropSession();
    await expect(fresh.execute()).rejects.toThrow("persisted interactive");
  });

  it("completes automatically after five seconds and clears both timers", async () => {
    const h = createHarness();
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
    await expect(createHarness().execute("x".repeat(1_000))).resolves.toMatchObject({
      terminate: true,
    });
    await expect(createHarness().execute("x".repeat(1_001))).rejects.toThrow("1000");
    await expect(createHarness().execute("😀".repeat(501))).rejects.toThrow("1000");
  });

  it("clears pending state when shutdown or command completion occurs", async () => {
    const h = createHarness();
    await h.execute();
    h.hooks.get("session_shutdown")?.({}, h.context);
    await expect(h.continue()).rejects.toThrow("matching pending");
    await h.execute();
    const pending = h.continue();
    h.finish();
    await pending;
    await expect(h.execute()).resolves.toMatchObject({ terminate: true });
  });
});
