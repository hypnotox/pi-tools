import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import {
  CHILD_MARKER,
  type ConcreteModel,
  type ExecutionActivity,
  type ExecutionOutcome,
  type PreparedRun,
  type ThinkingLevel,
} from "./api.js";

const MAX_TEXT_BYTES = 16 * 1024;
const MAX_ACTIVITY = 32;

export interface RunnerDependencies {
  spawn?: typeof nodeSpawn;
  canonicalize?: (path: string) => Promise<string>;
  mkdtemp?: typeof mkdtemp;
  writeFile?: typeof writeFile;
  rm?: typeof rm;
  executable?: () => { command: string; prefix: string[] };
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
}

function truncate(value: string, limit = MAX_TEXT_BYTES): string {
  if (Buffer.byteLength(value, "utf8") <= limit) return value;
  let output = value;
  while (Buffer.byteLength(output, "utf8") > limit - 16) output = output.slice(0, -1);
  return `${output}…[truncated]`;
}

function initialOutcome(): ExecutionOutcome {
  return {
    state: "completed",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    activity: [],
    omittedActivity: 0,
    retries: 0,
  };
}

function defaultExecutable(): { command: string; prefix: string[] } {
  const script = process.argv[1];
  if (
    script &&
    !script.startsWith("/$bunfs/") &&
    basename(process.execPath).match(/^(node|bun)(\.exe)?$/i)
  ) {
    return { command: process.execPath, prefix: [script] };
  }
  return { command: "pi", prefix: [] };
}

function isDescendant(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !path.includes("/../"));
}

export class SubprocessRunner {
  #deps: Required<RunnerDependencies>;
  #children = new Set<ChildProcess>();

  constructor(deps: RunnerDependencies = {}) {
    this.#deps = {
      spawn: deps.spawn ?? nodeSpawn,
      canonicalize: deps.canonicalize ?? realpath,
      mkdtemp: deps.mkdtemp ?? mkdtemp,
      writeFile: deps.writeFile ?? writeFile,
      rm: deps.rm ?? rm,
      executable: deps.executable ?? defaultExecutable,
    };
  }

  async run(request: RunRequest): Promise<ExecutionOutcome> {
    if (request.signal?.aborted)
      return { ...initialOutcome(), state: "cancelled", failure: "Cancelled before launch" };
    const outcome = initialOutcome();
    const childCwd = await this.#deps.canonicalize(resolve(request.prepared.cwd));
    const parentCwd = await this.#deps.canonicalize(resolve(request.parentCwd));
    const promptDir = await this.#deps.mkdtemp(join(tmpdir(), "pi-tools-subagent-"));
    const promptPath = join(promptDir, "prompt.txt");
    let child: ChildProcess | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const activity = (kind: ExecutionActivity["kind"], text: string): void => {
      if (outcome.activity.length < MAX_ACTIVITY)
        outcome.activity.push({ kind, text: truncate(text, 1024) });
      else outcome.omittedActivity++;
      request.onUpdate?.(outcome);
    };
    try {
      await this.#deps.writeFile(promptPath, request.prepared.prompt, {
        encoding: "utf8",
        mode: 0o600,
      });
      const invocation = this.#deps.executable();
      const args = [
        ...invocation.prefix,
        "--mode",
        "json",
        "--print",
        "--no-session",
        "--no-context-files",
        "--no-skills",
        "--append-system-prompt",
        promptPath,
        "--model",
        `${request.model.provider}/${request.model.id}`,
        "--thinking",
        request.thinkingLevel,
        "--tools",
        request.tools.join(","),
        request.prepared.prompt,
      ];
      if (request.parentTrusted && isDescendant(parentCwd, childCwd)) args.push("--approve");
      child = this.#deps.spawn(invocation.command, args, {
        cwd: childCwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, [CHILD_MARKER]: "1" },
      });
      this.#children.add(child);
      let stdout = "";
      let stderr = "";
      const terminate = (): void => {
        if (!child || child.killed) return;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child?.kill("SIGKILL"), 1_000);
      };
      request.signal?.addEventListener("abort", terminate, { once: true });
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = truncate(stdout + chunk.toString("utf8"));
        let newline = stdout.indexOf("\n");
        while (newline >= 0) {
          const line = stdout.slice(0, newline);
          stdout = stdout.slice(newline + 1);
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            if (event.type === "tool_execution_start")
              activity("tool_start", String(event.toolName ?? "tool"));
            else if (event.type === "tool_execution_end")
              activity("tool_end", String(event.toolName ?? "tool"));
            else if (event.type === "auto_retry_start") {
              outcome.retries++;
              activity("retry_start", "request retry");
            } else if (event.type === "auto_retry_end")
              activity("retry_end", "request retry complete");
            else if (event.type === "message_end") {
              const message = event.message as
                | {
                    role?: string;
                    content?: Array<{ type?: string; text?: string }>;
                    usage?: Record<string, unknown>;
                    errorMessage?: string;
                  }
                | undefined;
              if (message?.role === "assistant") {
                outcome.report = truncate(
                  message.content
                    ?.filter((part) => part.type === "text")
                    .map((part) => part.text ?? "")
                    .join("") ?? "",
                );
                const usage = message.usage;
                if (usage)
                  for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const)
                    outcome.usage[key] += Number(usage[key] ?? 0);
                if (usage && typeof usage.cost === "object" && usage.cost)
                  outcome.usage.cost += Number((usage.cost as { total?: unknown }).total ?? 0);
                if (message.errorMessage) outcome.failure = truncate(message.errorMessage);
              }
            }
          } catch {
            /* malformed child output is intentionally ignored */
          }
          newline = stdout.indexOf("\n");
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = truncate(stderr + chunk.toString("utf8"));
      });
      const code = await new Promise<number | null>((resolveClose, reject) => {
        child?.once("close", resolveClose);
        child?.once("error", reject);
      });
      if (request.signal?.aborted) {
        outcome.state = "cancelled";
        outcome.failure = "Cancelled";
      } else if (code !== 0 || outcome.failure) {
        outcome.state = "failed";
        outcome.failure = outcome.failure ?? truncate(stderr || "Child process failed");
      }
      return outcome;
    } catch (error) {
      outcome.state = request.signal?.aborted ? "cancelled" : "failed";
      outcome.failure = truncate(error instanceof Error ? error.message : String(error));
      return outcome;
    } finally {
      if (killTimer) clearTimeout(killTimer);
      if (child) this.#children.delete(child);
      await this.#deps.rm(promptDir, { recursive: true, force: true });
    }
  }

  shutdown(): void {
    for (const child of this.#children) child.kill("SIGTERM");
    this.#children.clear();
  }
}
