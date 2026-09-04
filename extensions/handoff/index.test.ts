import { describe, expect, it, vi } from "vitest";
import { createExtensionHarness } from "../../tests/extension-harness.js";
import { handoffEnvelope, registerHandoff } from "./index.js";

interface NewSessionRequest {
  setup?(sessionManager: {
    appendCustomEntry(type: string, data?: unknown): unknown;
  }): Promise<void>;
  withSession?(context: {
    sendMessage(...args: unknown[]): Promise<void>;
    ui: {
      setEditorText(text: string): unknown;
      notify(...args: unknown[]): unknown;
    };
  }): Promise<void>;
}

function createHarness(options: { persisted?: boolean; mode?: "tui" | "rpc" | "print" } = {}) {
  const harness = createExtensionHarness();
  let leaf: unknown = {
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: "call", name: "handoff_session" }],
    },
  };
  const setupEntries: Array<[string, unknown]> = [];
  const sent: unknown[][] = [];
  const editor: string[] = [];
  const notices: unknown[][] = [];
  const newSession = vi.fn(async (request: NewSessionRequest) => {
    await request.setup?.({
      appendCustomEntry: (type: string, data: unknown) => setupEntries.push([type, data]),
    });
    await request.withSession?.({
      sendMessage: async (...args: unknown[]) => {
        sent.push(args);
      },
      ui: {
        setEditorText: (text: string) => editor.push(text),
        notify: (...args: unknown[]) => notices.push(args),
      },
    });
    return { cancelled: false };
  });
  const context = {
    mode: options.mode ?? "tui",
    sessionManager: {
      getSessionFile: () => (options.persisted === false ? undefined : "parent.jsonl"),
      getLeafEntry: () => leaf,
    },
    ui: {
      setEditorText: (text: string) => editor.push(text),
      notify: (...args: unknown[]) => notices.push(args),
      custom: vi.fn(),
    },
    newSession,
  };
  registerHandoff(harness.api, { randomUUID: () => "request-id" });
  return {
    ...harness,
    context,
    setupEntries,
    sent,
    editor,
    notices,
    newSession,
    start: () => harness.invoke("session_start", {}, context),
    execute: (kickoff = "Continue.") => harness.execute("handoff_session", { kickoff }, context),
    continue: (token = "request-id") =>
      harness.commands.get("handoff-session-continue")?.handler(token, context),
    setLeaf(value: unknown) {
      leaf = value;
    },
  };
}

describe("fresh-session handoff", () => {
  it("registers only for a persisted session", async () => {
    const ephemeral = createHarness({ persisted: false });
    await ephemeral.start();
    expect(ephemeral.tools).toEqual([]);
    expect(ephemeral.commands.size).toBe(0);

    const persisted = createHarness();
    await persisted.start();
    expect(persisted.tools.map((tool) => tool.name)).toEqual(["handoff_session"]);
    expect(persisted.commands.has("handoff-session-continue")).toBe(true);
  });

  it.each(["tui", "rpc"] as const)("hands off immediately in %s mode", async (mode) => {
    const harness = createHarness({ mode });
    await harness.start();
    const kickoff = "Preserve this exact kickoff.";
    await expect(harness.execute(kickoff)).resolves.toEqual({
      content: [{ type: "text", text: "Fresh-session handoff queued." }],
      details: {},
      terminate: true,
    });
    await harness.continue();

    expect(harness.queuedCommands).toEqual([["handoff-session-continue", "request-id"]]);
    expect(harness.newSession).toHaveBeenCalledWith(
      expect.objectContaining({ parentSession: "parent.jsonl" }),
    );
    expect(harness.sent).toEqual([
      [
        {
          customType: "session-handoff",
          content: handoffEnvelope(kickoff),
          display: true,
        },
        { triggerTurn: true },
      ],
    ]);
    expect(harness.context.ui.custom).not.toHaveBeenCalled();
  });

  it("persists timing continuity before replacement delivery", async () => {
    const harness = createHarness();
    harness.bus.on("pi-tools:handoff-continuity-request", (value) => {
      (value as { timing?: unknown }).timing = { agentDurationMs: 5_000, turnCount: 2 };
    });
    await harness.start();
    await harness.execute();
    await harness.continue();
    expect(harness.setupEntries).toEqual([
      ["pi-tools:handoff-continuity", { timing: { agentDurationMs: 5_000, turnCount: 2 } }],
    ]);
  });

  it("suppresses one threshold compaction while a handoff is pending", async () => {
    const harness = createHarness();
    await harness.start();
    await harness.execute();
    expect(
      await harness.invoke("session_before_compact", { reason: "manual" }, harness.context),
    ).toEqual([undefined]);
    expect(
      await harness.invoke("session_before_compact", { reason: "threshold" }, harness.context),
    ).toEqual([{ cancel: true }]);
    expect(
      await harness.invoke("session_before_compact", { reason: "threshold" }, harness.context),
    ).toEqual([undefined]);
  });

  it("blocks handoff in a parallel tool batch", async () => {
    const harness = createHarness();
    await harness.start();
    harness.setLeaf({
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
      await harness.invoke("tool_call", { toolCallId: "other", toolName: "read" }, harness.context),
    ).toMatchObject([{ block: true }]);
  });

  it("uses the correlation token so stale commands cannot consume newer work", async () => {
    const harness = createHarness();
    await harness.start();
    await harness.execute("first");
    await harness.continue("stale");
    expect(harness.newSession).not.toHaveBeenCalled();
    await harness.continue("request-id");
    expect(harness.newSession).toHaveBeenCalledOnce();
  });

  it("validates mode, content, and UTF-8 size", async () => {
    const print = createHarness({ mode: "print" });
    await print.start();
    await expect(print.execute()).rejects.toThrow("persisted Pi session");

    const harness = createHarness();
    await harness.start();
    await expect(harness.execute(" ")).rejects.toThrow("non-whitespace");
    await expect(harness.execute(`x${"😀".repeat(4_096)}`)).rejects.toThrow("16 KiB");
  });
});
