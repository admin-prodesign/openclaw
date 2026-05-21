import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePersonalMemoryConfig } from "./config.js";
import { resolvePersonalMemorySubject, type PersonalMemoryIdentityContext } from "./identity.js";
import { createPersonalMemoryPromptHook, renderPersonalMemoryPromptBlock } from "./prompt.js";
import { PersonalMemoryStore } from "./store.js";

const roots: string[] = [];
function setup(visibility: PersonalMemoryIdentityContext["conversationVisibility"] = "direct") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-memory-prompt-"));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  const config = resolvePersonalMemoryConfig(
    {
      enabled: true,
      storePath: path.join(root, "memory.sqlite"),
      prompt: { maxItems: 2, maxChars: 240 },
    },
    { homeDir: root },
  );
  const store = new PersonalMemoryStore({ storePath: config.storePath });
  const context: PersonalMemoryIdentityContext = {
    agentId: "pd-one",
    channelProviderId: "mattermost",
    workspaceId: "workspace",
    agentAccountId: "bot",
    requesterSenderId: "user-a",
    conversationVisibility: visibility,
  };
  return { config, store, context };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("personal memory prompt", () => {
  it("injects only current subject entries in direct conversations", () => {
    const deps = setup();
    const subjectA = resolvePersonalMemorySubject(deps.context, deps.config)?.subjectKey ?? "";
    const subjectB = "other-subject";
    deps.store.upsertEntry({
      subjectKey: subjectA,
      category: "preference",
      content: "I prefer concise updates",
    });
    deps.store.upsertEntry({
      subjectKey: subjectB,
      category: "preference",
      content: "Other user secret",
    });
    const block = renderPersonalMemoryPromptBlock(deps);
    expect(block).toContain("private_personal_memory");
    expect(block).toContain("I prefer concise updates");
    expect(block).not.toContain("Other user secret");
    deps.store.close();
  });

  it("does not inject in public group or unknown contexts", () => {
    for (const visibility of ["public_channel", "group", "unknown"] as const) {
      const deps = setup(visibility);
      deps.store.upsertEntry({
        subjectKey: "anything",
        category: "preference",
        content: "private",
      });
      expect(renderPersonalMemoryPromptBlock(deps)).toBeNull();
      expect(createPersonalMemoryPromptHook(deps)).toBeNull();
      deps.store.close();
    }
  });

  it("escapes instruction-like rendering and respects caps", () => {
    const deps = setup();
    const subject = resolvePersonalMemorySubject(deps.context, deps.config)?.subjectKey ?? "";
    deps.store.upsertEntry({
      subjectKey: subject,
      category: "preference",
      content: "Use @here and https://example.com",
    });
    deps.store.upsertEntry({ subjectKey: subject, category: "format", content: "Prefer bullets" });
    deps.store.upsertEntry({
      subjectKey: subject,
      category: "other",
      content: "third item should be capped",
    });
    const block = renderPersonalMemoryPromptBlock(deps) ?? "";
    expect(block).not.toContain("@here");
    expect(block).not.toContain("https://");
    expect(block).toContain("Prefer bullets");
    expect(block).not.toContain("third item should be capped");
    deps.store.close();
  });
});
