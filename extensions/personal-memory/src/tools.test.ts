import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePersonalMemoryConfig } from "./config.js";
import type { PersonalMemoryIdentityContext } from "./identity.js";
import { PersonalMemoryStore } from "./store.js";
import {
  createPersonalMemoryTools,
  forgetPersonalMemoryForCurrentSubject,
  listPersonalMemoryForCurrentSubject,
  NON_PRIVATE_MEMORY_RESPONSE,
  rememberPersonalMemoryForCurrentSubject,
} from "./tools.js";

const roots: string[] = [];
function setup(visibility: PersonalMemoryIdentityContext["conversationVisibility"] = "direct") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-memory-tools-"));
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

describe("personal memory tools", () => {
  it("writes, lists, and forgets only the current subject", () => {
    const deps = setup();
    const remembered = rememberPersonalMemoryForCurrentSubject(deps, {
      category: "preference",
      content: "I prefer short summaries",
    });
    expect(remembered.ok).toBe(true);
    if (!remembered.ok) {
      throw new Error("remember failed");
    }
    expect(listPersonalMemoryForCurrentSubject(deps)).toMatchObject({
      ok: true,
      entries: [{ content: "I prefer short summaries" }],
    });

    const other = { ...deps, context: { ...deps.context, requesterSenderId: "user-b" } };
    expect(listPersonalMemoryForCurrentSubject(other)).toMatchObject({ ok: true, entries: [] });
    expect(forgetPersonalMemoryForCurrentSubject(other, { id: remembered.entry.id })).toEqual({
      ok: true,
      deleted: false,
    });
    expect(listPersonalMemoryForCurrentSubject(deps)).toMatchObject({
      ok: true,
      entries: [{ id: remembered.entry.id }],
    });

    expect(forgetPersonalMemoryForCurrentSubject(deps, { id: remembered.entry.id })).toEqual({
      ok: true,
      deleted: true,
    });
    expect(listPersonalMemoryForCurrentSubject(deps)).toMatchObject({ ok: true, entries: [] });
    deps.store.close();
  });

  it("refuses public/group tool access with constant shape", () => {
    for (const visibility of ["public_channel", "group", "unknown"] as const) {
      const deps = setup(visibility);
      expect(createPersonalMemoryTools(deps)).toHaveLength(0);
      expect(listPersonalMemoryForCurrentSubject(deps)).toEqual({
        ok: false,
        message: NON_PRIVATE_MEMORY_RESPONSE,
      });
      expect(
        rememberPersonalMemoryForCurrentSubject(deps, {
          category: "preference",
          content: "I prefer x",
        }),
      ).toEqual({
        ok: false,
        message: NON_PRIVATE_MEMORY_RESPONSE,
      });
      deps.store.close();
    }
  });

  it("does not accept identity override params and rejects unsafe content", () => {
    const deps = setup();
    const withParams = {
      ...deps,
      context: { ...deps.context, params: { requesterSenderId: "victim" } },
    };
    const result = rememberPersonalMemoryForCurrentSubject(withParams, {
      category: "preference",
      content: "I prefer concise replies",
    });
    expect(result.ok).toBe(true);
    expect(listPersonalMemoryForCurrentSubject(deps)).toMatchObject({
      ok: true,
      entries: [{ content: "I prefer concise replies" }],
    });
    expect(
      rememberPersonalMemoryForCurrentSubject(deps, {
        category: "preference",
        content: "my salary is 10",
      }).ok,
    ).toBe(false);
    expect(
      rememberPersonalMemoryForCurrentSubject(deps, { category: "bad", content: "safe" }).ok,
    ).toBe(false);
    deps.store.close();
  });
});
