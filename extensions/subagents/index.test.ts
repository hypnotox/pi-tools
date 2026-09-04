import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createExtensionHarness, createTestBus } from "../../tests/extension-harness.js";
import { registerSubagents } from "./index.js";
import { CHILD_MARKER, type RunRequest } from "./runner.js";

const inheritedChildMarker = process.env[CHILD_MARKER];

const usage = {
  input: 1,
  output: 2,
  cacheRead: 3,
  cacheWrite: 4,
  totalTokens: 10,
  cost: { input: 0.1, output: 0.2, cacheRead: 0.1, cacheWrite: 0.1, total: 0.5 },
};

function context() {
  return {
    cwd: "/project",
    model: { provider: "provider", id: "model" },
    thinkingLevel: "high",
    isProjectTrusted: () => true,
  };
}

function role() {
  return {
    toolName: "subagent_explore",
    description: "Investigate one bounded question with a self-contained brief.",
    loadSystemPrompt: vi.fn(async () => "# Explorer"),
  };
}

beforeEach(() => {
  delete process.env[CHILD_MARKER];
});

afterAll(() => {
  if (inheritedChildMarker === undefined) delete process.env[CHILD_MARKER];
  else process.env[CHILD_MARKER] = inheritedChildMarker;
});

describe("subagent extension", () => {
  it("registers the direct generic task-only tool", () => {
    const harness = createExtensionHarness({ activeTools: ["read"] });
    registerSubagents(harness.api, { runner: { run: vi.fn(), shutdown: vi.fn() } });

    expect(harness.tools.map((tool) => tool.name)).toEqual(["subagent"]);
    expect(harness.tools[0]?.parameters.required).toEqual(["task"]);
    expect(Object.keys(harness.tools[0]?.parameters.properties ?? {})).toEqual(["task"]);
    expect(harness.tools[0]).not.toHaveProperty("renderCall");
    expect(harness.tools[0]).not.toHaveProperty("renderResult");
  });

  it.each(["roles before pi-tools", "pi-tools before roles"])(
    "registers roles once with %s",
    (order) => {
      const bus = createTestBus();
      const harness = createExtensionHarness({ activeTools: ["read"], bus });
      const published = [role()];
      const installProducer = () => {
        bus.on("agentic-skills:roles:request", () => bus.emit("agentic-skills:roles", published));
        bus.emit("agentic-skills:roles", published);
      };
      const installTools = () =>
        registerSubagents(harness.api, { runner: { run: vi.fn(), shutdown: vi.fn() } });

      if (order === "roles before pi-tools") {
        installProducer();
        installTools();
      } else {
        installTools();
        installProducer();
      }
      bus.emit("agentic-skills:roles", published);

      expect(harness.tools.map((tool) => tool.name)).toEqual(["subagent", "subagent_explore"]);
      expect(harness.tools[1]?.label).toBe("Subagent Explore");
      expect(harness.tools[1]?.description).toContain("self-contained brief");
    },
  );

  it("inherits parent execution settings and removes delegation and handoff tools", async () => {
    const requests: RunRequest[] = [];
    const harness = createExtensionHarness({
      activeTools: ["read", "subagent", "subagent_explore", "handoff_session"],
    });
    registerSubagents(harness.api, {
      runner: {
        async run(request) {
          requests.push(request);
          return { state: "completed", report: "done", usage };
        },
        shutdown: vi.fn(),
      },
    });
    const publishedRole = role();
    harness.bus.emit("agentic-skills:roles", [publishedRole]);

    const result = await harness.execute("subagent_explore", { task: "find the owner" }, context());

    expect(publishedRole.loadSystemPrompt).toHaveBeenCalledOnce();
    expect(requests).toEqual([
      {
        cwd: "/project",
        task: "find the owner",
        systemPrompt: "# Explorer",
        model: { provider: "provider", id: "model" },
        thinkingLevel: "high",
        tools: ["read"],
        approved: true,
      },
    ]);
    expect(result).toEqual({
      content: [{ type: "text", text: "done" }],
      details: { state: "completed", usage },
      usage,
    });
  });

  it("uses Pi's default system prompt for the generic tool", async () => {
    const run = vi.fn(async (_request: RunRequest) => ({
      state: "completed" as const,
      report: "done",
      usage,
    }));
    const harness = createExtensionHarness({ activeTools: ["read"] });
    registerSubagents(harness.api, { runner: { run, shutdown: vi.fn() } });
    await harness.execute("subagent", { task: "inspect" }, context());
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty("systemPrompt");
  });

  it("returns early in marked children", () => {
    process.env[CHILD_MARKER] = "1";
    const harness = createExtensionHarness();
    registerSubagents(harness.api, { runner: { run: vi.fn(), shutdown: vi.fn() } });
    expect(harness.tools).toEqual([]);
    expect(harness.handlers.size).toBe(0);
    expect(harness.bus.emissions).toEqual([]);
  });

  it("marks failed child outcomes as failed tool results", async () => {
    const harness = createExtensionHarness();
    registerSubagents(harness.api, {
      runner: {
        run: vi.fn(async () => ({
          state: "failed" as const,
          report: "child failed",
          failure: "child failed",
          usage,
        })),
        shutdown: vi.fn(),
      },
    });
    const result = await harness.execute("subagent", { task: "inspect" }, context());
    expect(
      await harness.invoke("tool_result", { toolName: "subagent", ...result }, context()),
    ).toEqual([{ isError: true }]);
  });
});
