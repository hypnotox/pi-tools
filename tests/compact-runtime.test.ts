import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { type ExtensionAPI, type ExtensionContext, VERSION } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contextRuntime } from "./context-runtime-fixture.js";

describe("native Pi compaction ordering", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  it.each([false, true])("observes callback arbitration with competing wake=%s", async (wake) => {
    let context: ExtensionContext | undefined;
    const order: string[] = [];
    let requests = 0;
    let prefixRequest = "";
    const fixture = await contextRuntime({
      factory(pi) {
        pi.on("session_start", (_event, ctx) => {
          context = ctx;
        });
        pi.on("session_compact", (_event, ctx) => {
          order.push(`session_compact:idle=${ctx.isIdle()}`);
          if (wake)
            pi.sendMessage(
              { customType: "test-wake", content: "Continue active work", display: false },
              { triggerTurn: true },
            );
        });
      },
    });
    cleanups.push(() => fixture.dispose());
    const { runtime, faux } = fixture;
    faux.setResponses([
      fauxAssistantMessage("old work ".repeat(500)),
      (context) => {
        prefixRequest = JSON.stringify(context);
        return fauxAssistantMessage("native summary");
      },
      () => {
        requests++;
        return fauxAssistantMessage("wake received");
      },
    ]);
    await runtime.session.prompt("Old objective");
    runtime.session.subscribe((event) => {
      if (event.type === "compaction_end")
        order.push(`compaction_end:idle=${runtime.session.isIdle}`);
    });
    context?.compact({
      customInstructions: "Keep the objective",
      onComplete() {
        order.push(`callback:idle=${context?.isIdle()}`);
      },
      onError(error) {
        throw error;
      },
    });
    await vi.waitFor(() => expect(order.some((item) => item.startsWith("callback:"))).toBe(true));
    await runtime.session.waitForIdle();
    expect(order[0]).toBe("session_compact:idle=false");
    expect(order[1]).toBe(`compaction_end:idle=${!wake}`);
    expect(order[2]).toBe(`callback:idle=${!wake}`);
    expect(requests).toBe(wake ? 1 : 0);
    // Pi 0.85.1 native prefix-only summarization does not transport custom focus.
    expect(prefixRequest).toContain("PREFIX of a turn");
    expect(prefixRequest).not.toContain("Keep the objective");
    expect(fixture.errors).toEqual([]);
  });
});

