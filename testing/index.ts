import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionFactory,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

type Handler = (event: never, context: ExtensionContext) => unknown;
type Command = { handler(args: string, context: ExtensionCommandContext): Promise<void> };

/** A deliberately small recording of documented Pi extension seams, not a Pi runtime. */
export interface ExtensionHarness {
  handlers: Map<string, Handler[]>;
  tools: ToolDefinition[];
  commands: Map<string, Command>;
  entryRenderers: Map<string, { renderer: unknown; options: unknown }>;
  queuedCommands: Array<[string, string | undefined]>;
  apiCalls: Array<{ name: string; args: unknown[] }>;
  appendEntries: Array<[string, unknown]>;
  activeTools: string[];
  allTools: Array<{ name: string }>;
  api: {
    on(event: string, handler: Handler): void;
    registerTool(tool: ToolDefinition): void;
    registerCommand(name: string, command: Command): void;
    registerEntryRenderer(type: string, renderer: unknown, options?: unknown): void;
    appendEntry(type: string, data?: unknown): void;
    getActiveTools(): string[];
    getAllTools(): Array<{ name: string }>;
    setActiveTools(names: string[]): void;
    queueCommand(name: string, args?: string): void;
    events: {
      on(event: string, listener: (value: unknown) => void): () => void;
      emit(event: string, value?: unknown): void;
    };
  };
  makeContext(overrides?: Partial<ExtensionContext>): ExtensionContext;
  makeCommandContext(overrides?: Partial<ExtensionCommandContext>): ExtensionCommandContext;
  /** Invokes handlers in registration order without Pi middleware or error conversion. */
  invokeRaw(event: string, payload?: unknown, context?: ExtensionContext): Promise<unknown[]>;
  /** Invokes a registered tool with Pi's five arguments directly; thrown errors remain thrown. */
  invokeToolDirect(
    name: string,
    params: unknown,
    options?: {
      id?: string;
      signal?: AbortSignal;
      onUpdate?: (value: unknown) => void;
      context?: ExtensionContext;
    },
  ): Promise<unknown>;
}

export function createExtensionHarness(
  factory: ExtensionFactory,
  options: { omit?: string[] } = {},
): ExtensionHarness {
  const handlers = new Map<string, Handler[]>();
  const tools: ToolDefinition[] = [];
  const commands = new Map<string, Command>();
  const entryRenderers = new Map<string, { renderer: unknown; options: unknown }>();
  const queuedCommands: Array<[string, string | undefined]> = [];
  const apiCalls: Array<{ name: string; args: unknown[] }> = [];
  const appendEntries: Array<[string, unknown]> = [];
  const activeTools: string[] = [];
  const allTools: Array<{ name: string }> = [];
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const api = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(tool: ToolDefinition) {
      tools.push(tool);
      allTools.push({ name: tool.name });
    },
    registerCommand(name: string, command: Command) {
      commands.set(name, command);
    },
    registerEntryRenderer(type: string, renderer: unknown, options?: unknown) {
      entryRenderers.set(type, { renderer, options });
    },
    appendEntry(type: string, data?: unknown) {
      appendEntries.push([type, data]);
    },
    getActiveTools() {
      return [...activeTools];
    },
    getAllTools() {
      return [...allTools];
    },
    setActiveTools(names: string[]) {
      activeTools.splice(0, activeTools.length, ...names);
    },
    queueCommand(name: string, args?: string) {
      queuedCommands.push([name, args]);
    },
    events: {
      on(event: string, listener: (value: unknown) => void) {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
        return () => set.delete(listener);
      },
      emit(event: string, value?: unknown) {
        for (const listener of listeners.get(event) ?? []) listener(value);
      },
    },
  };
  const makeContext = (overrides: Partial<ExtensionContext> = {}): ExtensionContext =>
    ({
      mode: "tui",
      hasUI: true,
      cwd: process.cwd(),
      ui: {},
      sessionManager: { getSessionFile: () => "session.jsonl", getLeafEntry: () => undefined },
      modelRegistry: {},
      model: undefined,
      scopedModels: [],
      isIdle: () => true,
      isProjectTrusted: () => true,
      signal: undefined,
      abort: () => undefined,
      hasPendingMessages: () => false,
      shutdown: () => undefined,
      getContextUsage: () => undefined,
      compact: () => undefined,
      getSystemPrompt: () => "",
      ...overrides,
    }) as ExtensionContext;
  const makeCommandContext = (
    overrides: Partial<ExtensionCommandContext> = {},
  ): ExtensionCommandContext => {
    const context = makeContext();
    return {
      ...context,
      getSystemPromptOptions: () => ({}),
      waitForIdle: async () => undefined,
      newSession: async (request) => {
        const replacement = makeCommandContext();
        await request?.withSession?.(replacement as never);
        return { cancelled: false };
      },
      fork: async () => ({ cancelled: false }),
      navigateTree: async () => ({ cancelled: false }),
      switchSession: async () => ({ cancelled: false }),
      reload: async () => undefined,
      ...overrides,
    } as ExtensionCommandContext;
  };
  const omitted = new Set(options.omit ?? []);
  for (const key of omitted) delete (api as Record<string, unknown>)[key];
  // This is the sole partial-recorder to complete-ExtensionAPI translation point.
  factory(api as unknown as ExtensionAPI);
  return {
    handlers,
    tools,
    commands,
    entryRenderers,
    queuedCommands,
    apiCalls,
    appendEntries,
    activeTools,
    allTools,
    api,
    makeContext,
    makeCommandContext,
    async invokeRaw(event, payload = {}, context = makeContext()) {
      const results = [];
      for (const handler of handlers.get(event) ?? [])
        results.push(await handler(payload as never, context));
      return results;
    },
    async invokeToolDirect(name, params, options = {}) {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`No registered tool named ${name}`);
      return tool.execute(
        options.id ?? "tool-call",
        params as never,
        options.signal,
        options.onUpdate as never,
        options.context ?? makeContext(),
      );
    },
  };
}
