import { describe, expect, it } from "vitest";
import { detectPersonalMemoryCandidate } from "./candidates.js";

describe("personal memory candidates", () => {
  it("detects stable direct-message preferences without writing", () => {
    expect(
      detectPersonalMemoryCandidate("I prefer bullet summaries", {
        conversationVisibility: "direct",
      }),
    ).toMatchObject({
      category: "format",
      suggestOnly: true,
    });
    expect(
      detectPersonalMemoryCandidate("記住我偏好中文", { conversationVisibility: "direct" }),
    ).toMatchObject({
      category: "language",
      suggestOnly: true,
    });
  });

  it("does not suggest one-time status or sensitive/public content", () => {
    expect(
      detectPersonalMemoryCandidate("The task is done", { conversationVisibility: "direct" }),
    ).toBeNull();
    expect(
      detectPersonalMemoryCandidate("remember that my salary is 100", {
        conversationVisibility: "direct",
      }),
    ).toBeNull();
    expect(
      detectPersonalMemoryCandidate("I prefer bullet summaries", {
        conversationVisibility: "public_channel",
      }),
    ).toBeNull();
  });
});