describe("guided compaction on the real loader/runtime", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });
  const extensions = [
    "extensions/handoff/index.ts",
    "extensions/compact/index.ts",
    "extensions/context-usage/index.ts",
  ];

  it.each(["tui", "rpc"] as const)(
    "settles, summarizes natively, rebuilds context and resumes once in %s; later calls remain independent",
    async (mode) => {
      let toolReady = false;
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const events: string[] = [];
      const nativeInstructions: Array<string | undefined> = [];
      const fixture = await contextRuntime({
        extensions,
        mode,
        autoCompaction: true,
        factory(pi) {
          pi.on("tool_result", async (event) => {
            if (event.toolName === "compact_session") {
              toolReady = true;
              await gate;
            }
          });
          pi.on("agent_settled", () => {
            events.push("settled");
          });
          pi.on("session_before_compact", (event) => {
            events.push("compact");
            nativeInstructions.push(event.customInstructions);
          });
        },
      });
      cleanups.push(async () => {
        release();
        await fixture.dispose();
      });
      const { runtime, faux } = fixture;
      expect(runtime.services.resourceLoader.getExtensions().errors).toEqual([]);
      const original = runtime.session;
      const originalFile = original.sessionFile;
      const originalId = original.sessionManager.getSessionId();
      const instructions = "Preserve objective ORBIT and decision GREEN.\nNext: verify the result.";
      const providerRequests: string[] = [];
      faux.setResponses([
        fauxAssistantMessage("Earlier objective ORBIT. ".repeat(200)),
        () => {
          const response = fauxAssistantMessage(fauxToolCall("compact_session", { instructions }), {
            stopReason: "toolUse",
          });
          response.usage.input = 90_000;
          response.usage.totalTokens = 90_000;
          return response;
        },
        (context) => {
          providerRequests.push(JSON.stringify(context));
          return fauxAssistantMessage(
            "Native summary: objective ORBIT; decision GREEN; next verify result.",
          );
        },
        (context) => {
          providerRequests.push(JSON.stringify(context));
          return fauxAssistantMessage("Verified the result.");
        },
        fauxAssistantMessage(
          fauxToolCall("compact_session", { instructions: "Preserve later independent work" }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("Updated native summary: ORBIT is verified."),
        (context) => {
          providerRequests.push(JSON.stringify(context));
          return fauxAssistantMessage("Later compaction resumed.");
        },
      ]);
      await original.prompt("Old background");
      events.length = 0;
      const prompt = original.prompt(
        `Compact at this checkpoint. ${"Recent retained work. ".repeat(100)}`,
      );
      await vi.waitFor(() => expect(toolReady).toBe(true));
      expect(events).toEqual([]);
      expect(
        original.sessionManager.getEntries().some((entry) => entry.type === "compaction"),
      ).toBe(false);
      release();
      await prompt;
      await vi.waitFor(() => expect(providerRequests).toHaveLength(2));
      await original.waitForIdle();
      expect(events).toEqual(["settled", "compact", "settled"]);
      expect(nativeInstructions).toEqual([instructions]);
      expect(providerRequests[0]).toContain(instructions.replace("\n", "\\n"));
      expect(providerRequests[1]).toContain("Native summary: objective ORBIT");
      expect(providerRequests[1]).not.toContain("compact-session-continue");
      expect(providerRequests[1]).toContain("pressure=unknown");
      expect(
        original.sessionManager.getEntries().filter((entry) => entry.type === "compaction"),
      ).toHaveLength(1);
      await original.prompt(
        `More work; compact independently again. ${"Recent retained work. ".repeat(100)}`,
      );
      await vi.waitFor(() => expect(providerRequests).toHaveLength(3));
      await original.waitForIdle();
      expect(
        original.sessionManager.getEntries().filter((entry) => entry.type === "compaction"),
      ).toHaveLength(2);
      expect(runtime.session).toBe(original);
      expect(original.sessionFile).toBe(originalFile);
      expect(original.sessionManager.getSessionId()).toBe(originalId);
      expect(fixture.generations()).toBe(1);
      expect(
        original.sessionManager
          .getEntries()
          .some(
            (entry) =>
              entry.type === "custom" && entry.customType === "pi-tools:handoff-continuity",
          ),
      ).toBe(false);
      expect(fixture.errors).toEqual([]);
    },
  );

  it.each(["session_compact", "compaction_end", "during-summary", "user-prompt"] as const)(
    "preserves a genuine message arriving at %s without redundant automatic continuation",
    async (arrival) => {
      let extension: import("@earendil-works/pi-coding-agent").ExtensionAPI | undefined;
      const incoming = "Genuine child result: step two is ready";
      const fixture = await contextRuntime({
        extensions,
        factory(pi) {
          extension = pi;
          if (arrival === "session_compact")
            pi.on("session_compact", () => {
              pi.sendMessage(
                { customType: "test-incoming", content: incoming, display: true },
                { triggerTurn: true },
              );
            });
        },
      });
      cleanups.push(() => fixture.dispose());
      const { runtime, faux } = fixture;
      if (arrival === "compaction_end")
        runtime.session.subscribe((event) => {
          if (event.type === "compaction_end")
            extension?.sendMessage(
              { customType: "test-incoming", content: incoming, display: true },
              { triggerTurn: true },
            );
        });
      let userPrompt: Promise<void> | undefined;
      let userPromptError: unknown;
      if (arrival === "user-prompt")
        runtime.session.subscribe((event) => {
          if (event.type === "compaction_end")
            userPrompt = runtime.session
              .prompt(incoming, { streamingBehavior: "followUp" })
              .catch((error) => {
                userPromptError = error;
              });
        });
      let requests = 0;
      faux.setResponses([
        fauxAssistantMessage("Old work ".repeat(300)),
        fauxAssistantMessage(fauxToolCall("compact_session", { instructions: "Keep work" }), {
          stopReason: "toolUse",
        }),
        async () => {
          if (arrival === "during-summary") {
            extension?.sendMessage(
              { customType: "test-incoming", content: incoming, display: true },
              { triggerTurn: true },
            );
            // This competing run can finish even before native compaction returns.
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return fauxAssistantMessage("Native summary");
        },
        () => {
          requests++;
          return fauxAssistantMessage("Incoming result handled once");
        },
      ]);
      await runtime.session.prompt("Old background");
      await runtime.session.prompt("Compact checkpoint");
      await vi.waitFor(() =>
        expect(
          runtime.session.messages.some(
            (message) =>
              "customType" in message && message.customType === "session-guided-compaction",
          ),
        ).toBe(true),
      );
      await userPrompt;
      expect(userPromptError).toBeUndefined();
      await runtime.session.waitForIdle();
      expect(requests).toBe(1);
      expect(
        runtime.session.messages.filter((message) =>
          arrival === "user-prompt"
            ? message.role === "user" && JSON.stringify(message.content).includes(incoming)
            : "customType" in message && message.customType === "test-incoming",
        ),
      ).toHaveLength(1);
      expect(JSON.stringify(runtime.session.messages)).toContain(incoming);
      expect(fixture.errors).toEqual([]);
    },
  );

  // Accepted host boundary, NOT desired behavior for future Pi versions. On
  // upgrade, recharacterize sequential input dispatch before extending this pin.
  it.skipIf(VERSION !== "0.85.1").each(["followUp", "plain"] as const)(
    "characterizes accepted Pi 0.85.1 earlier async input boundary: %s",
    async (delivery) => {
      const directory = mkdtempSync(join(tmpdir(), "pi-tools-delayed-input-"));
      cleanups.push(async () => rmSync(directory, { recursive: true, force: true }));
      const earlierExtension = join(directory, "delayed-input.ts");
      const incoming = "GENUINE USER INPUT";
      writeFileSync(
        earlierExtension,
        `export default function (pi) {
          pi.on("input", async (event) => {
            if (event.text !== ${JSON.stringify(incoming)}) return;
            await new Promise((resolve) => {
              const off = pi.events.on("test:release-input", () => {
                off();
                resolve();
              });
              pi.events.emit("test:input-held", {});
            });
          });
        }`,
      );
      let extension: ExtensionAPI | undefined;
      let inputHeld = false;
      let releaseResponse = () => {};
      const responseGate = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      const fixture = await contextRuntime({
        extensions: [earlierExtension, ...extensions],
        factory(pi) {
          extension = pi;
          pi.events.on("test:input-held", () => {
            inputHeld = true;
          });
        },
      });
      cleanups.push(async () => {
        extension?.events.emit("test:release-input", {});
        releaseResponse();
        await fixture.dispose();
      });
      const { runtime, faux } = fixture;
      expect(runtime.services.resourceLoader.getExtensions().errors).toEqual([]);
      let userPrompt: Promise<void> | undefined;
      let userPromptError: unknown;
      let idleAtSubmission: boolean | undefined;
      runtime.session.subscribe((event) => {
        if (event.type !== "compaction_end") return;
        idleAtSubmission = runtime.session.isIdle;
        userPrompt = runtime.session
          .prompt(incoming, delivery === "followUp" ? { streamingBehavior: "followUp" } : {})
          .catch((error) => {
            userPromptError = error;
          });
      });
      const requests: string[] = [];
      faux.setResponses([
        fauxAssistantMessage("Old work ".repeat(300)),
        fauxAssistantMessage(fauxToolCall("compact_session", { instructions: "Keep work" }), {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("Native summary"),
        async (context) => {
          requests.push(JSON.stringify(context));
          await responseGate;
          return fauxAssistantMessage("Automatic continuation before hidden input");
        },
        (context) => {
          requests.push(JSON.stringify(context));
          return fauxAssistantMessage("Genuine input handled in an extra turn");
        },
      ]);
      await runtime.session.prompt("Old background");
      await runtime.session.prompt("Compact checkpoint");
      await vi.waitFor(() => {
        expect(inputHeld).toBe(true);
        expect(requests).toHaveLength(1);
      });
      expect(idleAtSubmission).toBe(true);
      expect(requests[0]).not.toContain(incoming);
      // Keep the automatic run live while Pi resumes the earlier input hook.
      extension?.events.emit("test:release-input", {});
      await userPrompt;
      if (delivery === "plain") {
        expect(userPromptError).toBeInstanceOf(Error);
        expect((userPromptError as Error).message).toBe(
          "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
        );
      } else {
        expect(userPromptError).toBeUndefined();
      }
      releaseResponse();
      await runtime.session.waitForIdle();
      expect(requests).toHaveLength(delivery === "followUp" ? 2 : 1);
      if (delivery === "followUp") expect(requests[1]).toContain(incoming);
      expect(
        runtime.session.messages.filter(
          (message) =>
            message.role === "user" && JSON.stringify(message.content).includes(incoming),
        ),
      ).toHaveLength(delivery === "followUp" ? 1 : 0);
      expect(
        runtime.session.sessionManager.getEntries().filter((entry) => entry.type === "compaction"),
      ).toHaveLength(1);
      expect(fixture.errors).toEqual([]);
    },
    10_000,
  );

  it.each(["cancel", "error", "too-small"] as const)(
    "surfaces native %s without an automatic retry, remains usable",
    async (outcome) => {
      const fixture = await contextRuntime({
        extensions,
        keepRecentTokens: outcome === "too-small" ? 1_000_000 : 100,
        factory(pi) {
          if (outcome === "cancel") pi.on("session_before_compact", () => ({ cancel: true }));
        },
      });
      cleanups.push(() => fixture.dispose());
      const { runtime, faux } = fixture;
      let extra = 0;
      faux.setResponses([
        fauxAssistantMessage("Old work ".repeat(300)),
        fauxAssistantMessage(fauxToolCall("compact_session", { instructions: "Keep work" }), {
          stopReason: "toolUse",
        }),
        ...(outcome === "error"
          ? [
              () => {
                throw new Error("deterministic summarizer failure");
              },
            ]
          : []),
        () => {
          extra++;
          return fauxAssistantMessage("User can recover");
        },
      ]);
      await runtime.session.prompt("Old background");
      await runtime.session.prompt("Compact checkpoint");
      await vi.waitFor(() => expect(fixture.errors).toHaveLength(1));
      expect(extra).toBe(0);
      expect(JSON.stringify(fixture.errors)).toContain(
        outcome === "cancel"
          ? "Compaction cancelled"
          : outcome === "too-small"
            ? "Nothing to compact"
            : "deterministic summarizer failure",
      );
      expect(
        runtime.session.sessionManager.getEntries().filter((entry) => entry.type === "compaction"),
      ).toHaveLength(0);
      await runtime.session.prompt("Recover manually");
      expect(extra).toBe(1);
      expect(fixture.generations()).toBe(1);
    },
  );
});

describe("shared lifecycle through isolated real extension loads", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });
  const extensions = ["extensions/handoff/index.ts", "extensions/compact/index.ts"];

  it.each([
    ["handoff_session", "probe"],
    ["probe", "handoff_session"],
    ["compact_session", "probe"],
    ["probe", "compact_session"],
    ["compact_session", "handoff_session"],
    ["handoff_session", "compact_session"],
  ])("blocks every sibling in %j / %j", async (first, second) => {
    let probes = 0;
    const fixture = await contextRuntime({
      extensions,
      factory(pi) {
        pi.registerTool({
          name: "probe",
          label: "Probe",
          description: "Test probe",
          parameters: Type.Object({}),
          async execute() {
            probes++;
            return { content: [{ type: "text", text: "probe executed" }], details: {} };
          },
        });
      },
    });
    cleanups.push(() => fixture.dispose());
    const { runtime, faux } = fixture;
    const calls = [first, second].map((name) =>
      fauxToolCall(
        name,
        name === "probe"
          ? {}
          : name === "handoff_session"
            ? { kickoff: "Continue" }
            : { instructions: "Preserve work" },
      ),
    );
    faux.setResponses([
      fauxAssistantMessage(calls, { stopReason: "toolUse" }),
      fauxAssistantMessage("Batch rejected"),
    ]);
    await runtime.session.prompt("Attempt a mixed batch");
    expect(probes).toBe(0);
    expect(fixture.generations()).toBe(1);
    const results = runtime.session.messages.filter((message) => message.role === "toolResult");
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.isError)).toBe(true);
    expect(JSON.stringify(results)).toContain("cannot contain siblings");
    expect(fixture.errors).toEqual([]);
  });

  it.each(["cancelled-switch", "replacement", "abort", "tree", "reload"] as const)(
    "invalidates correctly at settlement: %s",
    async (intervention) => {
      let ready = false;
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let cancelSwitch = intervention === "cancelled-switch";
      let compactions = 0;
      let navigate = async () => {};
      const fixture = await contextRuntime({
        extensions,
        factory(pi) {
          pi.on("tool_result", async (event) => {
            if (event.toolName === "compact_session") {
              ready = true;
              await gate;
            }
          });
          pi.on("session_before_switch", () => {
            if (cancelSwitch) {
              cancelSwitch = false;
              return { cancel: true };
            }
          });
          pi.on("session_before_compact", () => {
            compactions++;
          });
          pi.on("agent_settled", async () => {
            if (ready && intervention === "tree") await navigate();
          });
        },
      });
      cleanups.push(async () => {
        release();
        await fixture.dispose();
      });
      const { runtime, faux } = fixture;
      faux.setResponses([
        fauxAssistantMessage("Old background ".repeat(300)),
        fauxAssistantMessage(fauxToolCall("compact_session", { instructions: "Preserve work" }), {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("Summary"),
        fauxAssistantMessage("Continued"),
      ]);
      await runtime.session.prompt("Prior work");
      const original = runtime.session;
      const prompt = original.prompt("Checkpoint");
      await vi.waitFor(() => expect(ready).toBe(true));
      if (intervention === "cancelled-switch") {
        expect(await runtime.newSession()).toEqual({ cancelled: true });
        release();
        await prompt;
        await vi.waitFor(() => expect(compactions).toBe(1));
        await original.waitForIdle();
        return;
      }
      if (intervention === "tree") {
        const target = original.sessionManager
          .getEntries()
          .find((entry) => entry.type === "message" && entry.message.role === "user");
        if (!target) throw new Error("Missing tree target");
        // Native tree navigation requires idle. Its completed event runs inside
        // agent_settled, before the command's idle waiter is resolved.
        navigate = async () => {
          await original.navigateTree(target.id, { summarize: false });
        };
        release();
        await prompt;
      } else if (intervention === "reload") {
        // Native reload invalidates the extension runner but does not abort the agent.
        await original.reload();
        release();
        await prompt;
      } else {
        const action = intervention === "replacement" ? runtime.newSession() : original.abort();
        await vi.waitFor(() => expect(original.agent.signal?.aborted).toBe(true));
        release();
        await prompt;
        await action;
      }
      expect(compactions).toBe(0);
      expect(fixture.errors).toEqual([]);
    },
  );
});

