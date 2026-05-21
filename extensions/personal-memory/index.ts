import os from "node:os";
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

function nestedStringField(
  source: Record<string, unknown>,
  objectName: string,
  names: string[],
): string | undefined {
  const nested = source[objectName];
  if (typeof nested !== "object" || nested === null) {
    return undefined;
  }
  return stringField(nested as Record<string, unknown>, names);
}

function inferConversationVisibility(
  source: Record<string, unknown>,
): PersonalMemoryIdentityContext["conversationVisibility"] {
  const explicit = source.conversationVisibility;
  if (
    explicit === "direct" ||
    explicit === "private_channel" ||
    explicit === "public_channel" ||
    explicit === "group"
  ) {
    return explicit;
  }
  const sessionKey = stringField(source, ["sessionKey"]);
  const lower = sessionKey?.toLowerCase() ?? "";
  if (lower.includes(":direct:")) {
    return "direct";
  }
  if (lower.includes(":group:")) {
    return "public_channel";
  }
  return "unknown";
}

export function extractPersonalMemoryIdentityContext(raw: unknown): PersonalMemoryIdentityContext {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    agentId: stringField(source, ["agentId"]),
    requesterSenderId: stringField(source, ["requesterSenderId"]),
    requesterSenderName: stringField(source, ["requesterSenderName", "senderName"]),
    workspaceId: stringField(source, ["workspaceId", "teamId", "serverId"]),
    serverUrlHash: stringField(source, ["serverUrlHash"]),
    agentAccountId:
      stringField(source, ["agentAccountId", "accountId"]) ??
      nestedStringField(source, "deliveryContext", ["accountId"]),
    channelProviderId:
      stringField(source, [
        "channelProviderId",
        "providerId",
        "messageProvider",
        "messageChannel",
      ]) ?? nestedStringField(source, "deliveryContext", ["channel"]),
    conversationVisibility: inferConversationVisibility(source),
  };
}

function defaultStateDir(api: OpenClawPluginApi): string | undefined {
  void api;
  const root = process.env.OPENCLAW_STATE_DIR ?? path.join(os.homedir(), ".openclaw");
  return path.join(root, "personal-memory");
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
        context: extractPersonalMemoryIdentityContext(ctx),
      }),
    );

    api.on(
      "before_prompt_build",
      async (_event, ctx) =>
        createPersonalMemoryPromptHook({
          config,
          store,
          context: extractPersonalMemoryIdentityContext(ctx),
        }) ?? {},
    );
  },
});
