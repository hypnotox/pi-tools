import type {
  ExecOptions,
  ExecResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionFactory,
  ExtensionUIContext,
  ToolDefinition,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";

type Handler = (event: never, context: ExtensionContext) => unknown;
type Command = { handler(args: string, context: ExtensionCommandContext): Promise<void> };
type ApiCall = { name: string; args: unknown[] };
type ExecBehavior = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

export interface RecordingUI {
  readonly calls: Array<{ name: "notify" | "select" | "confirm" | "input"; args: unknown[] }>;
  readonly ui: ExtensionUIContext;
  selectResponses: Array<string | undefined>;
  confirmResponses: boolean[];
  inputResponses: Array<string | undefined>;
}

export interface ModelRegistryFixture {
  registry: ExtensionContext["modelRegistry"];
  models: unknown[];
  available: unknown[];
  configuredAuth: boolean;
  add(model: unknown, available?: boolean): void;
  remove(provider: string, id: string): void;
}

export interface RecorderOptions {
  omit?: string[];
  additions?: Record<string, unknown>;
  exec?: ExecBehavior;
  ui?: RecordingUI;
  modelRegistry?: ModelRegistryFixture;
  allTools?: ToolInfo[];
  activeTools?: string[];
  /** Optional existing bus for compatibility tests; installed factories otherwise share this recorder's bus. */
  eventBus?: Map<string, unknown>;
}

/** A framework-neutral recording of selected documented Pi extension seams, not a Pi runtime. */
type RecorderApi = {
  on: ExtensionAPI["on"];
  registerTool: ExtensionAPI["registerTool"];
  registerCommand: ExtensionAPI["registerCommand"];
  registerEntryRenderer: ExtensionAPI["registerEntryRenderer"];
  appendEntry: ExtensionAPI["appendEntry"];
  getActiveTools: ExtensionAPI["getActiveTools"];
  getAllTools: ExtensionAPI["getAllTools"];
  setActiveTools: ExtensionAPI["setActiveTools"];
  queueCommand(name: string, args?: string): void;
  exec: ExtensionAPI["exec"];
  events: ExtensionAPI["events"];
} & Record<string, unknown>;

export interface ExtensionRecorder {
  readonly installations: Promise<void>[];
  readonly ready: Promise<void>;
  install(factory: ExtensionFactory): Promise<void>;
  handlers: Map<string, Handler[]>;
  tools: ToolDefinition[];
  commands: Array<{ name: string; command: Command }>;
  entryRenderers: Map<string, { renderer: unknown; options: unknown }>;
  queuedCommands: Array<[string, string | undefined]>;
  apiCalls: ApiCall[];
  appendEntries: Array<[string, unknown]>;
  emissions: Array<[string, unknown]>;
  activeTools: string[];
  allTools: Array<{ name: string }>;
  api: RecorderApi;
  ui: RecordingUI;
  modelRegistry: ModelRegistryFixture;
  makeContext(overrides?: Partial<ExtensionContext>): ExtensionContext;
  makeCommandContext(overrides?: Partial<ExtensionCommandContext>): ExtensionCommandContext;
  invokeRaw(event: string, payload?: unknown, context?: ExtensionContext): Promise<unknown[]>;
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
  invokeCommandDirect(
    name: string,
    args?: string,
    context?: ExtensionCommandContext,
    registrationIndex?: number,
  ): Promise<void>;
}

function inertUi(): ExtensionUIContext {
  const plain = (text: string) => text;
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
    theme: {
      fg: (_: string, text: string) => text,
      bg: (_: string, text: string) => text,
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
    } as never,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: true }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => undefined,
  };
}

export function createRecordingUi(): RecordingUI {
  const calls: RecordingUI["calls"] = [];
  const selectResponses: Array<string | undefined> = [];
  const confirmResponses: boolean[] = [];
  const inputResponses: Array<string | undefined> = [];
  const ui = inertUi();
  ui.notify = (message, type) => {
    calls.push({ name: "notify", args: [message, type] });
  };
  ui.select = async (title, options, opts) => {
    calls.push({ name: "select", args: [title, options, opts] });
    return selectResponses.shift();
  };
  ui.confirm = async (title, message, opts) => {
    calls.push({ name: "confirm", args: [title, message, opts] });
    return confirmResponses.shift() ?? false;
  };
  ui.input = async (title, placeholder, opts) => {
    calls.push({ name: "input", args: [title, placeholder, opts] });
    return inputResponses.shift();
  };
  return { calls, ui, selectResponses, confirmResponses, inputResponses };
}

export function createModelRegistryFixture(): ModelRegistryFixture {
  const models: unknown[] = [],
    available: unknown[] = [];
  const fixture: ModelRegistryFixture = {
    models,
    available,
    configuredAuth: false,
    add(model, isAvailable = true) {
      models.push(model);
      if (isAvailable) available.push(model);
    },
    remove(provider, id) {
      for (const list of [models, available]) {
        const index = list.findIndex((model) => {
          const value = model as { provider?: string; id?: string };
          return value.provider === provider && value.id === id;
        });
        if (index >= 0) list.splice(index, 1);
      }
    },
    registry: undefined as never,
  };
  fixture.registry = {
    refresh: async () => ({}),
    getError: () => undefined,
    getAll: () => [...models] as never,
    getAvailable: () => [...available] as never,
    find: (provider: string, id: string) =>
      models.find((model) => {
        const value = model as { provider?: string; id?: string };
        return value.provider === provider && value.id === id;
      }) as never,
    hasConfiguredAuth: () => fixture.configuredAuth,
    getApiKeyAndHeaders: async () => ({
      ok: false,
      error: "Recording model registry has no credentials",
    }),
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
  } as never;
  return fixture;
}