describe("terminal ownership and native cancellation", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  it.each(["cancel", "replacement"] as const)(
    "holds the real-loader cross-entrypoint lease until native %s",
    async (terminal) => {
      let ctx: ExtensionContext | undefined;
      let summarizing = false;
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fixture = await contextRuntime({
        extensions: ["extensions/compact/index.ts", "extensions/handoff/index.ts"],
        factory(pi) {
          pi.on("session_start", (_event, context) => {
            ctx = context;
          });
        },
      });
      cleanups.push(async () => {
        release();
        await fixture.dispose();
      });
      const { runtime, faux } = fixture;
      faux.setResponses([
        fauxAssistantMessage("Old work ".repeat(300)),
        fauxAssistantMessage(fauxToolCall("compact_session", { instructions: "Preserve work" }), {
          stopReason: "toolUse",
        }),
        async () => {
          summarizing = true;
          await gate;
          return fauxAssistantMessage("Late native summary");
        },
        fauxAssistantMessage("User recovered"),
      ]);
      await runtime.session.prompt("Old background");
      const original = runtime.session;
      await original.prompt("Checkpoint");
      await vi.waitFor(() => expect(summarizing).toBe(true));
      const handoff = runtime.services.resourceLoader
        .getExtensions()
        .extensions.flatMap((extension) => [...extension.tools.values()])
        .find((tool) => tool.definition.name === "handoff_session");
      if (!handoff || !ctx) throw new Error("Missing loaded handoff or context");
      await expect(
        handoff.definition.execute("competing", { kickoff: "Replace" }, undefined, undefined, ctx),
      ).rejects.toThrow("Another context operation");
      if (terminal === "replacement") {
        const replacement = runtime.newSession();
        release();
        await replacement;
        expect(runtime.session).not.toBe(original);
        expect(runtime.session.messages).toEqual([]);
      } else {
        original.abortCompaction();
        release();
        await vi.waitFor(() => expect(fixture.errors).toHaveLength(1));
        expect(JSON.stringify(fixture.errors)).toContain("Compaction cancelled");
        expect(
          original.sessionManager.getEntries().filter((entry) => entry.type === "compaction"),
        ).toHaveLength(0);
        await original.prompt("User recovers");
        expect(JSON.stringify(original.messages)).toContain("User recovered");
      }
    },
  );

  it("does not resume ordinary native manual compaction and preserves its already-compacted outcome", async () => {
    const fixture = await contextRuntime({
      extensions: ["extensions/compact/index.ts", "extensions/handoff/index.ts"],
    });
    cleanups.push(() => fixture.dispose());
    let extra = 0;
    fixture.faux.setResponses([
      fauxAssistantMessage("Old work ".repeat(300)),
      fauxAssistantMessage("Native manual summary"),
      () => {
        extra++;
        return fauxAssistantMessage("Unexpected");
      },
    ]);
    await fixture.runtime.session.prompt("Old background");
    await fixture.runtime.session.compact("Native manual focus");
    await expect(fixture.runtime.session.compact()).rejects.toThrow("Already compacted");
    expect(extra).toBe(0);
    expect(
      fixture.runtime.session.messages.some(
        (message) => "customType" in message && message.customType === "session-guided-compaction",
      ),
    ).toBe(false);
  });
});

