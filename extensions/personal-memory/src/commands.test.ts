import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handlePersonalMemoryCommand } from "./commands.js";
import { resolvePersonalMemoryConfig } from "./config.js";
import type { PersonalMemoryIdentityContext } from "./identity.js";
import { PersonalMemoryStore } from "./store.js";

const roots: string[] = [];
function setup(visibility: PersonalMemoryIdentityContext["conversationVisibility"] = "direct") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-memory-command-"));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  const config = resolvePersonalMemoryConfig(
    { enabled: true, storePath: path.join(root, "memory.sqlite") },
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

describe("personal memory commands", () => {
  it("handles remember list and forget in direct contexts", () => {
    const deps = setup();
    const save = handlePersonalMemoryCommand(deps, "remember that I prefer Friday summaries");
    expect(save).toMatchObject({ handled: true, persistent: false });
    const list = handlePersonalMemoryCommand(deps, "What do you remember about me?");
    expect(list).toMatchObject({ handled: true, persistent: false });
    if (list.handled) {
      expect(list.response).toContain("Friday summaries");
    }
    const forget = handlePersonalMemoryCommand(deps, "forget Friday summaries");
    expect(forget).toMatchObject({ handled: true, response: "Forgot that private memory." });
    deps.store.close();
  });

  it("refuses list in public without revealing profile existence", () => {
    const publicDeps = setup("public_channel");
    const result = handlePersonalMemoryCommand(publicDeps, "What do you remember about me?");
    expect(result).toEqual({
      handled: true,
      response: "Please DM PD One to manage private memory.",
      persistent: false,
    });
    publicDeps.store.close();
  });

  it("supports Chinese command intents and rejects sensitive remember", () => {
    const deps = setup();
    expect(handlePersonalMemoryCommand(deps, "記住我偏好中文回覆")).toMatchObject({
      handled: true,
    });
    const list = handlePersonalMemoryCommand(deps, "你記得我什麼");
    if (list.handled) {
      expect(list.response).toContain("中文回覆");
    }
    const sensitive = handlePersonalMemoryCommand(deps, "remember that my salary is 100");
    expect(sensitive).toEqual({
      handled: true,
      response: "I can’t save that as personal memory.",
      persistent: false,
    });
    deps.store.close();
  });
});
