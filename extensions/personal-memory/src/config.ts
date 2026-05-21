import os from "node:os";
import path from "node:path";

export type PersonalMemoryConfig = {
  enabled: boolean;
  storePath: string;
  scopeId: string;
  allowSharedScope: boolean;
  readsRequirePrivateConversation: boolean;
  acknowledgeInstalledPluginTrustBoundary: boolean;
  experimentalAutoCaptureAcknowledge: boolean;
  storeRawIdentityForRepair: boolean;
  atRestEncryption: boolean;
  prompt: {
    maxItems: number;
    maxChars: number;
  };
  autoCapture: {
    enabled: boolean;
    suggestOnly: boolean;
  };
  admin: {
    allowOwnerInspect: boolean;
  };
};

export type PersonalMemoryConfigOptions = {
  homeDir?: string;
  stateDir?: string;
  hasUntrustedPromptHooks?: boolean;
};

type RawRecord = Record<string, unknown>;

const DEFAULT_SCOPE_ID = "agent:{agentId}";
const DEFAULT_PROMPT_MAX_ITEMS = 12;
const DEFAULT_PROMPT_MAX_CHARS = 1800;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function defaultStorePath(options: PersonalMemoryConfigOptions): string {
  if (options.stateDir && path.isAbsolute(options.stateDir)) {
    return path.resolve(options.stateDir, "personal-memory.sqlite");
  }
  return path.resolve(options.homeDir ?? os.homedir(), ".openclaw", "personal-memory.sqlite");
}

function expandStorePath(storePath: string, options: PersonalMemoryConfigOptions): string {
  if (storePath === "~") {
    return options.homeDir ?? os.homedir();
  }
  if (storePath.startsWith("~/")) {
    return path.resolve(options.homeDir ?? os.homedir(), storePath.slice(2));
  }
  return path.resolve(storePath);
}

function isSharedScope(scopeId: string): boolean {
  const trimmed = scopeId.trim();
  const normalized = trimmed.toLowerCase();
  return (
    !trimmed.includes("{agentId}") ||
    normalized === "shared" ||
    normalized.startsWith("shared:") ||
    normalized === "global"
  );
}

export function resolvePersonalMemoryConfig(
  rawConfig: unknown,
  options: PersonalMemoryConfigOptions = {},
): PersonalMemoryConfig {
  const raw = isRecord(rawConfig) ? rawConfig : {};
  const rawPrompt = isRecord(raw.prompt) ? raw.prompt : {};
  const rawAutoCapture = isRecord(raw.autoCapture) ? raw.autoCapture : {};
  const rawAdmin = isRecord(raw.admin) ? raw.admin : {};

  const enabled = booleanValue(raw.enabled, false);
  const scopeId = stringValue(raw.scopeId, DEFAULT_SCOPE_ID).trim();
  const storePathInput = stringValue(raw.storePath, defaultStorePath(options));
  const storePath = expandStorePath(storePathInput, options);

  const config: PersonalMemoryConfig = {
    enabled,
    storePath,
    scopeId,
    allowSharedScope: booleanValue(raw.allowSharedScope, false),
    readsRequirePrivateConversation: booleanValue(raw.readsRequirePrivateConversation, true),
    acknowledgeInstalledPluginTrustBoundary: booleanValue(
      raw.acknowledgeInstalledPluginTrustBoundary,
      false,
    ),
    experimentalAutoCaptureAcknowledge: booleanValue(raw.experimentalAutoCaptureAcknowledge, false),
    storeRawIdentityForRepair: booleanValue(raw.storeRawIdentityForRepair, false),
    atRestEncryption: booleanValue(raw.atRestEncryption, false),
    prompt: {
      maxItems: clamp(numberValue(rawPrompt.maxItems, DEFAULT_PROMPT_MAX_ITEMS), 1, 50),
      maxChars: clamp(numberValue(rawPrompt.maxChars, DEFAULT_PROMPT_MAX_CHARS), 200, 5000),
    },
    autoCapture: {
      enabled: booleanValue(rawAutoCapture.enabled, false),
      suggestOnly: booleanValue(rawAutoCapture.suggestOnly, true),
    },
    admin: {
      allowOwnerInspect: booleanValue(rawAdmin.allowOwnerInspect, false),
    },
  };

  if (!config.scopeId) {
    throw new Error("personal-memory config requires a non-empty scopeId");
  }

  if (enabled && !path.isAbsolute(storePathInput) && !storePathInput.startsWith("~/")) {
    throw new Error("personal-memory enabled config requires an absolute storePath");
  }

  if (enabled && !config.readsRequirePrivateConversation) {
    throw new Error("personal-memory MVP requires readsRequirePrivateConversation: true");
  }

  if (enabled && config.autoCapture.enabled && !config.experimentalAutoCaptureAcknowledge) {
    throw new Error(
      "personal-memory autoCapture.enabled requires experimentalAutoCaptureAcknowledge: true",
    );
  }

  if (enabled && isSharedScope(config.scopeId) && !config.allowSharedScope) {
    throw new Error("personal-memory shared scope requires allowSharedScope: true");
  }

  if (
    enabled &&
    options.hasUntrustedPromptHooks &&
    !config.acknowledgeInstalledPluginTrustBoundary
  ) {
    throw new Error(
      "personal-memory installed prompt/model hooks require acknowledgeInstalledPluginTrustBoundary: true",
    );
  }

  return config;
}