describe("late native cancellation at the completion boundary", () => {
  it.each(["abort", "replacement"] as const)(
    "does not auto-resume after %s during session_compact",
    async (action) => {
      let intervened = false;
      let intervene = () => {};
      let replacement: Promise<unknown> | undefined;
      const fixture = await contextRuntime({
        extensions: ["extensions/compact/index.ts"],
        factory(pi) {
          pi.on("session_compact", () => {
            intervene();
          });
        },
      });
      try {
        let extra = 0;
        fixture.faux.setResponses([
          fauxAssistantMessage("Old work ".repeat(300)),
          fauxAssistantMessage(fauxToolCall("compact_session", { instructions: "Preserve work" }), {
            stopReason: "toolUse",
          }),
          fauxAssistantMessage("Native summary"),
          () => {
            extra++;
            return fauxAssistantMessage("Unwanted automatic continuation");
          },
        ]);
        intervene = () => {
          intervened = true;
          if (action === "abort") fixture.runtime.session.abortCompaction();
          else replacement = fixture.runtime.newSession();
        };
        await fixture.runtime.session.prompt("Old background");
        await fixture.runtime.session.prompt("Checkpoint");
        await vi.waitFor(() => expect(intervened).toBe(true));
        await vi.waitFor(() => expect(fixture.runtime.session.isCompacting).toBe(false));
        await replacement;
        await fixture.runtime.session.waitForIdle();
        expect(extra).toBe(0);
        if (action === "replacement") expect(fixture.runtime.session.messages).toEqual([]);
      } finally {
        await fixture.dispose();
      }
    },
  );
});

