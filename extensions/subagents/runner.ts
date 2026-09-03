import { type ChildProcess, spawn as nodeSpawn, spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  CHILD_MARKER,
  type ConcreteModel,
  type ExecutionActivity,
  type ExecutionOutcome,
  type ExecutionProjection,
  type PreparedRun,
  type ThinkingLevel,
} from "./api.js";

const MAX_TEXT_BYTES = 16 * 1024;
const MAX_ACTIVITY_TEXT_BYTES = 1024;
const MAX_ACTIVITY = 32;
const MAX_EXECUTION_HISTORY = 50;
const MAX_JSON_LINE_BYTES = 1024 * 1024;
const TERMINATE_GRACE_MS = 1_000;
const FORCE_WAIT_MS = 1_000;
const REFRESH_INTERVAL_MS = 1_000;

export interface RunnerDependencies {
  spawn?: typeof nodeSpawn;
  canonicalize?: (path: string) => Promise<string>;
  mkdtemp?: typeof mkdtemp;
  writeFile?: typeof writeFile;
  rm?: typeof rm;
  executable?: () => { command: string; prefix: string[] };
  signalTree?: (child: ChildProcess, signal: NodeJS.Signals) => void;
  delay?: (milliseconds: number) => Promise<void>;
  monotonicNow?: () => number;
  /** Schedules bounded live timing refreshes and returns their cleanup callback. */
  scheduleRefresh?: (callback: () => void, milliseconds: number) => () => void;
}

export interface RunRequest {
  prepared: PreparedRun;
  model: ConcreteModel;
  thinkingLevel: ThinkingLevel;
  tools: string[];
  parentCwd: string;
  parentTrusted: boolean;
  signal?: AbortSignal;
  onUpdate?: (outcome: ExecutionOutcome) => void;
  /** Converts child tool arguments immediately; raw arguments are never retained. */
  summarizeTool?: (toolName: string, args: unknown) => string;
}

export function truncateUtf8(value: string, limit = MAX_TEXT_BYTES): string {
  if (Buffer.byteLength(value, "utf8") <= limit) return value;
  const suffix = "...[truncated]";
  const budget = Math.max(0, limit - Buffer.byteLength(suffix, "utf8"));
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const width = Buffer.byteLength(character, "utf8");
    if (bytes + width > budget) break;
    output += character;
    bytes += width;
  }
  return output + suffix;
}

function snapshot(outcome: ExecutionOutcome): ExecutionOutcome {
  return {
    ...outcome,
    usage: { ...outcome.usage, cost: { ...outcome.usage.cost } },
    ...(outcome.execution === undefined
      ? {}
      : {
          execution: {
            ...outcome.execution,
            activity: outcome.execution.activity.map((entry) => ({ ...entry })),
            ...(outcome.execution.activeUsage === undefined
              ? {}
              : { activeUsage: copyUsage(outcome.execution.activeUsage) }),
            ...(outcome.execution.latestTurnUsage === undefined
              ? {}
              : { latestTurnUsage: copyUsage(outcome.execution.latestTurnUsage) }),
          },
        }),
    activity: outcome.activity.map((entry) => ({ ...entry })),
  };
}

function copyUsage(usage: ExecutionOutcome["usage"]): ExecutionOutcome["usage"] {
  return { ...usage, cost: { ...usage.cost } };
}

function finiteNonnegative(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function usageFrom(usage: Record<string, unknown>): ExecutionOutcome["usage"] {
  const result: ExecutionOutcome["usage"] = {
    input: finiteNonnegative(usage.input),
    output: finiteNonnegative(usage.output),
    cacheRead: finiteNonnegative(usage.cacheRead),
    cacheWrite: finiteNonnegative(usage.cacheWrite),
    totalTokens: finiteNonnegative(usage.totalTokens),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  for (const key of ["cacheWrite1h", "reasoning"] as const)
    if (usage[key] !== undefined) result[key] = finiteNonnegative(usage[key]);
  if (usage.cost && typeof usage.cost === "object") {
    const cost = usage.cost as Record<string, unknown>;
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const)
      result.cost[key] = finiteNonnegative(cost[key]);
  }
  return result;
}

function addUsage(total: ExecutionOutcome["usage"], turn: ExecutionOutcome["usage"]): void {
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const)
    total[key] += turn[key];
  for (const key of ["cacheWrite1h", "reasoning"] as const)
    if (turn[key] !== undefined) total[key] = (total[key] ?? 0) + turn[key];
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const)
    total.cost[key] += turn.cost[key];
}

