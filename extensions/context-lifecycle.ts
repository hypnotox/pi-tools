import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// The real loader isolates module instances and ExtensionAPI objects. Coordinate
// only these two operations over Pi's runtime event bus, not module globals.
const BUSY_QUERY = "pi-tools:context-operation-busy";
interface BusyQuery {
  session: string;
  busy: boolean;
}
interface Request {
  id: string;
  text: string;
  session: string;
  signal: AbortSignal | undefined;
  phase: "queued" | "settling" | "executing";
}
interface Operation {
  tool: "handoff_session" | "compact_session";
  command: string;
  field: "kickoff" | "instructions";
  label: string;
  description: string;
  randomUUID(): string;
  run(text: string, context: ExtensionCommandContext, current: () => boolean): Promise<void>;
}

function toolCallsInCurrentBatch(context: ExtensionContext, event: ToolCallEvent) {
  const leaf = context.sessionManager.getLeafEntry();
  const content =
    leaf?.type === "message" &&
    leaf.message.role === "assistant" &&
    Array.isArray(leaf.message.content)
      ? leaf.message.content
      : [];
  const calls = content.filter((part) => part.type === "toolCall");
  return {
    calls,
    correlated: calls.some((call) => call.id === event.toolCallId && call.name === event.toolName),
  };
}

export function registerContextOperation(pi: ExtensionAPI, operation: Operation): void {
  let pending: Request | undefined;
  let suppressThreshold = false;
  let ownsTool = false;
  let registered = false;
  let sourcePath: string | undefined;
  let unsubscribe: (() => void) | undefined;

  const invalidate = () => {
    pending = undefined;
    suppressThreshold = false;
  };
  const valid = (request: Request, context: ExtensionContext) =>
    pending === request &&
    context.sessionManager.getSessionFile() === request.session &&
    (request.phase === "executing" || !request.signal?.aborted);
  pi.on("session_tree", invalidate);
  pi.on("session_shutdown", () => {
    invalidate();
    ownsTool = false;
    unsubscribe?.();
    unsubscribe = undefined;
  });
  pi.on("tool_call", (event, context) => {
    if (!ownsTool) return;
    const { calls, correlated } = toolCallsInCurrentBatch(context, event);
    if (!correlated)
      return event.toolName === operation.tool
        ? {
            block: true,
            reason: `Cannot verify the current tool batch; retry ${operation.tool} alone.`,
          }
        : undefined;
    if (calls.length > 1 && calls.some((call) => call.name === operation.tool))
      return {
        block: true,
        reason: `A batch containing ${operation.tool} cannot contain siblings; retry ${operation.tool} alone.`,
      };
  });
  pi.on("session_before_compact", (event, context) => {
    if (pending && !valid(pending, context)) invalidate();
    if (suppressThreshold && pending && event.reason === "threshold") {
      suppressThreshold = false;
      return { cancel: true };
    }
  });

  const dispatch = (request: Request) => {
    const command = pi
      .getCommands()
      .find(
        (candidate) =>
          candidate.source === "extension" &&
          candidate.sourceInfo.path === sourcePath &&
          (candidate.name === operation.command ||
            candidate.name.startsWith(`${operation.command}:`)),
      );
    if (!command) throw new Error(`Cannot resolve the ${operation.tool} continuation command`);
    pi.sendUserMessage(`/${command.name} ${request.id}`, { expandPromptTemplates: true });
  };

  pi.on("session_start", (_event, context) => {
    if (
      registered ||
      (context.mode !== "tui" && context.mode !== "rpc") ||
      !context.sessionManager.getSessionFile()
    )
      return;
    if (pi.getAllTools().some((tool) => tool.name === operation.tool)) return;
    registered = true;
    unsubscribe = pi.events.on(BUSY_QUERY, (value) => {
      const query = value as BusyQuery;
      if (pending && !valid(pending, context)) invalidate();
      if (pending?.session === query.session) query.busy = true;
    });
    pi.registerCommand(operation.command, {
      description: `Continue ${operation.label.toLowerCase()}.`,
      async handler(token, commandContext) {
        const request = pending;
        if (!request || request.id !== token || request.phase !== "queued") return;
        request.phase = "settling";
        try {
          await commandContext.waitForIdle();
          // Accepted replacements abort the outgoing run before shutdown. A
          // cancelled preflight alone does not invalidate this request.
          if (!valid(request, commandContext)) return;
          request.phase = "executing";
          suppressThreshold = false;
          await operation.run(request.text, commandContext, () => valid(request, commandContext));
        } finally {
          if (pending === request) invalidate();
        }
      },
    });
    ownsTool = true;
    pi.registerTool({
      name: operation.tool,
      label: operation.label,
      description: operation.description,
      parameters: Type.Object(
        { [operation.field]: Type.String() },
        { additionalProperties: false },
      ),
      async execute(_id, params, _signal, _update, toolContext) {
        const session = toolContext.sessionManager.getSessionFile();
        if ((toolContext.mode !== "tui" && toolContext.mode !== "rpc") || !session)
          throw new Error(`${operation.tool} requires a persisted Pi session`);
        const text = params[operation.field];
        if (typeof text !== "string" || !text.trim())
          throw new Error(`${operation.field} must contain non-whitespace content`);
        if (new TextEncoder().encode(text).byteLength > 16 * 1024)
          throw new Error(`${operation.field} must not exceed the 16 KiB UTF-8 limit`);
        if (pending && !valid(pending, toolContext)) invalidate();
        if (pending) {
          if (pending.phase === "queued") dispatch(pending);
          return {
            content: [
              {
                type: "text",
                text: `${operation.label} already ${pending.phase === "executing" ? "in progress" : "queued"}.`,
              },
            ],
            details: {},
            terminate: true,
          };
        }
        const query: BusyQuery = { session, busy: false };
        pi.events.emit(BUSY_QUERY, query);
        if (query.busy)
          throw new Error("Another context operation is pending; wait for its terminal outcome.");
        const request: Request = {
          id: operation.randomUUID(),
          text,
          session,
          signal: toolContext.signal,
          phase: "queued",
        };
        pending = request;
        suppressThreshold = true;
        try {
          dispatch(request);
        } catch (error) {
          if (pending === request) invalidate();
          throw error;
        }
        return {
          content: [{ type: "text", text: `${operation.label} queued.` }],
          details: {},
          terminate: true,
        };
      },
    });
    sourcePath = pi.getAllTools().find((tool) => tool.name === operation.tool)?.sourceInfo.path;
  });
}
