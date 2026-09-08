import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const packagePath = process.env.PI_TOOLS_SUBAGENTS_PACKAGE;
const root = resolve(import.meta.dirname, "..");

// Opt-in cross-package proof: real CLI, unmodified pi-subagents, detached runner,
// two sequential child sessions, and a deterministic local OpenAI SSE provider.
// No dependency imports, private-state probes, external credentials, or mocks of
// subagent lifecycle/ownership/delivery. The fake provider controls only timing
// and model responses; it is not evidence of real-model summary quality.
describe.skipIf(!packagePath)("live pi-subagents guided compaction", () => {
  it("keeps a live sequential workflow and delivers its result to the same usable parent once", async () => {
    const isolated = mkdtempSync(join(tmpdir(), "pi-tools-live-"));
    const config = join(isolated, "config");
    const sessions = join(isolated, "sessions");
    for (const directory of [config, sessions, join(config, "agents")])
      mkdirSync(directory, { recursive: true });
    const steps: string[] = [];
    const events: Array<Record<string, unknown>> = [];
    const providerErrors: string[] = [];
    let stderr = "";
    let phase = "history";
    let parentWakes = 0;
    let resultTurns = 0;
    let controlTurns = 0;
    let controlRequested = false;
    let releaseHistory = () => {};
    const historyGate = new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    let releaseChild = () => {};
    const childGate = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    let childStarted = () => {};
    const childStart = new Promise<void>((resolve) => {
      childStarted = resolve;
    });
    const sse = (
      response: ServerResponse,
      text: string,
      tool?: { name: string; args: unknown },
    ) => {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const delta = tool
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call-${phase}`,
                type: "function",
                function: { name: tool.name, arguments: JSON.stringify(tool.args) },
              },
            ],
          }
        : { role: "assistant", content: text };
      const chunk = (delta: unknown, finish_reason: string | null) => ({
        id: "fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: "deterministic",
        choices: [{ index: 0, delta, finish_reason }],
      });
      response.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
      response.write(
        `data: ${JSON.stringify({ ...chunk({}, tool ? "tool_calls" : "stop"), usage: { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010 } })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    };
    const server = createServer(async (request, response) => {
      try {
        let body = "";
        for await (const chunk of request) body += chunk;
        const payload = JSON.parse(body) as { messages: Array<{ role: string; content: unknown }> };
        const system = JSON.stringify(
          payload.messages.filter((message) => ["system", "developer"].includes(message.role)),
        );
        const content = JSON.stringify(payload.messages);
        if (system.includes("LIVE_CHILD_FIXTURE")) {
          if (content.includes("LIVE_STEP_TWO")) {
            steps.push("two");
            sse(response, "LIVE_WORKFLOW_RESULT: step two used step one");
          } else {
            steps.push("one-start");
            childStarted();
            await childGate;
            steps.push("one-complete");
            sse(response, "LIVE_STEP_ONE_RESULT");
          }
        } else if (system.includes("context summarization assistant")) {
          steps.push("native-summary");
          sse(
            response,
            "## Goal\nPreserve the live workflow.\n## Next Steps\nReceive LIVE_WORKFLOW_RESULT in this same parent.",
          );
        } else if (phase === "history") {
          phase = "launch";
          await historyGate;
          sse(response, "Earlier important work. ".repeat(400));
        } else if (phase === "launch") {
          phase = "compact";
          sse(response, "", {
            name: "subagent",
            args: {
              workflowScript:
                'const first = await runs.run("one", { agent: "live-fixture", task: "LIVE_STEP_ONE", acceptance: false }); return (await runs.run("two", { agent: "live-fixture", task: "LIVE_STEP_TWO using " + first.output, acceptance: false })).output;',
              async: true,
              context: "fresh",
              mission: false,
              acceptance: false,
              agentScope: "user",
              timeoutMs: 30_000,
            },
          });
        } else if (phase === "compact") {
          await childStart;
          phase = "wake";
          sse(response, "", {
            name: "compact_session",
            args: {
              instructions:
                "Preserve the live two-step workflow and receive its final result in this same parent.",
            },
          });
        } else if (phase === "wake") {
          parentWakes++;
          phase = "result";
          sse(response, "Parent resumed after compaction; still awaiting child work.");
          releaseChild();
        } else if (content.includes("LIVE_CONTROL_CHECK")) {
          if (!controlRequested) {
            controlRequested = true;
            sse(response, "", { name: "subagent", args: { action: "status", view: "fleet" } });
          } else {
            controlTurns++;
            sse(response, "LIVE_CONTROL_OK");
          }
        } else {
          resultTurns++;
          sse(response, "LIVE_PARENT_RECEIVED_RESULT");
        }
      } catch (error) {
        providerErrors.push(String(error));
        response.writeHead(500);
        response.end(String(error));
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local provider port");
    writeFileSync(
      join(config, "models.json"),
      JSON.stringify({
        providers: {
          "context-live": {
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            api: "openai-completions",
            apiKey: "fixture-only",
            models: [
              { id: "deterministic", contextWindow: 100_000, maxTokens: 4000, reasoning: false },
            ],
          },
        },
      }),
    );
    writeFileSync(
      join(config, "settings.json"),
      JSON.stringify({
        packages: [root, packagePath],
        defaultProvider: "context-live",
        defaultModel: "deterministic",
        compaction: { enabled: false, keepRecentTokens: 100 },
        retry: { enabled: false },
        subagents: { defaultModel: "context-live/deterministic", disableBuiltins: true },
      }),
    );
    writeFileSync(
      join(config, "agents/live-fixture.md"),
      "---\nname: live-fixture\ndescription: Deterministic integration fixture\nmodel: context-live/deterministic\ntools: read\n---\nLIVE_CHILD_FIXTURE. Return the requested marker only. Do not use tools.\n",
    );
    const child = spawn(resolve(root, "node_modules/.bin/pi"), ["--mode", "rpc"], {
      cwd: isolated,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        HOME: isolated,
        TMPDIR: isolated,
        PI_CODING_AGENT_DIR: config,
        PI_CODING_AGENT_SESSION_DIR: sessions,
        PI_OFFLINE: "1",
        PI_SKIP_VERSION_CHECK: "1",
        NO_COLOR: "1",
      },
    });
    let buffer = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          events.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          providerErrors.push(`Non-JSON RPC output: ${line.slice(0, 300)}`);
        }
        newline = buffer.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    const send = (command: unknown) => child.stdin.write(`${JSON.stringify(command)}\n`);
    const response = (id: string) => events.find((event) => event.id === id);
    // RPC prompt responses acknowledge preflight, not completion. Wait for the
    // expected output and subsequent public settlement before submitting input.
    const settledAfter = (marker: string) => {
      const message = events.findIndex(
        (event) => event.type === "message_end" && JSON.stringify(event.message).includes(marker),
      );
      return (
        message >= 0 && events.slice(message + 1).some((event) => event.type === "agent_settled")
      );
    };
    try {
      send({ id: "before", type: "get_state" });
      await vi.waitFor(() => expect(response("before"), stderr).toBeDefined(), { timeout: 20_000 });
      send({ id: "history", type: "prompt", message: "PREHISTORY" });
      await vi.waitFor(() => expect(response("history"), stderr).toBeDefined(), {
        timeout: 15_000,
      });
      expect(response("history")).toMatchObject({ success: true });
      expect(settledAfter("Earlier important work.")).toBe(false);
      releaseHistory();
      await vi.waitFor(() => expect(settledAfter("Earlier important work.")).toBe(true));
      send({
        id: "launch",
        type: "prompt",
        message: `START_LIVE_WORKFLOW. ${"Current live work must survive. ".repeat(100)}`,
      });
      await vi.waitFor(() => expect(response("launch"), stderr).toBeDefined());
      expect(response("launch"), JSON.stringify(response("launch"))).toMatchObject({
        success: true,
      });
      await vi.waitFor(
        () =>
          expect(
            controlTurns + resultTurns,
            JSON.stringify({ steps, stderr, last: events.slice(-3) }),
          ).toBeGreaterThan(0),
        { timeout: 60_000 },
      );
      await vi.waitFor(() => expect(settledAfter("LIVE_PARENT_RECEIVED_RESULT")).toBe(true));
      send({ id: "after", type: "get_state" });
      send({ id: "messages", type: "get_messages" });
      await vi.waitFor(() => expect(response("messages")).toBeDefined());
      const before = response("before")?.data as { sessionFile: string; sessionId: string };
      const after = response("after")?.data as { sessionFile: string; sessionId: string };
      expect(before.sessionFile).toEqual(expect.any(String));
      expect(before.sessionId).toEqual(expect.any(String));
      expect(after.sessionFile).toBe(before.sessionFile);
      expect(after.sessionId).toBe(before.sessionId);
      // Native mixed split-turn compaction may make both history and prefix requests.
      expect(steps.filter((step) => step !== "native-summary")).toEqual([
        "one-start",
        "one-complete",
        "two",
      ]);
      expect(steps.indexOf("native-summary")).toBeGreaterThan(steps.indexOf("one-start"));
      expect(steps.lastIndexOf("native-summary")).toBeLessThan(steps.indexOf("one-complete"));
      expect(events.filter((event) => event.type === "compaction_start")).toHaveLength(1);
      expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(1);
      expect(parentWakes).toBe(1);
      expect(resultTurns).toBe(1);
      const messageData = response("messages")?.data as
        | {
            messages: Array<{ role: string; customType?: string; content: unknown }>;
          }
        | undefined;
      if (!messageData) throw new Error("Missing RPC message snapshot");
      const messages = messageData.messages;
      const finalResults = messages.filter(
        (message) =>
          message.role === "custom" &&
          JSON.stringify(message.content).includes("LIVE_WORKFLOW_RESULT") &&
          message.customType !== "session-guided-compaction",
      );
      expect(finalResults).toHaveLength(1);
      send({ id: "control", type: "prompt", message: "LIVE_CONTROL_CHECK" });
      await vi.waitFor(() => expect(response("control")).toBeDefined());
      expect(response("control")).toMatchObject({ success: true });
      await vi.waitFor(() => expect(settledAfter("LIVE_CONTROL_OK")).toBe(true));
      expect(controlTurns).toBe(1);
      expect(parentWakes).toBe(1);
      expect(resultTurns).toBe(1);
      const subagentResults = events.filter(
        (event) => event.type === "tool_execution_end" && event.toolName === "subagent",
      );
      expect(subagentResults).toHaveLength(2);
      expect(subagentResults.every((event) => !event.isError)).toBe(true);
      expect(providerErrors).toEqual([]);
      expect(stderr).not.toMatch(/Failed to load extension/);
      const piVersion = JSON.parse(
        readFileSync(
          resolve(root, "node_modules/@earendil-works/pi-coding-agent/package.json"),
          "utf8",
        ),
      ).version;
      const subagentsVersion = JSON.parse(
        readFileSync(resolve(packagePath ?? "", "package.json"), "utf8"),
      ).version;
      console.info(
        `Live integration passed: Pi ${piVersion}; pi-subagents ${subagentsVersion}; sequential detached workflow, native compact, same parent, one final delivery.`,
      );
    } finally {
      releaseHistory();
      releaseChild();
      child.kill("SIGTERM");
      if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(isolated, { recursive: true, force: true });
    }
  }, 100_000);
});
