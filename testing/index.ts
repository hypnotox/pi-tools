import type { Api, Model } from "@earendil-works/pi-ai";
import type {
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
type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type ApiCall = { name: string; args: unknown[] };
type ExecBehavior = ExtensionAPI["exec"];
type SetActiveToolsBehavior = ExtensionAPI["setActiveTools"];
type ModelRegistry = ExtensionContext["modelRegistry"];
type ReplacedSessionContext = ExtensionCommandContext & {
  sendMessage(...args: Parameters<ExtensionAPI["sendMessage"]>): Promise<void>;
  sendUserMessage(...args: Parameters<ExtensionAPI["sendUserMessage"]>): Promise<void>;
};

type ModelRegistryQueries = Pick<
  ModelRegistry,
  "getAll" | "getAvailable" | "find" | "hasConfiguredAuth"
>;

type RecorderApi = Pick<
  ExtensionAPI,
  | "on"
  | "registerTool"
  | "registerCommand"
  | "registerEntryRenderer"
  | "appendEntry"
  | "getActiveTools"
  | "getAllTools"
  | "setActiveTools"
  | "exec"
  | "events"
> & {
  queueCommand(name: string, args?: string): void;
};

type RecorderApiKey = keyof RecorderApi;
type AdditionalCapabilities<T extends Record<string, unknown>> = T & {
  [K in RecorderApiKey]?: never;
};

export interface RecordingUI {
  readonly calls: Array<{ name: "notify" | "select" | "confirm" | "input"; args: unknown[] }>;
  readonly ui: ExtensionUIContext;
  selectResponses: Array<string | undefined>;
  confirmResponses: boolean[];
  inputResponses: Array<string | undefined>;
}

export interface ModelRegistryFixture {
  /** Structurally typed test surface; it is translated to Pi's nominal registry only in a context. */
  registry: ModelRegistryQueries & Record<string, unknown>;
  models: Model<Api>[];
  available: Model<Api>[];
  configuredAuth: boolean;
  add(model: Model<Api>, available?: boolean): void;
  remove(provider: string, id: string): void;
}

interface EventRegistration {
  listener(value: unknown): void;
}

/** A synchronous duplicate-preserving bus that can be shared by several recorders. */
export interface RecordingEventBus {
  readonly emissions: Array<[string, unknown]>;
  on(event: string, listener: (value: unknown) => void): () => void;
  emit(event: string, value?: unknown): void;
}

export interface RecorderOptions<
  TAdditions extends Record<string, unknown> = Record<never, never>,
  TOmitted extends RecorderApiKey = never,
> {
  omit?: readonly TOmitted[];
  additions?: AdditionalCapabilities<TAdditions>;
  exec?: ExecBehavior;
  setActiveTools?: SetActiveToolsBehavior;
  ui?: RecordingUI;
  modelRegistry?: ModelRegistryFixture;
  allTools?: ToolInfo[];
  activeTools?: string[];
  eventBus?: RecordingEventBus;
}

/** A framework-neutral recording of selected documented Pi extension seams, not a Pi runtime. */
export interface ExtensionRecorder<TApi extends object = RecorderApi> {
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
  allTools: ToolInfo[];
  api: TApi;
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
    } as unknown as ExtensionUIContext["theme"],
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
  const models: Model<Api>[] = [];
  const available: Model<Api>[] = [];
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
        const index = list.findIndex((model) => model.provider === provider && model.id === id);
        if (index >= 0) list.splice(index, 1);
      }
    },
    registry: undefined as never,
  };
  fixture.registry = {
    refresh: async () => {
      throw new Error("Recording model registry cannot refresh providers");
    },
    getError: () => undefined,
    getAll: () => [...models],
    getAvailable: () => [...available],
    find: (provider: string, id: string) =>
      models.find((model) => model.provider === provider && model.id === id),
    hasConfiguredAuth: () => fixture.configuredAuth,
    getApiKeyAndHeaders: async () => ({
      ok: false as const,
      error: "Recording model registry has no credentials",
    }),
    getProviderAuthStatus: () => ({ status: "not_authenticated" as const }),
    getProvider: () => undefined,
    complete: async () => {
      throw new Error("Recording model registry cannot complete model requests");
    },
    getProviderDisplayName: (provider: string) => provider,
    getProviderAuth: async () => undefined,
    getApiKeyForProvider: async () => undefined,
    isUsingOAuth: () => false,
    registerProvider: () => undefined,
    unregisterProvider: () => undefined,
    getRegisteredProviderConfig: () => undefined,
    getRegisteredNativeProvider: () => undefined,
    getRegisteredProviderIds: () => [],
  };
  return fixture;
}

export function createRecordingEventBus(): RecordingEventBus {
  const registrations = new Map<string, EventRegistration[]>();
  const emissions: Array<[string, unknown]> = [];
  return {
    emissions,
    on(event, listener) {
      const registration = { listener };
      const eventRegistrations = registrations.get(event) ?? [];
      eventRegistrations.push(registration);
      registrations.set(event, eventRegistrations);
      return () => {
        const index = eventRegistrations.indexOf(registration);
        if (index >= 0) eventRegistrations.splice(index, 1);
      };
    },
    emit(event, value) {
      emissions.push([event, value]);
      for (const registration of [...(registrations.get(event) ?? [])])
        registration.listener(value);
    },
  };
}

export function createExtensionRecorder<
  TAdditions extends Record<string, unknown> = Record<never, never>,
  TOmitted extends RecorderApiKey = never,
