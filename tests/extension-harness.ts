import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface TestBus {
  emissions: Array<[string, unknown]>;
  on(name: string, listener: (value: unknown) => void): () => void;
  emit(name: string, value?: unknown): void;
}

export function createTestBus(): TestBus {
  const listeners = new Map<string, Array<(value: unknown) => void>>();
  const emissions: Array<[string, unknown]> = [];
  return {
    emissions,
    on(name, listener) {
      const current = listeners.get(name) ?? [];
      current.push(listener);
      listeners.set(name, current);
      return () => {
        const index = current.indexOf(listener);
        if (index >= 0) current.splice(index, 1);
      };
    },
    emit(name, value) {
      emissions.push([name, value]);
      for (const listener of [...(listeners.get(name) ?? [])]) listener(value);
    },
  };
}

type TestHandler = (event: unknown, context: unknown) => unknown | Promise<unknown>;

interface TestTool {
  name: string;
  label: string;
  description: string;
  parameters: {
    required?: readonly string[];
    properties: Record<string, unknown>;
  };
  execute(...args: unknown[]): Promise<Record<string, unknown>>;
  renderCall?: unknown;
  renderResult?: unknown;
}

interface TestCommand {
  handler(...args: unknown[]): unknown;
}

export function createExtensionHarness(options: { activeTools?: string[]; bus?: TestBus } = {}) {
  const handlers = new Map<string, TestHandler[]>();
  const tools: TestTool[] = [];
  const commands = new Map<string, TestCommand>();
  const entryRenderers = new Map<string, { renderer: unknown; options: unknown }>();
  const appendEntries: Array<[string, unknown]> = [];
  const queuedCommands: Array<[string, string | undefined]> = [];
  const activeTools = [...(options.activeTools ?? [])];
  const bus = options.bus ?? createTestBus();
  const api = {
    on(name: string, handler: TestHandler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerTool(tool: unknown) {
      tools.push(tool as TestTool);
    },
    registerCommand(name: string, command: unknown) {
      commands.set(name, command as TestCommand);
    },
    registerEntryRenderer(type: string, renderer: unknown, rendererOptions?: unknown) {
      entryRenderers.set(type, { renderer, options: rendererOptions });
    },
    appendEntry(type: string, data?: unknown) {
      appendEntries.push([type, data]);
    },
    getActiveTools: () => [...activeTools],
    getAllTools: () => [
      ...activeTools.map((name) => ({ name })),
      ...tools.map((tool) => ({ name: tool.name })),
    ],
    setActiveTools(names: string[]) {
      activeTools.splice(0, activeTools.length, ...names);
    },
    queueCommand(name: string, args?: string) {
      queuedCommands.push([name, args]);
    },
    events: bus,
  } as unknown as ExtensionAPI;
  const invoke = async (name: string, event: unknown, context: unknown) => {
    const results = [];
    for (const handler of handlers.get(name) ?? []) results.push(await handler(event, context));
    return results;
  };
  const execute = async (
    name: string,
    params: unknown,
    context: unknown,
    signal?: AbortSignal,
    onUpdate?: (result: unknown) => void,
  ) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No registered tool named ${name}`);
    return tool.execute("call", params, signal, onUpdate, context);
  };
  return {
    api,
    handlers,
    tools,
    commands,
    entryRenderers,
    appendEntries,
    queuedCommands,
    activeTools,
    bus,
    invoke,
    execute,
  };
}
