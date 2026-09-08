import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createProvider } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/compat";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type ExtensionAPI,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

export async function contextRuntime(
  options: {
    extensions?: string[];
    factory?: (pi: ExtensionAPI) => void;
    mode?: "tui" | "rpc";
    keepRecentTokens?: number;
    autoCompaction?: boolean;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "pi-tools-context-"));
  mkdirSync(join(directory, "sessions"));
  writeFileSync(
    join(directory, "settings.json"),
    JSON.stringify({
      compaction: {
        enabled: options.autoCompaction ?? false,
        keepRecentTokens: options.keepRecentTokens ?? 100,
      },
      retry: { enabled: false },
    }),
  );
  const faux = createFauxCore({
    provider: "pi-tools-context-faux",
    models: [{ id: "test", contextWindow: 100_000 }],
  });
  const model = faux.getModel("test");
  if (!model) throw new Error("Missing faux model");
  const provider = createProvider({
    id: faux.provider,
    auth: {
      apiKey: {
        name: "test",
        resolve: async () => ({ auth: { apiKey: "fixture" }, source: "fixture" }),
      },
    },
    models: faux.models,
    api: { stream: faux.stream, streamSimple: faux.streamSimple },
  });
  const errors: unknown[] = [];
  let generations = 0;
  const runtime = await createAgentSessionRuntime(
    async ({ cwd, sessionManager, sessionStartEvent }) => {
      generations++;
      const services = await createAgentSessionServices({
        cwd,
        agentDir: directory,
        resourceLoaderOptions: {
          additionalExtensionPaths: (options.extensions ?? []).map((path) => resolve(path)),
          extensionFactories: [
            (pi) => {
              pi.registerProvider(provider);
              options.factory?.(pi);
            },
          ],
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
        },
      });
      await services.modelRuntime.setRuntimeApiKey(faux.provider, "fixture");
      return {
        ...(await createAgentSessionFromServices({
          services,
          sessionManager,
          model,
          ...(sessionStartEvent ? { sessionStartEvent } : {}),
        })),
        services,
        diagnostics: services.diagnostics,
      };
    },
    {
      cwd: directory,
      agentDir: directory,
      sessionManager: SessionManager.create(directory, join(directory, "sessions")),
    },
  );
  const rebind = async () => {
    const session = runtime.session;
    await session.bindExtensions({
      mode: options.mode ?? "rpc",
      onError: (error) => errors.push(error),
      uiContext: {
        ...session.extensionRunner.getUIContext(),
        notify: (...args) => {
          errors.push(args);
        },
      },
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        newSession: (options) => runtime.newSession(options),
        fork: (id, options) => runtime.fork(id, options),
        navigateTree: (id, options) => session.navigateTree(id, options),
        switchSession: (path, options) => runtime.switchSession(path, options),
        reload: () => session.reload(),
      },
    });
  };
  runtime.setRebindSession(rebind);
  await rebind();
  return {
    runtime,
    faux,
    errors,
    generations: () => generations,
    async dispose() {
      await runtime.dispose();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
