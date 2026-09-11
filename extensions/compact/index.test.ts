import type { CompactOptions } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createExtensionHarness } from "../../tests/extension-harness.js";
import { registerHandoff } from "../handoff/index.js";
import compactExtension from "./index.js";

function fixture() {
  const harness = createExtensionHarness();
  let session = "parent.jsonl";
  const messages: unknown[][] = [];
  Object.assign(harness.api, { sendMessage: (...args: unknown[]) => messages.push(args) });
  const compact = vi.fn<(options: CompactOptions) => void>();
  const ctx = {
    mode: "rpc",
    signal: undefined as AbortSignal | undefined,
    sessionManager: {
      getSessionFile: () => session,
      getLeafEntry: () => ({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call", name: "compact_session" }],
        },
      }),
    },
    compact,
    waitForIdle: vi.fn(async () => {}),
    isIdle: () => true,
    hasPendingMessages: () => false,
    ui: { notify: vi.fn() },
  };
  compactExtension(harness.api);
  registerHandoff(harness.api, { randomUUID: () => "handoff-id" });
  const execute = (instructions = "Preserve goal.\nNext: test.") =>
    harness.execute("compact_session", { instructions }, ctx);
  const command = () => {
    const sent = harness.sentUserMessages.at(-1)?.[0];
    if (typeof sent !== "string") throw new Error("No dispatched command");
    return harness.commands.get("compact-session-continue")?.handler(sent.split(" ")[1], ctx);
  };
  return {
    ...harness,
    ctx,
    compact,
    messages,
    execute,
    command,
    start: () => harness.invoke("session_start", {}, ctx),
    replace: () => {
      session = "replacement.jsonl";
    },
  };
}

describe("guided compaction adapter", () => {
  it.each(["complete", "pending", "canceled", "failed"] as const)(
    "delimits the %s outcome without changing continuation",
    async (outcome) => {
      const f = fixture();
      f.ctx.hasPendingMessages = () => outcome === "pending";
      await f.start();
      await f.execute();
      const command = f.command();
      await Promise.resolve();
      const options = f.compact.mock.calls[0]?.[0];
      expect(options).toBeDefined();
      if (outcome === "canceled") {
        const controller = new AbortController();
        await f.invoke(
          "session_before_compact",
          {
            reason: "manual",
            customInstructions: options?.customInstructions,
            signal: controller.signal,
          },
          f.ctx,
        );
        controller.abort();
      }
      if (outcome === "failed") options?.onError?.(new Error("Native failure"));
      else
        options?.onComplete?.({
          summary: "Saved summary.",
          firstKeptEntryId: "kept",
          tokensBefore: 1_000,
        });
      await command;
      expect(f.messages).toEqual([
        [
          expect.objectContaining({
            customType: "session-guided-compaction",
            content: expect.stringMatching(
              /^<extension-context source="pi-tools\/compact">\n[\s\S]+\n<\/extension-context>$/,
            ),
            display: true,
          }),
          { triggerTurn: outcome === "complete" || outcome === "pending" },
        ],
      ]);
      if (outcome === "failed")
        expect(f.messages[0]?.[0]).toMatchObject({
          content: expect.stringContaining("Native failure"),
        });
    },
  );

  it("keeps the owned lease until the terminal callback and rejects competing handoff", async () => {
    const f = fixture();
    await f.start();
    await expect(f.execute()).resolves.toMatchObject({
      terminate: true,
      content: [{ text: "Guided compaction queued." }],
    });
    const first = f.command();
    await Promise.resolve();
    expect(f.compact).toHaveBeenCalledOnce();
    await expect(f.execute()).resolves.toMatchObject({
      content: [{ text: "Guided compaction already in progress." }],
    });
    await f.command();
    await expect(f.execute(" ")).rejects.toThrow("non-whitespace");
    await expect(f.execute("😀".repeat(4097))).rejects.toThrow("16 KiB");
    await expect(f.execute("a".repeat(16384))).resolves.toMatchObject({ terminate: true });
    await expect(f.execute("a".repeat(16385))).rejects.toThrow("16 KiB");
    expect(f.api.getAllTools().length).toBe(2);
    await expect(
      f.tools
        .find((tool) => tool.name === "handoff_session")
        ?.execute("other", { kickoff: "Continue" }, undefined, undefined, f.ctx),
    ).rejects.toThrow("Another context operation");
    f.compact.mock.calls[0]?.[0].onError?.(new Error("Already compacted"));
    await first;
    expect(f.messages).toEqual([
      [
        expect.objectContaining({ content: expect.stringContaining("Already compacted") }),
        { triggerTurn: false },
      ],
    ]);
    await f.execute();
    const later = f.command();
    await Promise.resolve();
    expect(f.compact).toHaveBeenCalledTimes(2);
    f.compact.mock.calls[1]?.[0].onError?.(new Error("Nothing to compact (session too small)"));
    await later;
  });

  it.each(["session_shutdown", "session_tree", "replacement"])(
    "ignores late callbacks after %s",
    async (event) => {
      const f = fixture();
      await f.start();
      await f.execute();
      const command = f.command();
      await Promise.resolve();
      if (event === "replacement") f.replace();
      else await f.invoke(event, {}, f.ctx);
      f.compact.mock.calls[0]?.[0].onError?.(new Error("late failure"));
      await command;
      expect(f.messages).toEqual([]);
      expect(f.ctx.ui.notify).not.toHaveBeenCalled();
    },
  );

  it("does not suppress manual/overflow and clears bounded threshold suppression after abort", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.ctx.signal = controller.signal;
    await f.start();
    await f.execute();
    const beforeCompact = async (reason: string) =>
      (await f.invoke("session_before_compact", { reason }, f.ctx)).filter(Boolean);
    expect(await beforeCompact("manual")).toEqual([]);
    expect(await beforeCompact("overflow")).toEqual([]);
    expect(await beforeCompact("threshold")).toEqual([{ cancel: true }]);
    expect(await beforeCompact("threshold")).toEqual([]);
    await f.execute();
    expect(await beforeCompact("threshold")).toEqual([]);
    controller.abort();
    await f.command();
    expect(f.compact).not.toHaveBeenCalled();
  });

  it("rejects missing correlation and ineligible execution", async () => {
    const f = fixture();
    await f.start();
    expect(
      await f.invoke("tool_call", { toolName: "compact_session", toolCallId: "unknown" }, f.ctx),
    ).toMatchObject([{ block: true }, undefined]);
    f.ctx.mode = "print";
    await expect(f.execute()).rejects.toThrow("persisted Pi session");
  });
});
