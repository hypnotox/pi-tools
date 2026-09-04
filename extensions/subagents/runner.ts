import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { StringDecoder } from "node:string_decoder";

export const CHILD_MARKER = "PI_TOOLS_SUBAGENT_CHILD";

const MAX_TEXT_BYTES = 16 * 1024;
const MAX_JSON_LINE_BYTES = 1024 * 1024;
const TERMINATE_GRACE_MS = 1_000;
const FORCE_WAIT_MS = 1_000;
const BLANK_REPORT = "Subagent completed without a text report.";

export interface ExecutionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cacheWrite1h?: number;
  reasoning?: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface RunRequest {
  cwd: string;
  task: string;
  systemPrompt?: string;
  model: { provider: string; id: string };
  thinkingLevel: string;
  tools: string[];
  approved: boolean;
  signal?: AbortSignal;
}

export interface RunOutcome {
  state: "completed" | "failed" | "cancelled";
  report: string;
  failure?: string;
  usage: ExecutionUsage;
}

interface RunnerDependencies {
  spawn?: typeof nodeSpawn;
  mkdtemp?: typeof mkdtemp;
  writeFile?: typeof writeFile;
  rm?: typeof rm;
  executable?: () => { command: string; prefix: string[] };
  signalTree?: (child: ChildProcess, signal: NodeJS.Signals) => void;
  delay?: (milliseconds: number) => Promise<void>;
}

const emptyUsage = (): ExecutionUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function finiteNonnegative(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function usageFrom(value: Record<string, unknown>): ExecutionUsage {
  const usage = emptyUsage();
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const)
    usage[key] = finiteNonnegative(value[key]);
  for (const key of ["cacheWrite1h", "reasoning"] as const)
    if (value[key] !== undefined) usage[key] = finiteNonnegative(value[key]);
  if (value.cost && typeof value.cost === "object") {
    const cost = value.cost as Record<string, unknown>;
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const)
      usage.cost[key] = finiteNonnegative(cost[key]);
  }
  return usage;
}

function addUsage(total: ExecutionUsage, turn: ExecutionUsage): void {
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const)
    total[key] += turn[key];
  for (const key of ["cacheWrite1h", "reasoning"] as const)
    if (turn[key] !== undefined) total[key] = (total[key] ?? 0) + turn[key];
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const)
    total.cost[key] += turn.cost[key];
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

function defaultExecutable(): { command: string; prefix: string[] } {
  const script = process.argv[1];
  if (script && !script.startsWith("/$bunfs/") && /^(node|bun)$/i.test(basename(process.execPath)))
    return { command: process.execPath, prefix: [script] };
  return { command: "pi", prefix: [] };
}

function defaultSignalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

export class SubprocessRunner {
  readonly #deps: Required<RunnerDependencies>;
  readonly #terminations = new Set<() => Promise<void>>();
  readonly #runs = new Set<Promise<void>>();
  #disposed = false;