function initialOutcome(prompt = ""): ExecutionOutcome {
  return {
    state: "running",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    execution: {
      prompt: truncateUtf8(prompt),
      activity: [],
      omittedActivity: 0,
      elapsedMs: 0,
      turns: 0,
    },
    activity: [],
    omittedActivity: 0,
    retries: 0,
    retryActive: false,
  };
}

function defaultExecutable(): { command: string; prefix: string[] } {
  const script = process.argv[1];
  if (
    script &&
    !script.startsWith("/$bunfs/") &&
    path.basename(process.execPath).match(/^(node|bun)(\.exe)?$/i)
  )
    return { command: process.execPath, prefix: [script] };
  return { command: "pi", prefix: [] };
}

export function isPathWithin(
  parent: string,
  child: string,
  pathApi: Pick<typeof path, "relative" | "isAbsolute" | "sep"> = path,
): boolean {
  const relativePath = pathApi.relative(parent, child);
  return (
    relativePath === "" ||
    (!pathApi.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${pathApi.sep}`))
  );
}

function defaultSignalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    const args = ["/pid", String(child.pid), "/t"];
    if (signal === "SIGKILL") args.push("/f");
    const result = spawnSync("taskkill", args, { stdio: "ignore", windowsHide: true });
    if (result.status !== 0) child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

export class SubprocessRunner {
  #deps: Required<RunnerDependencies>;
  #terminations = new Set<() => Promise<void>>();
  #runs = new Set<Promise<void>>();
  #disposed = false;

  constructor(deps: RunnerDependencies = {}) {
    this.#deps = {
      spawn: deps.spawn ?? nodeSpawn,
      canonicalize: deps.canonicalize ?? realpath,
      mkdtemp: deps.mkdtemp ?? mkdtemp,
      writeFile: deps.writeFile ?? writeFile,
      rm: deps.rm ?? rm,
      executable: deps.executable ?? defaultExecutable,
      signalTree: deps.signalTree ?? defaultSignalTree,
      delay:
        deps.delay ??
        ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
      monotonicNow: deps.monotonicNow ?? (() => performance.now()),
      scheduleRefresh:
        deps.scheduleRefresh ??
        ((callback, milliseconds) => {
          const timer = setInterval(callback, milliseconds);
          timer.unref();
          return () => clearInterval(timer);
        }),
    };
  }

  async run(request: RunRequest): Promise<ExecutionOutcome> {
    let finishRun = (): void => undefined;
    const trackedRun = new Promise<void>((resolve) => {
      finishRun = resolve;
    });
    this.#runs.add(trackedRun);
    try {
      return await this.#run(request);
    } finally {
      finishRun();
      this.#runs.delete(trackedRun);
    }
  }

  #assertLaunchable(signal: AbortSignal | undefined): void {
    if (this.#disposed) throw new Error("Subagent runner is shut down");
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  async #run(request: RunRequest): Promise<ExecutionOutcome> {
    if (this.#disposed || request.signal?.aborted)
      return {
        ...initialOutcome(request.prepared.prompt),
        state: "cancelled",
        failure: this.#disposed ? "Subagent runner is shut down" : "Cancelled before launch",
      };

    const outcome = initialOutcome(request.prepared.prompt) as ExecutionOutcome & {
      execution: ExecutionProjection;
    };
    const invocationStartedMono = this.#deps.monotonicNow();
    const activeTools = new Map<
      string,
      {
        startedMono: number;
        entry: Extract<ExecutionProjection["activity"][number], { kind: "tool" }>;
      }
    >();
    let activeRetry:
      | {
          startedMono: number;
          entry: Extract<ExecutionProjection["activity"][number], { kind: "retry" }>;
        }
      | undefined;
    const updateDurations = (): void => {
      const now = this.#deps.monotonicNow();
      outcome.execution.elapsedMs = Math.max(0, now - invocationStartedMono);
      for (const { startedMono, entry } of activeTools.values())
        if (entry.state === "running") entry.durationMs = Math.max(0, now - startedMono);
      if (activeRetry?.entry.state === "running")
        activeRetry.entry.durationMs = Math.max(0, now - activeRetry.startedMono);
    };
    const finalizeActiveActivity = (): void => {
      updateDurations();
      for (const { entry } of activeTools.values()) entry.state = "error";
      activeTools.clear();
      if (activeRetry) {
        activeRetry.entry.state = "error";
        activeRetry = undefined;
      }
    };
    const emit = (): void => {
      updateDurations();
      request.onUpdate?.(snapshot(outcome));
    };
    const activity = (kind: ExecutionActivity["kind"], text: string): void => {
      if (outcome.activity.length < MAX_ACTIVITY)
        outcome.activity.push({ kind, text: truncateUtf8(text, MAX_ACTIVITY_TEXT_BYTES) });
      else outcome.omittedActivity++;
      emit();
    };
    const boundHistory = (reservedRows: number): void => {
      while (outcome.execution.activity.length > MAX_EXECUTION_HISTORY - reservedRows) {
        outcome.execution.activity.shift();
        outcome.execution.omittedActivity++;
      }
    };
    const history = (entry: ExecutionProjection["activity"][number]): void => {
      outcome.execution.activity.push(entry);
      boundHistory(outcome.execution.unfinishedThinking === undefined ? 0 : 1);
    };
    let unfinishedThinking = "";
    const thinking = (delta: unknown): void => {
      if (typeof delta !== "string") return;
      delete outcome.execution.unfinishedThinking;
      const lines = (unfinishedThinking + delta).split("\n");
      unfinishedThinking = truncateUtf8(lines.pop() ?? "", MAX_ACTIVITY_TEXT_BYTES);
      for (const line of lines) {
        const text = line.trim();
        if (text) history({ kind: "thinking", text: truncateUtf8(text, MAX_ACTIVITY_TEXT_BYTES) });
      }
      const unfinished = unfinishedThinking.trim();
      if (unfinished) {
        outcome.execution.unfinishedThinking = truncateUtf8(unfinished, MAX_ACTIVITY_TEXT_BYTES);
        boundHistory(1);
      } else delete outcome.execution.unfinishedThinking;
    };
    const flushThinking = (): void => {
      const text = unfinishedThinking.trim();
      unfinishedThinking = "";
      delete outcome.execution.unfinishedThinking;
      if (text) history({ kind: "thinking", text: truncateUtf8(text, MAX_ACTIVITY_TEXT_BYTES) });
    };

    let childCwd = "";
    let parentCwd = "";
    let promptDir: string | undefined;
    let promptPath = "";
    let child: ChildProcess | undefined;
    let removeAbort = (): void => undefined;
    let removeChildListeners = (): void => undefined;
    let terminate = async (): Promise<void> => undefined;
    let stopRefresh = (): void => undefined;

    try {
      childCwd = await this.#deps.canonicalize(path.resolve(request.prepared.cwd));
      this.#assertLaunchable(request.signal);
      parentCwd = await this.#deps.canonicalize(path.resolve(request.parentCwd));
      this.#assertLaunchable(request.signal);
      promptDir = await this.#deps.mkdtemp(path.join(tmpdir(), "pi-tools-subagent-"));
      promptPath = path.join(promptDir, "system-prompt.txt");
      this.#assertLaunchable(request.signal);
      await this.#deps.writeFile(promptPath, request.prepared.systemPrompt, {
        encoding: "utf8",
        mode: 0o600,
      });
      this.#assertLaunchable(request.signal);
      const invocation = this.#deps.executable();
      const args = [
        ...invocation.prefix,
        "--mode",
        "json",
        "--print",
        "--no-session",
        "--no-context-files",
        "--system-prompt",
        promptPath,
        "--model",
        `${request.model.provider}/${request.model.id}`,
        "--thinking",
        request.thinkingLevel,
        ...(request.tools.length > 0 ? ["--tools", request.tools.join(",")] : ["--no-tools"]),
      ];
      if (request.parentTrusted && isPathWithin(parentCwd, childCwd)) args.push("--approve");
      this.#assertLaunchable(request.signal);

      child = this.#deps.spawn(invocation.command, args, {
        cwd: childCwd,
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, [CHILD_MARKER]: "1" },
      });

      let settled = false;
      let settleClose: (code: number | null) => void = () => undefined;
      let rejectClose: (error: Error) => void = () => undefined;
      const closePromise = new Promise<number | null>((resolveClose, reject) => {
        settleClose = (code) => {
          if (settled) return;
          settled = true;
          resolveClose(code);
        };
        rejectClose = (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
      });
      child.once("close", settleClose);
      child.once("error", rejectClose);

      let terminating: Promise<void> | undefined;
      terminate = (): Promise<void> => {
        if (terminating) return terminating;
        terminating = (async () => {
          if (!child || settled) return;
          this.#deps.signalTree(child, "SIGTERM");
          await Promise.race([
            closePromise.catch(() => null),
            this.#deps.delay(TERMINATE_GRACE_MS),
          ]);
          if (!settled) this.#deps.signalTree(child, "SIGKILL");
          await Promise.race([closePromise.catch(() => null), this.#deps.delay(FORCE_WAIT_MS)]);
          if (!settled) settleClose(null);
        })();
        return terminating;
      };
      this.#terminations.add(terminate);
      const handleStdinError = (error: Error): void => {
        outcome.failure ??= truncateUtf8(`Failed to send subagent prompt: ${error.message}`);
        void terminate();
      };
      child.stdin?.on("error", handleStdinError);
      child.stdin?.end(request.prepared.prompt, "utf8");
      const abort = (): void => {
        void terminate();
      };
      request.signal?.addEventListener("abort", abort, { once: true });
      removeAbort = () => request.signal?.removeEventListener("abort", abort);

      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let lineBuffer = "";
      let discardingLine = false;
      let stderr = "";

      const processLine = (line: string): void => {
        if (!line.trim()) return;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          activity("diagnostic", "Ignored malformed child JSON event");
          return;
        }
        if (event.type === "tool_execution_start") {
          const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
          const toolCallId =
            typeof event.toolCallId === "string" && event.toolCallId ? event.toolCallId : undefined;
          if (!toolCallId) {
            activity("diagnostic", "Ignored child tool event without an ID");
            return;
          }
          if (!activeTools.has(toolCallId)) {
            const entry = {
              kind: "tool" as const,
              toolCallId: truncateUtf8(toolCallId, MAX_ACTIVITY_TEXT_BYTES),
              summary: truncateUtf8(
                request.summarizeTool?.(toolName, event.args) ?? toolName,
                MAX_ACTIVITY_TEXT_BYTES,
              ),
              state: "running" as const,
              durationMs: 0,
            };
            history(entry);
            activeTools.set(toolCallId, { startedMono: this.#deps.monotonicNow(), entry });
          }
          emit();
        } else if (event.type === "tool_execution_end") {
          const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
          const active = activeTools.get(toolCallId);
          if (active) {
            active.entry.durationMs = Math.max(0, this.#deps.monotonicNow() - active.startedMono);
            active.entry.state =
              event.isError === true || event.error !== undefined ? "error" : "success";
            activeTools.delete(toolCallId);
            emit();
          }
        } else if (event.type === "message_update") {
          const usage = event.usage;
          if (usage && typeof usage === "object")
            outcome.execution.activeUsage = usageFrom(usage as Record<string, unknown>);
          const assistantMessageEvent = event.assistantMessageEvent as
            | Record<string, unknown>
            | undefined;
          if (assistantMessageEvent?.type === "thinking_delta")
            thinking(assistantMessageEvent.delta);
          else if (assistantMessageEvent?.type === "thinking_end") flushThinking();
          emit();
        } else if (event.type === "auto_retry_start") {
          outcome.retries++;
          outcome.retryActive = true;
          const attempt =
            Number.isInteger(event.attempt) && Number(event.attempt) > 0
              ? Number(event.attempt)
              : outcome.retries;
          const maxAttempts =
            Number.isInteger(event.maxAttempts) && Number(event.maxAttempts) >= attempt
              ? Number(event.maxAttempts)
              : attempt;
          if (activeRetry) {
            activeRetry.entry.attempt = attempt;
            activeRetry.entry.maxAttempts = maxAttempts;
          } else {
            const entry = {
              kind: "retry" as const,
              attempt,
              maxAttempts,
              state: "running" as const,
              durationMs: 0,
            };
            history(entry);
            activeRetry = { startedMono: this.#deps.monotonicNow(), entry };
          }
          activity("retry_start", String(event.errorMessage ?? "request retry"));
        } else if (event.type === "auto_retry_end") {
          outcome.retryActive = false;
          if (activeRetry) {
            if (Number.isInteger(event.attempt) && Number(event.attempt) > 0)
              activeRetry.entry.attempt = Number(event.attempt);
            activeRetry.entry.durationMs = Math.max(
              0,
              this.#deps.monotonicNow() - activeRetry.startedMono,
            );
            activeRetry.entry.state = event.success === true ? "success" : "error";
            activeRetry = undefined;
          }
          activity("retry_end", String(event.finalError ?? "request retry complete"));
        } else if (event.type === "message_end") {
          const message = event.message as
            | {
                role?: string;
                content?: Array<{ type?: string; text?: string }>;
                usage?: Record<string, unknown>;
                errorMessage?: string;
              }
            | undefined;
          if (message?.role !== "assistant") return;
          flushThinking();
          outcome.report = truncateUtf8(
            message.content
              ?.filter((part) => part.type === "text")
              .map((part) => part.text ?? "")
              .join("") ?? "",
          );
          const usage = message.usage;
          const turnUsage =
            usage && typeof usage === "object" ? usageFrom(usage) : outcome.execution.activeUsage;
          if (turnUsage) {
            addUsage(outcome.usage, turnUsage);
            outcome.execution.latestTurnUsage = copyUsage(turnUsage);
            outcome.execution.turns++;
            delete outcome.execution.activeUsage;
          }
          if (message.errorMessage) outcome.failure = truncateUtf8(message.errorMessage);
          emit();
        }
      };

      const feedStdout = (text: string, final = false): void => {
        let remaining = text;
        while (remaining.length > 0) {
          if (discardingLine) {
            const newline = remaining.indexOf("\n");
            if (newline < 0) return;
            remaining = remaining.slice(newline + 1);
            discardingLine = false;
            activity("diagnostic", "Ignored oversized child JSON event");
            continue;
          }
          const newline = remaining.indexOf("\n");
          if (newline < 0) {
            lineBuffer += remaining;
            if (Buffer.byteLength(lineBuffer, "utf8") > MAX_JSON_LINE_BYTES) {
              lineBuffer = "";
              discardingLine = true;
            }
            remaining = "";
            continue;
          }
          const line = lineBuffer + remaining.slice(0, newline);
          lineBuffer = "";
          remaining = remaining.slice(newline + 1);
          if (Buffer.byteLength(line, "utf8") > MAX_JSON_LINE_BYTES)
            activity("diagnostic", "Ignored oversized child JSON event");
          else processLine(line);
        }
        if (final && discardingLine) {
          discardingLine = false;
          activity("diagnostic", "Ignored oversized child JSON event");
        } else if (final && lineBuffer.trim()) {
          processLine(lineBuffer);
          lineBuffer = "";
        }
      };

      const readStdout = (chunk: Buffer): void => feedStdout(stdoutDecoder.write(chunk));
      const readStderr = (chunk: Buffer): void => {
        stderr = truncateUtf8(stderr + stderrDecoder.write(chunk));
      };
      child.stdout?.on("data", readStdout);
      child.stderr?.on("data", readStderr);
      removeChildListeners = () => {
        child?.stdin?.removeListener("error", handleStdinError);
        child?.stdout?.removeListener("data", readStdout);
        child?.stderr?.removeListener("data", readStderr);
        child?.removeListener("close", settleClose);
        child?.removeListener("error", rejectClose);
      };
      if (request.onUpdate) stopRefresh = this.#deps.scheduleRefresh(emit, REFRESH_INTERVAL_MS);

      const code = await closePromise;
      feedStdout(stdoutDecoder.end(), true);
      stderr = truncateUtf8(stderr + stderrDecoder.end());
      if (request.signal?.aborted || this.#disposed) {
        outcome.state = "cancelled";
        outcome.failure = this.#disposed ? "Cancelled by shutdown" : "Cancelled";
      } else if (code !== 0 || outcome.failure) {
        outcome.state = "failed";
        outcome.failure = outcome.failure ?? truncateUtf8(stderr || "Child process failed");
      } else outcome.state = "completed";
      outcome.retryActive = false;
      finalizeActiveActivity();
      emit();
      return outcome;
    } catch (error) {
      await terminate();
      outcome.state = request.signal?.aborted || this.#disposed ? "cancelled" : "failed";
      outcome.retryActive = false;
      outcome.failure = truncateUtf8(error instanceof Error ? error.message : String(error));
      finalizeActiveActivity();
      emit();
      return outcome;
    } finally {
      stopRefresh();
      removeAbort();
      removeChildListeners();
      this.#terminations.delete(terminate);
      try {
        if (promptDir) await this.#deps.rm(promptDir, { recursive: true, force: true });
      } catch (error) {
        outcome.state = "failed";
        outcome.failure = truncateUtf8(
          `Failed to clean up subagent prompt: ${error instanceof Error ? error.message : String(error)}`,
        );
        emit();
      }
    }
  }

  async shutdown(): Promise<void> {
    this.#disposed = true;
    await Promise.all([...this.#terminations].map((terminate) => terminate()));
    await Promise.all([...this.#runs]);
    this.#terminations.clear();
  }
}