>(
  options: RecorderOptions<TAdditions, TOmitted> = {} as RecorderOptions<TAdditions, TOmitted>,
): ExtensionRecorder<Omit<RecorderApi, TOmitted> & TAdditions> {
  const handlers = new Map<string, Handler[]>();
  const tools: ToolDefinition[] = [];
  const commands: Array<{ name: string; command: Command }> = [];
  const entryRenderers = new Map<string, { renderer: unknown; options: unknown }>();
  const queuedCommands: Array<[string, string | undefined]> = [];
  const apiCalls: ApiCall[] = [];
  const appendEntries: Array<[string, unknown]> = [];
  const activeTools = [...(options.activeTools ?? [])];
  const allTools = [...(options.allTools ?? [])];
  const eventBus = options.eventBus ?? createRecordingEventBus();
  const ui = options.ui ?? createRecordingUi();
  const modelRegistry = options.modelRegistry ?? createModelRegistryFixture();
  const installations: Promise<void>[] = [];
  const record = (name: string, args: unknown[]) => apiCalls.push({ name, args });

  const supportedKeys = new Set<RecorderApiKey>([
    "on",
    "registerTool",
    "registerCommand",
    "registerEntryRenderer",
    "appendEntry",
    "getActiveTools",
    "getAllTools",
    "setActiveTools",
    "queueCommand",
    "exec",
    "events",
  ]);
  for (const key of Object.keys(options.additions ?? {})) {
    if (supportedKeys.has(key as RecorderApiKey))
      throw new Error(`Addition ${key} replaces a supported recorder method`);
  }

  const apiObject = {
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
    registerEntryRenderer(type: string, renderer: unknown, rendererOptions?: unknown) {
      record("registerEntryRenderer", [type, renderer, rendererOptions]);
      entryRenderers.set(type, { renderer, options: rendererOptions });
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
      if (options.setActiveTools) {
        options.setActiveTools(names);
        return;
      }
      activeTools.splice(0, activeTools.length, ...names);
    },
    queueCommand(name: string, args?: string) {
      record("queueCommand", [name, args]);
      queuedCommands.push([name, args]);
    },
    async exec(
      command: Parameters<ExecBehavior>[0],
      args: Parameters<ExecBehavior>[1],
      execOptions?: Parameters<ExecBehavior>[2],
    ) {
      record("exec", [command, args, execOptions]);
      if (!options.exec) throw new Error("No exec behavior configured for extension recorder");
      return options.exec(command, args, execOptions);
    },
    events: {
      on(event: string, listener: (value: unknown) => void) {
        record("events.on", [event, listener]);
        return eventBus.on(event, listener);
      },
      emit(event: string, value: unknown) {
        record("events.emit", [event, value]);
        eventBus.emit(event, value);
      },
    },
  };
  const api = Object.assign(apiObject, options.additions ?? {}) as unknown as RecorderApi &
    TAdditions;
  for (const key of options.omit ?? []) delete (api as Record<string, unknown>)[key];

  let pendingInstallations = 0;
  const installationErrors: unknown[] = [];
  const waitForPrior = (): Promise<void> | undefined => {
    if (pendingInstallations > 0) return Promise.all(installations.slice()).then(() => undefined);
    const failureIndex = installationErrors.findIndex((_, index) => index in installationErrors);
    if (failureIndex >= 0) return Promise.reject(installationErrors[failureIndex]);
    return undefined;
  };
  const makeContext = (overrides: Partial<ExtensionContext> = {}): ExtensionContext => {
    const cwd = overrides.cwd ?? process.cwd();
    return {
      mode: "tui",
      hasUI: true,
      cwd,
      ui: ui.ui,
      sessionManager: SessionManager.inMemory(cwd),
      modelRegistry: modelRegistry.registry as unknown as ModelRegistry,
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
    };
  };
  const makeCommandContext = (
    overrides: Partial<ExtensionCommandContext> = {},
  ): ExtensionCommandContext => {
    const cwd = overrides.cwd ?? process.cwd();
    const replacement = (sessionManager = SessionManager.inMemory(cwd)): ReplacedSessionContext =>
      ({
        ...makeCommandContext({ ...overrides, sessionManager }),
        sendMessage: async () => undefined,
        sendUserMessage: async () => undefined,
      }) as ReplacedSessionContext;
    return {
      ...makeContext(overrides),
      getSystemPromptOptions: () => ({ cwd }),
      waitForIdle: async () => undefined,
      newSession: async (request) => {
        const sessionManager = SessionManager.inMemory(cwd);
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

  const recorder: ExtensionRecorder<Omit<RecorderApi, TOmitted> & TAdditions> = {
    installations,
    get ready() {
      return Promise.all(installations.slice()).then(() => undefined);
    },
    install(factory) {
      const installationIndex = installations.length;
      let factoryResult: Promise<void>;
      pendingInstallations += 1;
      try {
        factoryResult = Promise.resolve(factory(api as unknown as ExtensionAPI));
      } catch (error) {
        factoryResult = Promise.reject(error);
      }
      const installation = factoryResult.then(
        () => {
          pendingInstallations -= 1;
        },
        (error: unknown) => {
          pendingInstallations -= 1;
          installationErrors[installationIndex] = error;
          throw error;
        },
      );
      installations.push(installation);
      void installation.catch(() => undefined);
      return installation;
    },
    handlers,
    tools,
    commands,
    entryRenderers,
    queuedCommands,
    apiCalls,
    appendEntries,
    emissions: eventBus.emissions,
    activeTools,
    allTools,
    api: api as Omit<RecorderApi, TOmitted> & TAdditions,
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
