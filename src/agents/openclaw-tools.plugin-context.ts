import type { OpenClawConfig } from "../config/config.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import type { GatewayMessageChannel } from "../utils/message-channel.js";
import { resolveAgentWorkspaceDir, resolveSessionAgentId } from "./agent-scope.js";
import { resolveWorkspaceRoot } from "./workspace-dir.js";

export type OpenClawPluginToolOptions = {
  agentSessionKey?: string;
  agentChannel?: GatewayMessageChannel;
  agentAccountId?: string;
  agentTo?: string;
  agentThreadId?: string | number;
  agentDir?: string;
  workspaceDir?: string;
  config?: OpenClawConfig;
  requesterSenderId?: string | null;
  senderIsOwner?: boolean;
  agentGroupId?: string | null;
  agentGroupSpace?: string | null;
  currentChannelId?: string | null;
  sessionId?: string;
  sandboxBrowserBridgeUrl?: string;
  allowHostBrowserControl?: boolean;
  sandboxed?: boolean;
  allowGatewaySubagentBinding?: boolean;
};

function resolveConversationVisibility(params: {
  sessionKey?: string;
  groupId?: string | null;
}): "direct" | "private_channel" | "public_channel" | "group" | "unknown" {
  if (params.groupId?.trim()) {
    return "public_channel";
  }
  const lower = params.sessionKey?.toLowerCase() ?? "";
  if (lower.includes(":direct:")) {
    return "direct";
  }
  if (lower.includes(":group:")) {
    return "public_channel";
  }
  return "unknown";
}

export function resolveOpenClawPluginToolInputs(params: {
  options?: OpenClawPluginToolOptions;
  resolvedConfig?: OpenClawConfig;
  runtimeConfig?: OpenClawConfig;
}) {
  const { options, resolvedConfig, runtimeConfig } = params;
  const sessionAgentId = resolveSessionAgentId({
    sessionKey: options?.agentSessionKey,
    config: resolvedConfig,
  });
  const inferredWorkspaceDir =
    options?.workspaceDir || !resolvedConfig
      ? undefined
      : resolveAgentWorkspaceDir(resolvedConfig, sessionAgentId);
  const workspaceDir = resolveWorkspaceRoot(options?.workspaceDir ?? inferredWorkspaceDir);
  const deliveryContext = normalizeDeliveryContext({
    channel: options?.agentChannel,
    to: options?.agentTo,
    accountId: options?.agentAccountId,
    threadId: options?.agentThreadId,
  });

  return {
    context: {
      config: options?.config,
      runtimeConfig,
      workspaceDir,
      agentDir: options?.agentDir,
      agentId: sessionAgentId,
      sessionKey: options?.agentSessionKey,
      sessionId: options?.sessionId,
      browser: {
        sandboxBridgeUrl: options?.sandboxBrowserBridgeUrl,
        allowHostControl: options?.allowHostBrowserControl,
      },
      messageChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      deliveryContext,
      requesterSenderId: options?.requesterSenderId ?? undefined,
      channelProviderId: options?.agentChannel,
      workspaceId: options?.agentGroupSpace ?? undefined,
      currentChannelId: options?.currentChannelId ?? undefined,
      conversationVisibility: resolveConversationVisibility({
        sessionKey: options?.agentSessionKey,
        groupId: options?.agentGroupId,
      }),
      senderIsOwner: options?.senderIsOwner ?? undefined,
      sandboxed: options?.sandboxed,
    },
    allowGatewaySubagentBinding: options?.allowGatewaySubagentBinding,
  };
}
