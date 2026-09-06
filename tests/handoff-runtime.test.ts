import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createProvider } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import {
  type AgentSession,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type ExtensionAPI,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = resolve(import.meta.dirname, "..");
const extensionPaths = [
  resolve(root, "extensions/timing/index.ts"),
  resolve(root, "extensions/handoff/index.ts"),
];
function messageText(message: AgentSession["messages"][number]): string {
  if (!("content" in message)) return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

describe("handoff on the real Pi AgentSession runtime", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  it.each([
    { mode: "tui", intervention: "none", collision: "none" },
    { mode: "rpc", intervention: "none", collision: "none" },
    { mode: "tui", intervention: "cancelled-switch", collision: "none" },
    { mode: "rpc", intervention: "cancelled-switch", collision: "none" },
    { mode: "tui", intervention: "replacement", collision: "none" },
    { mode: "rpc", intervention: "replacement", collision: "none" },
    { mode: "tui", intervention: "none", collision: "before" },
    { mode: "tui", intervention: "none", collision: "after" },
  ] as const)(
    "settles a persisted $mode handoff with $intervention intervention and $collision collision",
    async ({ mode, intervention, collision }) => {
      const tempDir = mkdtempSync(join(tmpdir(), `pi-tools-handoff-${mode}-`));
      const collisionExtensionPath = join(tempDir, "handoff-command-collision.ts");
      writeFileSync(
        collisionExtensionPath,
        'export default function (pi) { pi.registerCommand("handoff-session-continue", { description: "Test-only collision", async handler() {} }); }\n',
      );
      const runtimeExtensionPaths =
        collision === "before"
          ? [collisionExtensionPath, ...extensionPaths]
          : collision === "after"
            ? [...extensionPaths, collisionExtensionPath]
            : extensionPaths;
      const sessions = join(tempDir, "sessions");
      mkdirSync(sessions);
      cleanups.push(() => rmSync(tempDir, { recursive: true, force: true }));
      const faux = createFauxCore({
        provider: `pi-tools-faux-${mode}`,
        models: [
          { id: "replacement-default", reasoning: true, contextWindow: 100_000 },
          { id: "preserved", reasoning: true, contextWindow: 100_000 },
        ],
      });
      const fauxProvider = createProvider({
        id: faux.provider,
        auth: {
          apiKey: {
            name: "pi-tools test",
            resolve: async ({ credential }) =>
              credential?.key
                ? { auth: { apiKey: credential.key }, source: "test fixture" }
                : undefined,
          },
        },
        models: faux.models,
        api: { stream: faux.stream, streamSimple: faux.streamSimple },
      });
      const defaultModel = faux.getModel("replacement-default");
      const preservedModel = faux.getModel("preserved");
      if (!defaultModel || !preservedModel) throw new Error("Missing faux models");

      const kickoff = "Continue from the deterministic upstream runtime test.";
      const providerContexts: unknown[][] = [];
      faux.setResponses([
        (context) => {
          providerContexts.push([...context.messages]);
          const response = fauxAssistantMessage(fauxToolCall("handoff_session", { kickoff }), {
            stopReason: "toolUse",
          });
          response.usage.input = 90_000;
          response.usage.totalTokens = 90_000;
          return response;
        },
        (context) => {
          providerContexts.push([...context.messages]);
          return fauxAssistantMessage("replacement complete");
        },
      ]);

      const lifecycle: string[] = [];
      const diagnostics: unknown[] = [];
      let releaseTool = () => {};
      const toolGate = new Promise<void>((resolve) => {
        releaseTool = resolve;
      });
      cleanups.push(releaseTool);
      let handoffReady = false;
      let cancelNextSwitch = intervention === "cancelled-switch";
      let runtimeGeneration = 0;
      const createRuntime: CreateAgentSessionRuntimeFactory = async ({
        cwd,
        sessionManager,
        sessionStartEvent,
      }) => {
        const generation = ++runtimeGeneration;
        const services = await createAgentSessionServices({
          cwd,
          agentDir: tempDir,
          resourceLoaderOptions: {
            additionalExtensionPaths: runtimeExtensionPaths,
            extensionFactories: [
              (pi: ExtensionAPI) => {
                pi.registerProvider(fauxProvider);
                pi.on("tool_result", async (event) => {
                  if (generation === 1 && event.toolName === "handoff_session") {
                    handoffReady = true;
                    await toolGate;
                  }
                });
                pi.on("session_before_switch", () => {
                  if (generation === 1 && cancelNextSwitch) {
                    cancelNextSwitch = false;
                    return { cancel: true };
                  }
                });
                pi.on("agent_settled", () => {
                  lifecycle.push(`settled:${generation}`);
                });
                pi.on("session_shutdown", () => {
                  lifecycle.push(`shutdown:${generation}`);
                });
                pi.on("session_start", () => {
                  lifecycle.push(`start:${generation}`);
                });
              },
            ],
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
          },
        });
        // Native provider registration refreshes auth asynchronously. Use the SDK's
        // credential synchronization boundary before testing model restoration.
        await services.modelRuntime.setRuntimeApiKey(faux.provider, "faux-key");
        expect(services.modelRuntime.hasConfiguredAuth(faux.provider)).toBe(true);
        return {
          ...(await createAgentSessionFromServices({
            services,
            sessionManager,
            ...(sessionStartEvent ? { sessionStartEvent } : {}),
            model: generation === 1 ? preservedModel : defaultModel,
            thinkingLevel: generation === 1 ? "high" : "low",
          })),
          services,
          diagnostics: services.diagnostics,
        };
      };

      const runtime = await createAgentSessionRuntime(createRuntime, {
        cwd: tempDir,
        agentDir: tempDir,
        sessionManager: SessionManager.create(tempDir, sessions),
      });
      cleanups.push(async () => {
        releaseTool();
        await runtime.dispose();
      });
      const parentSession = runtime.session.sessionFile;
      if (!parentSession) throw new Error("Missing persisted parent session");

      const rebind = async (): Promise<void> => {
        const session = runtime.session;
        await session.bindExtensions({
          mode,
          onError: (error) => diagnostics.push(error),
          uiContext: {
            ...session.extensionRunner.getUIContext(),
            notify: (...args) => {
              diagnostics.push(args);
            },
          },
          commandContextActions: {
            waitForIdle: () => session.waitForIdle(),
            newSession: (options) => runtime.newSession(options),
            fork: (entryId, options) => runtime.fork(entryId, options),
            navigateTree: (entryId, options) => session.navigateTree(entryId, options),
            switchSession: (path, options) => runtime.switchSession(path, options),
            reload: async () => session.reload(),
          },
        });
      };
      runtime.setRebindSession(rebind);
      await rebind();

      const loadedExtensions = runtime.services.resourceLoader.getExtensions();
      expect(loadedExtensions.errors).toEqual([]);
      expect(loadedExtensions.extensions.map((extension) => extension.resolvedPath)).toEqual(
        expect.arrayContaining(runtimeExtensionPaths),
      );
      const runtimeEvents: unknown[] = [];
      runtime.session.subscribe((event) => runtimeEvents.push(event));
      const prompt = runtime.session.prompt("old conversation");
      await vi.waitFor(() => expect(handoffReady).toBe(true));
      const originatingRun = runtime.session.agent.signal;
      expect(originatingRun).toBeDefined();
      expect(runtime.session.sessionFile).toBe(parentSession);
      expect(lifecycle).toEqual(["start:1"]);

      if (intervention === "cancelled-switch") {
        expect(await runtime.newSession()).toEqual({ cancelled: true });
        expect(originatingRun?.aborted).toBe(false);
      }
      if (intervention === "replacement") {
        const replacement = runtime.newSession();
        await vi.waitFor(() => expect(originatingRun?.aborted).toBe(true));
        releaseTool();
        await prompt;
        await replacement;
        expect(lifecycle).toEqual(["start:1", "settled:1", "shutdown:1", "start:2"]);
        expect(runtime.session.sessionFile).not.toBe(parentSession);
        expect(runtime.session.messages).toEqual([]);
        expect(
          runtime.session.sessionManager
            .getEntries()
            .some(
              (entry) =>
                entry.type === "custom" && entry.customType === "pi-tools:handoff-continuity",
            ),
        ).toBe(false);
        expect(providerContexts).toHaveLength(1);
        expect(diagnostics).toEqual([]);
        return;
      }

      releaseTool();
      await prompt;
      await vi.waitFor(() =>
        expect(
          runtime.session.sessionFile,
          JSON.stringify({ lifecycle, runtimeEvents, messages: runtime.session.messages }, null, 2),
        ).not.toBe(parentSession),
      );
      await vi.waitFor(() => {
        expect(providerContexts).toHaveLength(2);
        expect(lifecycle).toContain("settled:2");
      });
      await runtime.session.waitForIdle();

      const replacementSession = runtime.session.sessionFile;
      expect(replacementSession).toBeDefined();
      expect(replacementSession).not.toBe(parentSession);
      expect(runtime.session.sessionManager.getHeader()?.parentSession).toBe(parentSession);
      expect(
        runtime.session.model?.id,
        JSON.stringify(
          {
            lifecycle,
            diagnostics,
            entries: runtime.session.sessionManager.getEntries(),
            providerContexts,
          },
          null,
          2,
        ),
      ).toBe("preserved");
      expect(diagnostics).toEqual([]);
      expect(runtime.session.thinkingLevel).toBe("high");
      expect(lifecycle).toEqual(["start:1", "settled:1", "shutdown:1", "start:2", "settled:2"]);

      expect(providerContexts).toHaveLength(2);
      const replacementContext = providerContexts[1] ?? [];
      const visibleText = replacementContext
        .map((message) => messageText(message as AgentSession["messages"][number]))
        .join("\n");
      expect(visibleText).toContain(kickoff);
      expect(visibleText).not.toContain("old conversation");
      expect(visibleText).not.toContain("handoff-session-continue");
      expect(runtime.session.messages.map(messageText)).toEqual([
        expect.stringContaining(kickoff),
        "replacement complete",
      ]);

      const replacementEntries = runtime.session.sessionManager.getEntries();
      const continuity = replacementEntries.find(
        (entry) => entry.type === "custom" && entry.customType === "pi-tools:handoff-continuity",
      );
      expect(continuity).toEqual(
        expect.objectContaining({
          type: "custom",
          data: expect.objectContaining({
            timing: expect.objectContaining({ turnCount: 1 }),
          }),
        }),
      );
      if (mode === "tui") {
        expect(
          replacementEntries.filter(
            (entry) => entry.type === "custom" && entry.customType === "pi-tools-timing",
          ),
        ).toEqual([
          expect.objectContaining({
            data: expect.objectContaining({
              kind: "tool-block",
              tools: [],
              turn: expect.objectContaining({ kind: "turn", label: "turn 2" }),
            }),
          }),
          expect.objectContaining({ data: expect.objectContaining({ kind: "agent" }) }),
        ]);
      }

      const parentEntries = SessionManager.open(parentSession).getEntries();
      const parentTimings = parentEntries.filter(
        (entry) => entry.type === "custom" && entry.customType === "pi-tools-timing",
      );
      expect(
        parentTimings.map((entry) => (entry.type === "custom" ? entry.data : undefined)),
      ).toEqual(
        mode === "tui"
          ? [
              expect.objectContaining({
                kind: "tool-block",
                tools: [expect.objectContaining({ kind: "tool", label: "handoff_session" })],
                turn: expect.objectContaining({ kind: "turn", label: "turn 1" }),
              }),
              expect.objectContaining({ kind: "agent" }),
            ]
          : [],
      );
      expect(parentEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "message",
            message: expect.objectContaining({ role: "toolResult", toolName: "handoff_session" }),
          }),
        ]),
      );
      expect(
        parentEntries.some(
          (entry) =>
            entry.type === "message" &&
            entry.message.role === "user" &&
            messageText(entry.message).includes("handoff-session-continue"),
        ),
      ).toBe(false);
      expect(
        runtimeEvents.some(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            "type" in event &&
            event.type === "compaction_start",
        ),
      ).toBe(false);
    },
  );
});
