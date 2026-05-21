import path from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { resolvePersonalMemoryConfig } from "./src/config.js";
import type { PersonalMemoryIdentityContext } from "./src/identity.js";
import { createPersonalMemoryPromptHook } from "./src/prompt.js";
import { PersonalMemoryStore } from "./src/store.js";
import { createPersonalMemoryTools } from "./src/tools.js";

export { detectPersonalMemoryCandidate } from "./src/candidates.js";
export { cliDoctorPersonalMemory, cliListPersonalMemory, cliSubjectKey } from "./src/cli.js";
export { resolvePersonalMemoryConfig } from "./src/config.js";
export { handlePersonalMemoryCommand } from "./src/commands.js";
export {
  buildPersonalMemorySubjectKey,
  isPrivateConversation,
  resolvePersonalMemorySubject,
} from "./src/identity.js";
export { renderPersonalMemoryPromptBlock } from "./src/prompt.js";
export { PersonalMemoryStore } from "./src/store.js";
export { createPersonalMemoryTools } from "./src/tools.js";

function stringField(source: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function extractIdentityContext(raw: unknown): PersonalMemoryIdentityContext {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    agentId: stringField(source, ["agentId"]),
    requesterSenderId: stringField(source, ["requesterSenderId", "senderId"]),
    requesterSenderName: stringField(source, ["requesterSenderName", "senderName"]),
    workspaceId: stringField(source, ["workspaceId", "teamId", "serverId"]),
    serverUrlHash: stringField(source, ["serverUrlHash"]),
    agentAccountId: stringField(source, ["agentAccountId", "accountId"]),
    channelProviderId: stringField(source, ["channelProviderId", "providerId", "messageProvider"]),
    conversationVisibility:
      source.conversationVisibility === "direct"
        ? "direct"
        : source.conversationVisibility === "private_channel"
          ? "private_channel"
          : source.conversationVisibility === "public_channel"
            ? "public_channel"
            : source.conversationVisibility === "group"
              ? "group"
              : "unknown",
  };
}

function defaultStateDir(api: OpenClawPluginApi): string | undefined {
  const root = api.config?.runtime?.stateDir;
  return typeof root === "string" ? path.join(root, "personal-memory") : undefined;
}

export default definePluginEntry({
  id: "personal-memory",
  name: "Personal Memory",
  description: "Private per-employee memory profiles keyed from trusted runtime identity.",
  kind: "memory",
  register(api: OpenClawPluginApi) {
    const config = resolvePersonalMemoryConfig(api.pluginConfig, {
      stateDir: defaultStateDir(api),
    });
    if (!config.enabled) {
      return;
    }
    const store = new PersonalMemoryStore({ storePath: config.storePath });

    api.registerTool((ctx) =>
      createPersonalMemoryTools({
        config,
        store,
        context: extractIdentityContext(ctx),
      }),
    );

    api.on(
      "before_prompt_build",
      async (_event, ctx) =>
        createPersonalMemoryPromptHook({
          config,
          store,
          context: extractIdentityContext(ctx),
        }) ?? {},
    );
  },
});