  constructor(dependencies: RunnerDependencies = {}) {
    this.#deps = {
      spawn: dependencies.spawn ?? nodeSpawn,
      mkdtemp: dependencies.mkdtemp ?? mkdtemp,
      writeFile: dependencies.writeFile ?? writeFile,
      rm: dependencies.rm ?? rm,
      executable: dependencies.executable ?? defaultExecutable,
      signalTree: dependencies.signalTree ?? defaultSignalTree,
      delay:
        dependencies.delay ??
        ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    };
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    let finish = (): void => undefined;
    const tracked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.#runs.add(tracked);
    try {
      return await this.#run(request);
    } finally {
      finish();
      this.#runs.delete(tracked);
    }
  }

  async #run(request: RunRequest): Promise<RunOutcome> {
    const usage = emptyUsage();
    const cancelled = (message: string): RunOutcome => ({
      state: "cancelled",
      report: message,
      failure: message,
      usage,
    });
    if (this.#disposed) return cancelled("Cancelled by shutdown");
    if (request.signal?.aborted) return cancelled("Cancelled before launch");

    let promptDirectory: string | undefined;
    let child: ChildProcess | undefined;
    let removeAbort = (): void => undefined;
    let removeListeners = (): void => undefined;
    let terminate = async (): Promise<void> => undefined;

    try {
      let promptPath: string | undefined;
      if (request.systemPrompt !== undefined) {
        promptDirectory = await this.#deps.mkdtemp(join(tmpdir(), "pi-tools-subagent-"));
        if (this.#disposed || request.signal?.aborted) return cancelled("Cancelled before launch");
        promptPath = join(promptDirectory, "system-prompt.txt");
        await this.#deps.writeFile(promptPath, request.systemPrompt, {
          encoding: "utf8",
          mode: 0o600,
        });
      }
      if (this.#disposed || request.signal?.aborted) return cancelled("Cancelled before launch");

      const executable = this.#deps.executable();
      const args = [
        ...executable.prefix,
        "--mode",
        "json",
        "--print",
        "--no-session",
        "--no-context-files",
        ...(promptPath === undefined ? [] : ["--system-prompt", promptPath]),
        "--model",
        `${request.model.provider}/${request.model.id}`,
        "--thinking",
        request.thinkingLevel,
        ...(request.tools.length > 0 ? ["--tools", request.tools.join(",")] : ["--no-tools"]),
        ...(request.approved ? ["--approve"] : []),
      ];
      child = this.#deps.spawn(executable.command, args, {
        cwd: request.cwd,
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, [CHILD_MARKER]: "1" },
      });

      let settled = false;
      let settleClose: (code: number | null) => void = () => undefined;
      let rejectClose: (error: Error) => void = () => undefined;
      const close = new Promise<number | null>((resolve, reject) => {
        settleClose = (code) => {
          if (settled) return;
          settled = true;
          resolve(code);
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
      terminate = () => {
        if (terminating) return terminating;
        terminating = (async () => {
          if (!child || settled) return;
          this.#deps.signalTree(child, "SIGTERM");
          await Promise.race([close.catch(() => null), this.#deps.delay(TERMINATE_GRACE_MS)]);
          if (!settled) this.#deps.signalTree(child, "SIGKILL");
          await Promise.race([close.catch(() => null), this.#deps.delay(FORCE_WAIT_MS)]);
          if (!settled) settleClose(null);
        })();
        return terminating;
      };
      this.#terminations.add(terminate);

      let transportFailure: string | undefined;
      const stdinError = (error: Error): void => {
        transportFailure = truncateUtf8(`Failed to send subagent task: ${error.message}`);
        void terminate();
      };
      child.stdin?.on("error", stdinError);
      child.stdin?.end(request.task, "utf8");
      const abort = (): void => void terminate();
      request.signal?.addEventListener("abort", abort, { once: true });
      removeAbort = () => request.signal?.removeEventListener("abort", abort);

      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let lineBuffer = "";
      let discardingLine = false;
      let stderr = "";
      let report: string | undefined;
      let assistantFailure: string | undefined;

      const processLine = (line: string): void => {
        if (!line.trim()) return;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (event.type !== "message_end" || !event.message || typeof event.message !== "object")
          return;
        const message = event.message as Record<string, unknown>;
        if (message.role !== "assistant") return;
        if (message.usage && typeof message.usage === "object")
          addUsage(usage, usageFrom(message.usage as Record<string, unknown>));
        const text = Array.isArray(message.content)
          ? message.content
              .flatMap((part) =>
                part &&
                typeof part === "object" &&
                (part as Record<string, unknown>).type === "text"
                  ? [String((part as Record<string, unknown>).text ?? "")]
                  : [],
              )
              .join("")
          : "";
        if (typeof message.errorMessage === "string" && message.errorMessage.trim()) {
          assistantFailure = truncateUtf8(message.errorMessage);
          return;
        }
        assistantFailure = undefined;
        report = truncateUtf8(text.trim() ? text : BLANK_REPORT);
      };

      const feed = (text: string, final = false): void => {
        let remaining = text;
        while (remaining.length > 0) {
          if (discardingLine) {
            const newline = remaining.indexOf("\n");
            if (newline < 0) return;
            remaining = remaining.slice(newline + 1);
            discardingLine = false;
            continue;
          }
          const newline = remaining.indexOf("\n");
          if (newline < 0) {
            lineBuffer += remaining;
            if (Buffer.byteLength(lineBuffer, "utf8") > MAX_JSON_LINE_BYTES) {
              lineBuffer = "";
              discardingLine = true;
            }
            return;
          }
          const line = lineBuffer + remaining.slice(0, newline);
          lineBuffer = "";
          remaining = remaining.slice(newline + 1);
          if (Buffer.byteLength(line, "utf8") <= MAX_JSON_LINE_BYTES) processLine(line);
        }
        if (final && !discardingLine && lineBuffer.trim()) processLine(lineBuffer);
        lineBuffer = "";
        discardingLine = false;
      };

      const stdout = (chunk: Buffer): void => feed(stdoutDecoder.write(chunk));
      const stderrData = (chunk: Buffer): void => {
        stderr = truncateUtf8(stderr + stderrDecoder.write(chunk));
      };
      child.stdout?.on("data", stdout);
      child.stderr?.on("data", stderrData);
      removeListeners = () => {
        child?.stdin?.removeListener("error", stdinError);
        child?.stdout?.removeListener("data", stdout);
        child?.stderr?.removeListener("data", stderrData);
        child?.removeListener("close", settleClose);
        child?.removeListener("error", rejectClose);
      };

      const code = await close;
      feed(stdoutDecoder.end(), true);
      stderr = truncateUtf8(stderr + stderrDecoder.end());
      if (request.signal?.aborted || this.#disposed)
        return cancelled(this.#disposed ? "Cancelled by shutdown" : "Cancelled");
      const failure =
        transportFailure ??
        assistantFailure ??
        (code === 0 ? undefined : stderr || "Child process failed");
      if (failure) return { state: "failed", report: failure, failure, usage };
      return { state: "completed", report: report ?? BLANK_REPORT, usage };
    } catch (error) {
      await terminate();
      const message = truncateUtf8(error instanceof Error ? error.message : String(error));
      if (request.signal?.aborted || this.#disposed)
        return cancelled(this.#disposed ? "Cancelled by shutdown" : "Cancelled");
      return { state: "failed", report: message, failure: message, usage };
    } finally {
      removeAbort();
      removeListeners();
      this.#terminations.delete(terminate);
      if (promptDirectory) {
        try {
          await this.#deps.rm(promptDirectory, { recursive: true, force: true });
        } catch {
          // Prompt cleanup is best-effort and never changes the child outcome.
        }
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
