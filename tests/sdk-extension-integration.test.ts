import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";

describe("public Pi SDK extension loading", () => {
  it("loads an inline extension and exposes its registered tool without credentials", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-tools-sdk-cwd-"));
    const agentDir = await mkdtemp(join(tmpdir(), "pi-tools-sdk-agent-"));
    const settingsManager = SettingsManager.inMemory();
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        {
          name: "sdk-proof",
          factory: (pi) => {
            pi.registerTool({
              name: "sdk_proof",
              label: "SDK proof",
              description: "Proves public extension registration.",
              parameters: Type.Object({}),
              execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
            });
          },
        },
      ],
    });

    try {
      await loader.reload();
      expect(loader.getExtensions().errors).toEqual([]);
      const { session, extensionsResult } = await createAgentSession({
        cwd,
        agentDir,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(cwd),
        settingsManager,
        noTools: "builtin",
      });
      try {
        expect(extensionsResult.errors).toEqual([]);
        expect(session.agent.state.tools.map((tool) => tool.name)).toContain("sdk_proof");
      } finally {
        session.dispose();
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});
