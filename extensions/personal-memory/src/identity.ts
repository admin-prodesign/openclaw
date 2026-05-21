import { createHash } from "node:crypto";
import type { PersonalMemoryConfig } from "./config.js";

export type ConversationVisibility =
  | "direct"
  | "private_channel"
  | "public_channel"
  | "group"
  | "unknown";

export type PersonalMemoryIdentityContext = {
  agentId?: string | null;
  requesterSenderId?: string | null;
  requesterSenderName?: string | null;
  workspaceId?: string | null;
  serverUrlHash?: string | null;
  agentAccountId?: string | null;
  channelProviderId?: string | null;
  conversationVisibility?: ConversationVisibility | null;
  params?: unknown;
};

export type PersonalMemorySubjectTuple = {
  scopeId: string;
  channelProviderId: string;
  workspaceId: string;
  agentAccountId: string;
  senderId: string;
};

export type PersonalMemorySubject = PersonalMemorySubjectTuple & {
  subjectKey: string;
  displayName?: string;
};

export type ResolvePersonalMemorySubjectOptions = {
  requirePrivate?: boolean;
};

function normalizeComponent(value: string): string {
  return value.trim();
}

function requiredComponent(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeComponent(value);
  return normalized.length > 0 ? normalized : null;
}

export function canonicalPersonalMemorySubjectTuple(tuple: PersonalMemorySubjectTuple): string {
  return JSON.stringify(
    [
      tuple.scopeId,
      tuple.channelProviderId,
      tuple.workspaceId,
      tuple.agentAccountId,
      tuple.senderId,
    ].map(normalizeComponent),
  );
}

export function buildPersonalMemorySubjectKey(tuple: PersonalMemorySubjectTuple): string {
  return createHash("sha256").update(canonicalPersonalMemorySubjectTuple(tuple)).digest("hex");
}

export function isPrivateConversation(
  ctx: Pick<PersonalMemoryIdentityContext, "conversationVisibility">,
): boolean {
  return ctx.conversationVisibility === "direct";
}

function resolveScopeId(scopeTemplate: string, ctx: PersonalMemoryIdentityContext): string | null {
  const agentId = requiredComponent(ctx.agentId);
  if (scopeTemplate.includes("{agentId}") && !agentId) {
    return null;
  }
  const resolved = scopeTemplate.replaceAll("{agentId}", agentId ?? "");
  return requiredComponent(resolved);
}

export function resolvePersonalMemorySubject(
  ctx: PersonalMemoryIdentityContext,
  config: PersonalMemoryConfig,
  options: ResolvePersonalMemorySubjectOptions = { requirePrivate: true },
): PersonalMemorySubject | null {
  if (!config.enabled) {
    return null;
  }

  const requirePrivate = options.requirePrivate ?? true;
  if (requirePrivate && config.readsRequirePrivateConversation && !isPrivateConversation(ctx)) {
    return null;
  }

  const scopeId = resolveScopeId(config.scopeId, ctx);
  const channelProviderId = requiredComponent(ctx.channelProviderId);
  const workspaceId = requiredComponent(ctx.workspaceId ?? ctx.serverUrlHash);
  const agentAccountId = requiredComponent(ctx.agentAccountId);
  const senderId = requiredComponent(ctx.requesterSenderId);

  if (!scopeId || !channelProviderId || !workspaceId || !agentAccountId || !senderId) {
    return null;
  }

  const tuple: PersonalMemorySubjectTuple = {
    scopeId,
    channelProviderId,
    workspaceId,
    agentAccountId,
    senderId,
  };

  const displayName =
    typeof ctx.requesterSenderName === "string" ? ctx.requesterSenderName.trim() : "";

  return {
    ...tuple,
    subjectKey: buildPersonalMemorySubjectKey(tuple),
    ...(displayName ? { displayName } : {}),
  };
}
