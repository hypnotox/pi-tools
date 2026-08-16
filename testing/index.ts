import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionFactory,
  ExtensionUIContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";

type Handler = (event: never, context: ExtensionContext) => unknown;
type Command = { handler(args: string, context: ExtensionCommandContext): Promise<void> };
type ApiCall = { name: string; args: unknown[] };

/** A deliberately small recording of documented Pi extension seams, not a Pi runtime. */
export interface ExtensionHarness {
  /** Resolves when an asynchronous extension factory has finished registering. */
  ready: Promise<void>;
  handlers: Map<string, Handler[]>;
  tools: ToolDefinition[];
  commands: Map<string, Command>;
  entryRenderers: Map<string, { renderer: unknown; options: unknown }>;
  queuedCommands: Array<[string, string | undefined]>;
  apiCalls: ApiCall[];
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

function createInertUi(): ExtensionUIContext {
  const plain = (text: string): string => text;
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: plain,
    italic: plain,
    underline: plain,
    inverse: plain,
    strikethrough: plain,
    getFgAnsi: () => "",
    getBgAnsi: () => "",
    getColorMode: () => "truecolor",
    getThinkingBorderColor: () => plain,
    getBashModeBorderColor: () => plain,
  } as unknown as ExtensionUIContext["theme"];
  return {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify: () => undefined,
    onTerminalInput: () => () => undefined,
    setStatus: () => undefined,
    setWorkingMessage: () => undefined,
    setWorkingVisible: () => undefined,
    setWorkingIndicator: () => undefined,
    setHiddenThinkingLabel: () => undefined,
    setWidget: () => undefined,
    setFooter: () => undefined,
    setHeader: () => undefined,
    setTitle: () => undefined,
    custom: async <T>() => undefined as T,
    pasteToEditor: () => undefined,
    setEditorText: () => undefined,
    getEditorText: () => "",
    editor: async () => undefined,
    addAutocompleteProvider: () => undefined,
    setEditorComponent: () => undefined,
    getEditorComponent: () => undefined,
    theme,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: true }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => undefined,
  };
}

function createInertModelRegistry(): ExtensionContext["modelRegistry"] {
  return {
    refresh: async () => ({}),
    getError: () => undefined,
    getAll: () => [],
    getAvailable: () => [],
    find: () => undefined,
    hasConfiguredAuth: () => false,
    getApiKeyAndHeaders: async () => ({ ok: false, error: "Inert testing model registry" }),
    getProviderAuthStatus: () => ({ status: "not_authenticated" }),
    getProvider: () => undefined,
    complete: async () => ({}),
    getProviderDisplayName: (provider: string) => provider,
    getProviderAuth: async () => undefined,
    getApiKeyForProvider: async () => undefined,
    isUsingOAuth: () => false,
    registerProvider: () => undefined,
    unregisterProvider: () => undefined,
    getRegisteredProviderConfig: () => undefined,
    getRegisteredNativeProvider: () => undefined,
    getRegisteredProviderIds: () => [],
  } as unknown as ExtensionContext["modelRegistry"];
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
  const apiCalls: ApiCall[] = [];
  const appendEntries: Array<[string, unknown]> = [];
  const activeTools: string[] = [];
  const allTools: Array<{ name: string }> = [];
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const record = (name: string, args: unknown[]): void => {
    apiCalls.push({ name, args });
  };
  const api = {
    on(event: string, handler: Handler) {
      record("on", [event, handler]);
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(tool: ToolDefinition) {
      record("registerTool", [tool]);
      tools.push(tool);
      allTools.push({ name: tool.name });
    },
    registerCommand(name: string, command: Command) {
      record("registerCommand", [name, command]);
      commands.set(name, command);
    },
    registerEntryRenderer(type: string, renderer: unknown, options?: unknown) {
      record("registerEntryRenderer", [type, renderer, options]);
      entryRenderers.set(type, { renderer, options });
    },
    appendEntry(type: string, data?: unknown) {
      record("appendEntry", [type, data]);
      appendEntries.push([type, data]);
    },
    getActiveTools() {
      record("getActiveTools", []);
      return [...activeTools];
    },
    getAllTools() {
      record("getAllTools", []);
      return [...allTools];
    },
    setActiveTools(names: string[]) {
      record("setActiveTools", [names]);
      activeTools.splice(0, activeTools.length, ...names);
    },
    queueCommand(name: string, args?: string) {
      record("queueCommand", [name, args]);
      queuedCommands.push([name, args]);
    },
    events: {
      on(event: string, listener: (value: unknown) => void) {
        record("events.on", [event, listener]);
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
        return () => {
          set.delete(listener);
        };
      },
      emit(event: string, value?: unknown) {
        record("events.emit", [event, value]);
        for (const listener of listeners.get(event) ?? []) listener(value);
      },
    },
  };
  const makeContext = (overrides: Partial<ExtensionContext> = {}): ExtensionContext => ({
    mode: "tui",
    hasUI: true,
    cwd: process.cwd(),
    ui: createInertUi(),
    sessionManager: SessionManager.inMemory(process.cwd()),
    modelRegistry: createInertModelRegistry(),
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
  });
  const makeCommandContext = (
    overrides: Partial<ExtensionCommandContext> = {},
  ): ExtensionCommandContext => {
    const replacement = (sessionManager = SessionManager.inMemory(process.cwd())) =>
      ({
        ...makeCommandContext({ sessionManager }),
        sendMessage: async () => undefined,
        sendUserMessage: async () => undefined,
      }) as ExtensionCommandContext & {
        sendMessage(...args: unknown[]): Promise<void>;
        sendUserMessage(...args: unknown[]): Promise<void>;
      };
    return {
      ...makeContext(),
      getSystemPromptOptions: () => ({ cwd: process.cwd() }),
      waitForIdle: async () => undefined,
      newSession: async (request) => {
        const sessionManager = SessionManager.inMemory(process.cwd());
        await request?.setup?.(sessionManager);
        await request?.withSession?.(replacement(sessionManager));
        return { cancelled: false };
      },
      fork: async (_entryId, request) => {
        await request?.withSession?.(replacement());
        return { cancelled: false };
      },
      navigateTree: async () => ({ cancelled: false }),
      switchSession: async (_path, request) => {
        await request?.withSession?.(replacement());
        return { cancelled: false };
      },
      reload: async () => undefined,
      ...overrides,
    };
  };
  const omitted = new Set(options.omit ?? []);
  for (const key of omitted) delete (api as Record<string, unknown>)[key];
  // This is the sole partial-recorder to complete-ExtensionAPI translation point.
  const ready = Promise.resolve(factory(api as unknown as ExtensionAPI));
  void ready.catch(() => undefined);
  return {
    ready,
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
      await ready;
      const results = [];
      for (const handler of handlers.get(event) ?? [])
        results.push(await handler(payload as never, context));
      return results;
    },
    async invokeToolDirect(name, params, invokeOptions = {}) {
      await ready;
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`No registered tool named ${name}`);
      return tool.execute(
        invokeOptions.id ?? "tool-call",
        params as never,
        invokeOptions.signal,
        invokeOptions.onUpdate as never,
        invokeOptions.context ?? makeContext(),
      );
    },
  };
}
