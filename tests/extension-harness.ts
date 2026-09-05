import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface TestBus {
  on(name: string, listener: (value: unknown) => void): () => void;
  emit(name: string, value?: unknown): void;
}

function createTestBus(): TestBus {
  const listeners = new Map<string, Array<(value: unknown) => void>>();
  return {
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
      for (const listener of [...(listeners.get(name) ?? [])]) listener(value);
    },
  };
}

type TestHandler = (event: unknown, context: unknown) => unknown | Promise<unknown>;

interface TestTool {
  name: string;
  execute(...args: unknown[]): Promise<Record<string, unknown>>;
}

interface TestCommand {
  handler(...args: unknown[]): unknown;
}

export function createExtensionHarness() {
  const handlers = new Map<string, TestHandler[]>();
  const tools: TestTool[] = [];
  const commands = new Map<string, TestCommand>();
  const entryRenderers = new Map<string, { renderer: unknown; options: unknown }>();
  const appendEntries: Array<[string, unknown]> = [];
  const sentUserMessages: Array<[unknown, unknown]> = [];
  const bus = createTestBus();
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
    getAllTools: () => tools.map((tool) => ({ name: tool.name })),
    sendUserMessage(content: unknown, options?: unknown) {
      sentUserMessages.push([content, options]);
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
    sentUserMessages,
    bus,
    invoke,
    execute,
  };
}
