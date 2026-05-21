import { describe, expect, it } from "vitest";
import { extractPersonalMemoryIdentityContext } from "../index.js";

describe("personal-memory plugin context extraction", () => {
  it("maps trusted plugin tool context fields into a direct subject identity", () => {
    expect(
      extractPersonalMemoryIdentityContext({
        agentId: "pd-one",
        channelProviderId: "mattermost",
        workspaceId: "team-1",
        agentAccountId: "bot-account",
        requesterSenderId: "U123",
        conversationVisibility: "direct",
        deliveryContext: { channel: "mattermost", accountId: "bot-account", to: "U123" },
      }),
    ).toEqual({
      agentId: "pd-one",
      channelProviderId: "mattermost",
      workspaceId: "team-1",
      serverUrlHash: undefined,
      agentAccountId: "bot-account",
      requesterSenderId: "U123",
      requesterSenderName: undefined,
      conversationVisibility: "direct",
    });
  });

  it("falls back to delivery context and session key only for route metadata, not sender identity", () => {
    expect(
      extractPersonalMemoryIdentityContext({
        agentId: "pd-one",
        sessionKey: "agent:pd-one:mattermost:group:C123",
        deliveryContext: { channel: "mattermost", accountId: "bot-account", to: "C123" },
      }),
    ).toMatchObject({
      channelProviderId: "mattermost",
      agentAccountId: "bot-account",
      conversationVisibility: "public_channel",
      requesterSenderId: undefined,
    });
  });
});
