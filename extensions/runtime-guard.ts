import { type ExtensionAPI, VERSION } from "@earendil-works/pi-coding-agent";

const MIN_PI_VERSION = "0.81.1";
const NOTICE_KEY = Symbol.for("pi-tools.minimum-runtime-notified");

type RequiredAPI = "on" | "registerTool" | "registerCommand" | "queueCommand";
type QueueingAPI = ExtensionAPI & { queueCommand?(name: string, args?: string): void };

function parseVersion(value: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

export function versionSupported(value: string): boolean {
  const actual = parseVersion(value);
  const minimum = parseVersion(MIN_PI_VERSION);
  if (!actual || !minimum) return false;
  for (const [index, minimumPart] of minimum.entries()) {
    const actualPart = actual[index];
    if (actualPart === undefined) return false;
    if (actualPart !== minimumPart) return actualPart > minimumPart;
  }
  return true;
}

export function guardRuntime(pi: ExtensionAPI, required: readonly RequiredAPI[]): boolean {
  const available: Record<RequiredAPI, boolean> = {
    on: typeof pi.on === "function",
    registerTool: typeof pi.registerTool === "function",
    registerCommand: typeof pi.registerCommand === "function",
    queueCommand: typeof (pi as QueueingAPI).queueCommand === "function",
  };
  const missing = required.filter((api) => !available[api]);
  if (versionSupported(VERSION) && missing.length === 0) return true;
  if (typeof pi.on !== "function") return false;

  pi.on("session_start", (_event, ctx) => {
    const globalState = globalThis as unknown as Record<symbol, unknown>;
    if (globalState[NOTICE_KEY]) return;
    globalState[NOTICE_KEY] = true;
    const missingMessage = missing.length > 0 ? ` Missing APIs: ${missing.join(", ")}.` : "";
    ctx.ui.notify(
      `These extensions require Pi ${MIN_PI_VERSION} or newer; found ${VERSION}.${missingMessage} Upgrade Pi and reload.`,
      "error",
    );
  });
  return false;
}