describe("active-tool pressure advertisement through the real loader", () => {
  it("does not advertise or force-enable inactive context operations", async () => {
    const fixture = await contextRuntime({
      extensions: [
        "extensions/context-usage/index.ts",
        "extensions/compact/index.ts",
        "extensions/handoff/index.ts",
      ],
    });
    try {
      expect(fixture.runtime.session.getActiveToolNames()).toEqual(
        expect.arrayContaining(["compact_session", "handoff_session"]),
      );
      fixture.runtime.session.setActiveToolsByName(["read"]);
      let request = "";
      fixture.faux.setResponses([
        (context) => {
          request = JSON.stringify(context);
          return fauxAssistantMessage("Ordinary work");
        },
      ]);
      await fixture.runtime.session.prompt("Work with the restricted tool set");
      expect(request).not.toContain("compact_session");
      expect(request).not.toContain("handoff_session");
      expect(request).toContain("No context-management tool is active");
      expect(fixture.runtime.session.getActiveToolNames()).toEqual(["read"]);
    } finally {
      await fixture.dispose();
    }
  });
});

describe("native queued input during compaction", () => {
  it("resumes a dormant steering queue rather than mistaking it for an active continuation", async () => {
    const fixture = await contextRuntime({ extensions: ["extensions/compact/index.ts"] });
    try {
      let resumed = "";
      fixture.faux.setResponses([
        fauxAssistantMessage("Old work ".repeat(300)),
        fauxAssistantMessage(fauxToolCall("compact_session", { instructions: "Preserve work" }), {
          stopReason: "toolUse",
        }),
        async () => {
          await fixture.runtime.session.steer("Genuine queued user instruction");
          return fauxAssistantMessage("Native summary");
        },
        (context) => {
          resumed = JSON.stringify(context);
          return fauxAssistantMessage("Queued instruction handled");
        },
      ]);
      await fixture.runtime.session.prompt("Old background");
      await fixture.runtime.session.prompt("Checkpoint");
      await vi.waitFor(() =>
        expect(
          fixture.runtime.session.messages.some(
            (message) =>
              "customType" in message && message.customType === "session-guided-compaction",
          ),
        ).toBe(true),
      );
      await fixture.runtime.session.waitForIdle();
      expect(resumed).toContain("Genuine queued user instruction");
      expect(fixture.runtime.session.pendingMessageCount).toBe(0);
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });
});