export function createExtensionRecorder(options: RecorderOptions = {}): ExtensionRecorder {
  const handlers = new Map<string, Handler[]>();
  const tools: ToolDefinition[] = [];
  const commands: ExtensionRecorder["commands"] = [];
  const entryRenderers = new Map<string, { renderer: unknown; options: unknown }>();
  const queuedCommands: Array<[string, string | undefined]> = [];
  const apiCalls: ApiCall[] = [];
  const appendEntries: Array<[string, unknown]> = [];
  const emissions: Array<[string, unknown]> = [];
  const activeTools = [...(options.activeTools ?? [])];
  const allTools: Array<{ name: string }> = [...(options.allTools ?? [])];
  const listeners = options.eventBus ?? new Map<string, unknown>();
  const ui = options.ui ?? createRecordingUi();
  const modelRegistry = options.modelRegistry ?? createModelRegistryFixture();
  const installations: Promise<void>[] = [];
  let pendingInstallations = 0;
  const record = (name: string, args: unknown[]) => apiCalls.push({ name, args });
  const api = {
    on(event: string, handler: Handler) {
      record("on", [event, handler]);
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(tool: ToolDefinition) {
      record("registerTool", [tool]);
      tools.push(tool);
    },
    registerCommand(name: string, command: Command) {
      record("registerCommand", [name, command]);
      commands.push({ name, command });
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
    exec: async (command: string, args: string[], execOptions?: ExecOptions) => {
      record("exec", [command, args, execOptions]);
      if (!options.exec) throw new Error("No exec behavior configured for extension recorder");
      return options.exec(command, args, execOptions);
    },
    events: {
      on(event: string, listener: (value: unknown) => void) {
        record("events.on", [event, listener]);
        const registrations = listeners.get(event) ?? [];
        if (Array.isArray(registrations)) registrations.push(listener);
        else (registrations as Set<(value: unknown) => void>).add(listener);
        listeners.set(event, registrations);
        return () => {
          if (Array.isArray(registrations)) {
            const index = registrations.indexOf(listener);
            if (index >= 0) registrations.splice(index, 1);
          } else (registrations as Set<(value: unknown) => void>).delete(listener);
        };
      },
      emit(event: string, value?: unknown) {
        record("events.emit", [event, value]);
        emissions.push([event, value]);
        for (const listener of (listeners.get(event) as
          | Iterable<(value: unknown) => void>
          | undefined) ?? [])
          listener(value);
      },
    },
    ...options.additions,
  };
  for (const key of options.omit ?? []) delete (api as Record<string, unknown>)[key];
  const waitForPrior = () =>
    pendingInstallations === 0 ? undefined : Promise.all(installations.slice());
  const makeContext = (overrides: Partial<ExtensionContext> = {}): ExtensionContext => ({
    mode: "tui",
    hasUI: true,
    cwd: process.cwd(),
    ui: ui.ui,
    sessionManager: SessionManager.inMemory(process.cwd()),
    modelRegistry: modelRegistry.registry,
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
      }) as never;
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
      fork: async (_id, request) => {
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
  const recorder: ExtensionRecorder = {
    installations,
    get ready() {
      return Promise.all(installations.slice()).then(() => undefined);
    },
    install(factory) {
      let installation: Promise<void>;
      pendingInstallations += 1;
      try {
        installation = Promise.resolve(factory(api as unknown as ExtensionAPI));
      } catch (error) {
        installation = Promise.reject(error);
      }
      installations.push(installation);
      void installation.catch(() => undefined);
      void installation
        .finally(() => {
          pendingInstallations -= 1;
        })
        .catch(() => undefined);
      return installation;
    },
    handlers,
    tools,
    commands,
    entryRenderers,
    queuedCommands,
    apiCalls,
    appendEntries,
    emissions,
    activeTools,
    allTools,
    api: api as unknown as RecorderApi,
    ui,
    modelRegistry,
    makeContext,
    makeCommandContext,
    async invokeRaw(event, payload = {}, context = makeContext()) {
      await waitForPrior();
      const results: unknown[] = [];
      for (const handler of handlers.get(event) ?? [])
        results.push(await handler(payload as never, context));
      return results;
    },
    async invokeToolDirect(name, params, invokeOptions = {}) {
      await waitForPrior();
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
    invokeCommandDirect(name, args = "", context = makeCommandContext(), registrationIndex) {
      const invoke = () => {
        const matches = commands
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry.name === name);
        const selected =
          registrationIndex === undefined
            ? matches.length === 1
              ? matches[0]
              : undefined
            : matches.find(({ index }) => index === registrationIndex);
        if (!selected)
          throw new Error(
            registrationIndex === undefined
              ? `Expected exactly one command named ${name}`
              : `No command named ${name} at registration index ${registrationIndex}`,
          );
        return selected.entry.command.handler(args, context);
      };
      const waiting = waitForPrior();
      if (waiting) return waiting.then(invoke);
      try {
        return Promise.resolve(invoke());
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
  return recorder;
}
