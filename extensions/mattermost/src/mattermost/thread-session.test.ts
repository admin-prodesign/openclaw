import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MattermostPost } from "./client.js";
import {
  buildMattermostThreadSessionId,
  compileMattermostThreadSessionContext,
  loadMattermostThreadSessionStore,
  resolveMattermostThreadRootId,
  resolveMattermostThreadSessionStorePath,
  saveMattermostThreadSessionStore,
  syncMattermostThreadSession,
  updateMattermostThreadSessionAttachments,
  updateMattermostThreadSessionStore,
} from "./thread-session.js";

function post(overrides: Partial<MattermostPost> & { id: string }): MattermostPost {
  return {
    id: overrides.id,
    user_id: overrides.user_id ?? "user-1",
    channel_id: overrides.channel_id ?? "chan-1",
    message: overrides.message ?? `message ${overrides.id}`,
    file_ids: overrides.file_ids,
    root_id: overrides.root_id,
    create_at: overrides.create_at,
    type: overrides.type,
    props: overrides.props,
    ...overrides,
  } as MattermostPost;
}

function tempStorePath() {
  const dir = mkdtempSync(join(tmpdir(), "mattermost-thread-session-"));
  return { dir, path: join(dir, "mattermost-thread-sessions.json") };
}

describe("mattermost thread session store", () => {
  it("builds deterministic encoded thread session ids and root ids", () => {
    expect(
      buildMattermostThreadSessionId({
        accountId: "default/account",
        channelId: "chan:1",
        rootPostId: "root post",
      }),
    ).toBe("mattermost:default%2Faccount:channel:chan%3A1:thread:root%20post");
    expect(resolveMattermostThreadRootId(post({ id: "root-1" }))).toBe("root-1");
    expect(resolveMattermostThreadRootId(post({ id: "reply-1", root_id: "root-1" }))).toBe("root-1");
  });

  it("derives the thread-session store next to the configured session store", () => {
    expect(resolveMattermostThreadSessionStorePath("/tmp/openclaw/sessions/main.json")).toBe(
      "/tmp/openclaw/sessions/mattermost-thread-sessions.json",
    );
  });

  it("loads missing or invalid stores as an empty v1 store", () => {
    const { dir, path } = tempStorePath();
    try {
      expect(loadMattermostThreadSessionStore(path)).toEqual({ version: 1, sessions: {} });
      saveMattermostThreadSessionStore(path, { version: 1, sessions: {} });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(loadMattermostThreadSessionStore(path)).toEqual({ version: 1, sessions: {} });
      require("node:fs").writeFileSync(path, "not-json", "utf8");
      expect(loadMattermostThreadSessionStore(path)).toEqual({ version: 1, sessions: {} });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("syncs posts and attachments idempotently while updating edits", () => {
    const sessionId = buildMattermostThreadSessionId({
      accountId: "default",
      channelId: "chan-1",
      rootPostId: "root-1",
    });
    const first = syncMattermostThreadSession({
      existing: undefined,
      sessionId,
      accountId: "default",
      channelId: "chan-1",
      rootPostId: "root-1",
      triggerPostId: "reply-1",
      posts: [
        post({ id: "root-1", create_at: 1, message: "root", file_ids: ["file-1"] }),
        post({ id: "reply-1", root_id: "root-1", create_at: 2, message: "reply" }),
      ],
      manifest: [{ fileId: "file-1", sourcePostId: "root-1", status: "pending" }],
      now: 100,
    });
    const second = syncMattermostThreadSession({
      existing: first.session,
      sessionId,
      accountId: "default",
      channelId: "chan-1",
      rootPostId: "root-1",
      triggerPostId: "reply-1",
      posts: [
        post({ id: "root-1", create_at: 1, message: "root edited", file_ids: [] }),
        post({ id: "reply-1", root_id: "root-1", create_at: 2, message: "reply" }),
      ],
      manifest: [],
      now: 200,
    });

    expect(first.session.posts).toHaveLength(2);
    expect(second.session.posts).toHaveLength(2);
    expect(second.session.posts.find((entry) => entry.id === "root-1")?.message).toBe("root edited");
    expect(second.session.attachments.find((entry) => entry.fileId === "file-1")?.stale).toBe(true);
    expect(second.session.activationCount).toBe(2);
    expect(second.session.lastSyncedAt).toBe(200);
  });

  it("updates attachment statuses without losing successful retry metadata", () => {
    const sessionId = buildMattermostThreadSessionId({
      accountId: "default",
      channelId: "chan-1",
      rootPostId: "root-1",
    });
    const synced = syncMattermostThreadSession({
      existing: undefined,
      sessionId,
      accountId: "default",
      channelId: "chan-1",
      rootPostId: "root-1",
      triggerPostId: "reply-1",
      posts: [post({ id: "root-1", file_ids: ["file-1"] })],
      manifest: [{ fileId: "file-1", sourcePostId: "root-1", status: "missing", failureReason: "too large" }],
      now: 100,
    });
    const updated = updateMattermostThreadSessionAttachments(synced.session, [
      {
        fileId: "file-1",
        sourcePostId: "root-1",
        status: "downloaded",
        filename: "spec.pdf",
        contentType: "application/pdf",
        localPath: "/tmp/file.pdf",
      },
    ], 200);

    const attachment = updated.attachments[0];
    expect(attachment?.status).toBe("downloaded");
    expect(attachment?.failureReason).toBeUndefined();
    expect(attachment?.localPath).toBe("/tmp/file.pdf");
    expect(updated.lastAttachmentStatusAt).toBe(200);
  });

  it("compiles layered bounded current-thread context", () => {
    const sessionId = buildMattermostThreadSessionId({
      accountId: "default",
      channelId: "chan-1",
      rootPostId: "root-1",
    });
    const posts = Array.from({ length: 5 }, (_, index) =>
      post({
        id: `p-${index + 1}`,
        root_id: index === 0 ? undefined : "root-1",
        create_at: index + 1,
        user_id: `user-${(index % 2) + 1}`,
        message: `message ${index + 1}`,
      }),
    );
    const { session } = syncMattermostThreadSession({
      existing: undefined,
      sessionId,
      accountId: "default",
      channelId: "chan-1",
      rootPostId: "root-1",
      triggerPostId: "p-5",
      posts,
      manifest: [{ fileId: "file-1", sourcePostId: "p-2", status: "missing", failureReason: "media limit" }],
      now: 100,
    });
    const context = compileMattermostThreadSessionContext(session, {
      currentPostId: "p-5",
      maxRecentPosts: 2,
      maxSummaryBullets: 2,
      maxPostChars: 80,
    });

    expect(context).toContain("Mattermost thread session:");
    expect(context).toContain("Older thread checkpoint summary:");
    expect(context).toContain("Recent Mattermost thread messages");
    expect(context).toContain("post_id=p-5 [current message]");
    expect(context).toContain("Mattermost thread attachment manifest:");
    expect(context).toContain("failure_reason=media limit");
    expect(context).not.toContain("unrelated channel chatter");
  });

  it("serializes concurrent same-path updates to avoid lost sessions", async () => {
    const { dir, path } = tempStorePath();
    try {
      await Promise.all([
        updateMattermostThreadSessionStore(path, (store) => {
          store.sessions.one = {
            id: "one",
            accountId: "default",
            channelId: "chan-1",
            rootPostId: "root-1",
            activated: true,
            activationCount: 1,
            posts: [],
            attachments: [],
            createdAt: 1,
            updatedAt: 1,
            lastSyncedAt: 1,
          };
          return store;
        }),
        updateMattermostThreadSessionStore(path, (store) => {
          store.sessions.two = {
            id: "two",
            accountId: "default",
            channelId: "chan-2",
            rootPostId: "root-2",
            activated: true,
            activationCount: 1,
            posts: [],
            attachments: [],
            createdAt: 2,
            updatedAt: 2,
            lastSyncedAt: 2,
          };
          return store;
        }),
      ]);
      const raw = JSON.parse(readFileSync(path, "utf8"));
      expect(Object.keys(raw.sessions).sort()).toEqual(["one", "two"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
