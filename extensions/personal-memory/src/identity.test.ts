import { describe, expect, it } from "vitest";
import { resolvePersonalMemoryConfig } from "./config.js";
import {
  buildPersonalMemorySubjectKey,
  isPrivateConversation,
  resolvePersonalMemorySubject,
} from "./identity.js";

const config = resolvePersonalMemoryConfig({
  enabled: true,
  storePath: "/tmp/personal-memory.sqlite",
});

const directContext = {
  agentId: "pd-one",
  requesterSenderId: "user-a",
  workspaceId: "mattermost-main",
  agentAccountId: "bot-1",
  channelProviderId: "mattermost",
  conversationVisibility: "direct" as const,
};

describe("personal memory identity", () => {
  it("produces different subject keys across workspaces, bot accounts, providers, senders, and scopes", () => {
    const base = resolvePersonalMemorySubject(directContext, config, { requirePrivate: true });
    expect(base?.subjectKey).toBeTruthy();

    const variants = [
      { ...directContext, workspaceId: "mattermost-other" },
      { ...directContext, agentAccountId: "bot-2" },
      { ...directContext, channelProviderId: "discord" },
      { ...directContext, requesterSenderId: "user-b" },
      { ...directContext, agentId: "pd-two" },
    ].map((ctx) => resolvePersonalMemorySubject(ctx, config, { requirePrivate: true })?.subjectKey);

    expect(new Set([base?.subjectKey, ...variants]).size).toBe(variants.length + 1);
  });

  it("canonicalizes tuple components deterministically", () => {
    const left = buildPersonalMemorySubjectKey({
      scopeId: " agent:pd-one ",
      channelProviderId: " mattermost ",
      workspaceId: " workspace ",
      agentAccountId: " bot ",
      senderId: " user ",
    });
    const right = buildPersonalMemorySubjectKey({
      scopeId: "agent:pd-one",
      channelProviderId: "mattermost",
      workspaceId: "workspace",
      agentAccountId: "bot",
      senderId: "user",
    });

    expect(left).toBe(right);
  });

  it("does not collapse opaque ids by case or delimiter collisions", () => {
    const upper = buildPersonalMemorySubjectKey({
      scopeId: "agent:pd-one",
      channelProviderId: "mattermost",
      workspaceId: "workspace",
      agentAccountId: "bot",
      senderId: "UserA",
    });
    const lower = buildPersonalMemorySubjectKey({
      scopeId: "agent:pd-one",
      channelProviderId: "mattermost",
      workspaceId: "workspace",
      agentAccountId: "bot",
      senderId: "usera",
    });
    expect(upper).not.toBe(lower);

    const left = buildPersonalMemorySubjectKey({
      scopeId: "agent:pd-one\u001fmattermost",
      channelProviderId: "workspace",
      workspaceId: "bot",
      agentAccountId: "sender",
      senderId: "tail",
    });
    const right = buildPersonalMemorySubjectKey({
      scopeId: "agent:pd-one",
      channelProviderId: "mattermost",
      workspaceId: "workspace",
      agentAccountId: "bot",
      senderId: "sender\u001ftail",
    });
    expect(left).not.toBe(right);
  });

  it("does not use display name as identity", () => {
    const a = resolvePersonalMemorySubject(
      { ...directContext, requesterSenderId: "id-a", requesterSenderName: "Andy" },
      config,
      { requirePrivate: true },
    );
    const b = resolvePersonalMemorySubject(
      { ...directContext, requesterSenderId: "id-b", requesterSenderName: "Andy" },
      config,
      { requirePrivate: true },
    );
    expect(a?.subjectKey).not.toBe(b?.subjectKey);
  });

  it("fails closed when trusted identity or required private visibility is missing", () => {
    for (const patch of [
      { requesterSenderId: undefined },
      { workspaceId: undefined },
      { agentAccountId: undefined },
      { agentId: undefined },
      { channelProviderId: undefined },
      { conversationVisibility: "public_channel" as const },
      { conversationVisibility: "group" as const },
      { conversationVisibility: "unknown" as const },
    ]) {
      expect(
        resolvePersonalMemorySubject({ ...directContext, ...patch }, config, {
          requirePrivate: true,
        }),
      ).toBeNull();
    }
  });

  it("allows only direct conversations as private in the MVP", () => {
    expect(isPrivateConversation({ conversationVisibility: "direct" })).toBe(true);
    expect(isPrivateConversation({ conversationVisibility: "private_channel" })).toBe(false);
    expect(isPrivateConversation({ conversationVisibility: "public_channel" })).toBe(false);
  });

  it("requires private visibility by default", () => {
    expect(
      resolvePersonalMemorySubject(
        { ...directContext, conversationVisibility: "public_channel" },
        config,
      ),
    ).toBeNull();
  });

  it("ignores model/tool params attempting to specify another user", () => {
    const subject = resolvePersonalMemorySubject(
      { ...directContext, params: { senderId: "victim-user" } },
      config,
      { requirePrivate: true },
    );

    const expected = resolvePersonalMemorySubject(directContext, config, { requirePrivate: true });
    expect(subject?.subjectKey).toBe(expected?.subjectKey);
    expect(subject?.senderId).toBe("user-a");
  });
});
