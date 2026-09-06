import { basename } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
export const SPINNER_INTERVAL_MS = 120;

interface BoundTitle {
  ui: ExtensionUIContext;
  originalSetTitle: (title: string) => void;
  wrappedSetTitle: (title: string) => void;
  baseTitle: string;
  customTitle: boolean;
}

function defaultTitle(pi: ExtensionAPI, cwd: string): string {
  const project = basename(cwd);
  const session = pi.getSessionName();
  return session ? `π - ${session} - ${project}` : `π - ${project}`;
}

export function registerWorkingTitle(pi: ExtensionAPI): void {
  let bound: BoundTitle | undefined;
  let agentWorking = false;
  let compacting = false;
  let spinnerTick = 0;
  let spinnerTimer: ReturnType<typeof setInterval> | undefined;

  const isWorking = (): boolean => agentWorking || compacting;

  const paint = (): void => {
    if (!bound) return;
    // Bypass our wrapper so an animation frame never becomes the next base title.
    const title = isWorking()
      ? `${SPINNER_FRAMES[spinnerTick % SPINNER_FRAMES.length]} ${bound.baseTitle}`
      : bound.baseTitle;
    bound.originalSetTitle.call(bound.ui, title);
  };

  const stopTimer = (): void => {
    if (!spinnerTimer) return;
    clearInterval(spinnerTimer);
    spinnerTimer = undefined;
    spinnerTick = 0;
  };

  const refresh = (): void => {
    if (!bound) return;
    if (isWorking()) {
      if (!spinnerTimer) {
        spinnerTimer = setInterval(() => {
          spinnerTick += 1;
          paint();
        }, SPINNER_INTERVAL_MS);
        spinnerTimer.unref?.();
      }
    } else {
      stopTimer();
    }
    paint();
  };

  const bind = (context: ExtensionContext): void => {
    if (context.mode !== "tui") return;
    const ui = context.ui;
    // Every event context resolves to Pi's shared extension UI object. Wrapping
    // its setter lets independently loaded title owners remain composable.
    const originalSetTitle = ui.setTitle;
    const wrappedSetTitle = (title: string): void => {
      if (!bound || bound.ui !== ui) {
        originalSetTitle.call(ui, title);
        return;
      }
      bound.baseTitle = title;
      bound.customTitle = true;
      paint();
    };
    bound = {
      ui,
      originalSetTitle,
      wrappedSetTitle,
      baseTitle: defaultTitle(pi, context.cwd),
      customTitle: false,
    };
    ui.setTitle = wrappedSetTitle;
  };

  const setAgentWorking = (working: boolean): void => {
    agentWorking = working;
    refresh();
  };

  const setCompacting = (working: boolean): void => {
    compacting = working;
    refresh();
  };

  pi.on("session_start", (_event, context) => bind(context));
  pi.on("session_info_changed", (_event, context) => {
    if (!bound || bound.customTitle) return;
    bound.baseTitle = defaultTitle(pi, context.cwd);
    paint();
  });
  // agent_settled, unlike agent_end, includes retries, compaction retries, and
  // queued continuations in the same uninterrupted working span.
  pi.on("agent_start", () => setAgentWorking(true));
  pi.on("agent_settled", () => setAgentWorking(false));
  pi.on("session_before_compact", () => setCompacting(true));
  pi.on("session_compact", () => setCompacting(false));
  pi.on("session_compact_failed", () => setCompacting(false));
  pi.on("session_shutdown", () => {
    agentWorking = false;
    compacting = false;
    stopTimer();
    if (!bound) return;
    const { ui, originalSetTitle, wrappedSetTitle, baseTitle } = bound;
    bound = undefined;
    if (ui.setTitle === wrappedSetTitle) ui.setTitle = originalSetTitle;
    originalSetTitle.call(ui, baseTitle);
  });
}

export default function workingTitleExtension(pi: ExtensionAPI): void {
  registerWorkingTitle(pi);
}
