import fs from "node:fs";
import path from "node:path";
import type { MattermostPost } from "./client.js";
import type { MattermostThreadAttachmentManifestEntry } from "./monitor.js";

export type MattermostThreadSessionPost = {
  id: string;
  rootId?: string;
  channelId?: string;
  userId?: string;
  message?: string;
  fileIds: string[];
  createAt?: number;
  updateAt?: number;
  editAt?: number;
  deleteAt?: number;
  deleted?: boolean;
};

export type MattermostThreadSessionAttachment = MattermostThreadAttachmentManifestEntry & {
  stale?: boolean;
  updatedAt?: number;
};

export type MattermostThreadSession = {
  id: string;
  accountId: string;
  channelId: string;
  rootPostId: string;
  activated: boolean;
  activationCount: number;
  posts: MattermostThreadSessionPost[];
  attachments: MattermostThreadSessionAttachment[];
  createdAt: number;
  updatedAt: number;
  lastSyncedAt: number;
  lastAttachmentStatusAt?: number;
  lastTriggerPostId?: string;
  syncCaveat?: string;
};

export type MattermostThreadSessionStore = {
  version: 1;
  sessions: Record<string, MattermostThreadSession>;
};

const STORE_FILENAME = "mattermost-thread-sessions.json";
const DEFAULT_RECENT_POSTS = 20;
const DEFAULT_SUMMARY_BULLETS = 12;
const DEFAULT_POST_CHARS = 1200;

const storeQueues = new Map<string, Promise<unknown>>();

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value.trim());
}

export function buildMattermostThreadSessionId(params: {
  accountId: string;
  channelId: string;
  rootPostId: string;
}): string {
  return `mattermost:${encodeKeyPart(params.accountId)}:channel:${encodeKeyPart(
    params.channelId,
  )}:thread:${encodeKeyPart(params.rootPostId)}`;
}

export function resolveMattermostThreadRootId(post: Pick<MattermostPost, "id" | "root_id">): string {
  return post.root_id?.trim() || post.id;
}

export function resolveMattermostThreadSessionStorePath(sessionStorePath: string): string {
  return path.join(path.dirname(sessionStorePath), STORE_FILENAME);
}

function emptyStore(): MattermostThreadSessionStore {
  return { version: 1, sessions: {} };
}

function isSessionStore(value: unknown): value is MattermostThreadSessionStore {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { version?: unknown }).version === 1 &&
      typeof (value as { sessions?: unknown }).sessions === "object" &&
      (value as { sessions?: unknown }).sessions,
  );
}

export function loadMattermostThreadSessionStore(storePath: string): MattermostThreadSessionStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as unknown;
    return isSessionStore(parsed) ? parsed : emptyStore();
  } catch {
    return emptyStore();
  }
}

export function saveMattermostThreadSessionStore(
  storePath: string,
  store: MattermostThreadSessionStore,
): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tempPath, storePath);
  try {
    fs.chmodSync(storePath, 0o600);
  } catch {
    // Best effort only; some filesystems ignore chmod.
  }
}

export async function updateMattermostThreadSessionStore(
  storePath: string,
  updater: (store: MattermostThreadSessionStore) => MattermostThreadSessionStore | void,
): Promise<MattermostThreadSessionStore> {
  const previous = storeQueues.get(storePath) ?? Promise.resolve();
  let release!: () => void;
  const current = previous.then(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  storeQueues.set(storePath, current);
  await previous.catch(() => undefined);
  try {
    const store = loadMattermostThreadSessionStore(storePath);
    const updated = updater(store) ?? store;
    saveMattermostThreadSessionStore(storePath, updated);
    return updated;
  } finally {
    release();
    if (storeQueues.get(storePath) === current) {
      storeQueues.delete(storePath);
    }
  }
}

function postNumber(post: MattermostPost, key: "update_at" | "edit_at" | "delete_at"): number | undefined {
  const value = (post as MattermostPost & Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

function normalizePost(post: MattermostPost, rootPostId: string): MattermostThreadSessionPost {
  const deleteAt = postNumber(post, "delete_at");
  return {
    id: post.id,
    rootId: post.root_id?.trim() || (post.id === rootPostId ? undefined : rootPostId),
    channelId: post.channel_id ?? undefined,
    userId: post.user_id ?? undefined,
    message: post.message ?? undefined,
    fileIds: (post.file_ids ?? []).map((fileId) => fileId.trim()).filter(Boolean),
    createAt: typeof post.create_at === "number" ? post.create_at : undefined,
    updateAt: postNumber(post, "update_at"),
    editAt: postNumber(post, "edit_at"),
    deleteAt,
    deleted: Boolean(deleteAt && deleteAt > 0),
  };
}

function sortPosts(posts: MattermostThreadSessionPost[]): MattermostThreadSessionPost[] {
  return posts.toSorted((left, right) => {
    const leftTime = left.createAt ?? Number.MAX_SAFE_INTEGER;
    const rightTime = right.createAt ?? Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });
}

function mergeAttachments(params: {
  existing: MattermostThreadSessionAttachment[];
  manifest: MattermostThreadAttachmentManifestEntry[];
  activeFileIds: Set<string>;
  now: number;
}): MattermostThreadSessionAttachment[] {
  const byId = new Map(params.existing.map((entry) => [entry.fileId, entry] as const));
  for (const entry of params.manifest) {
    const existing = byId.get(entry.fileId);
    byId.set(entry.fileId, {
      ...existing,
      ...entry,
      stale: false,
      updatedAt: params.now,
    });
  }
  return [...byId.values()].map((entry) =>
    params.activeFileIds.has(entry.fileId) ? entry : { ...entry, stale: true, updatedAt: params.now },
  );
}

export function syncMattermostThreadSession(params: {
  existing?: MattermostThreadSession;
  sessionId: string;
  accountId: string;
  channelId: string;
  rootPostId: string;
  triggerPostId?: string;
  posts: MattermostPost[];
  manifest: MattermostThreadAttachmentManifestEntry[];
  caveat?: string;
  now?: number;
}): { session: MattermostThreadSession; created: boolean } {
  const now = params.now ?? Date.now();
  const existing = params.existing;
  const postMap = new Map((existing?.posts ?? []).map((entry) => [entry.id, entry] as const));
  for (const rawPost of params.posts) {
    const normalized = normalizePost(rawPost, params.rootPostId);
    postMap.set(normalized.id, { ...postMap.get(normalized.id), ...normalized });
  }
  const posts = sortPosts([...postMap.values()]);
  const activeFileIds = new Set([
    ...posts.flatMap((entry) => (entry.deleted ? [] : entry.fileIds)),
    ...params.manifest.map((entry) => entry.fileId),
  ]);
  const session: MattermostThreadSession = {
    id: params.sessionId,
    accountId: params.accountId,
    channelId: params.channelId,
    rootPostId: params.rootPostId,
    activated: true,
    activationCount: (existing?.activationCount ?? 0) + 1,
    posts,
    attachments: mergeAttachments({
      existing: existing?.attachments ?? [],
      manifest: params.manifest,
      activeFileIds,
      now,
    }),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSyncedAt: now,
    lastAttachmentStatusAt: existing?.lastAttachmentStatusAt,
    lastTriggerPostId: params.triggerPostId,
    syncCaveat: params.caveat,
  };
  return { session, created: !existing };
}

export function updateMattermostThreadSessionAttachments(
  session: MattermostThreadSession,
  manifest: MattermostThreadAttachmentManifestEntry[],
  now = Date.now(),
): MattermostThreadSession {
  const byId = new Map(session.attachments.map((entry) => [entry.fileId, entry] as const));
  for (const entry of manifest) {
    const existing = byId.get(entry.fileId);
    byId.set(entry.fileId, {
      ...existing,
      ...entry,
      failureReason: entry.status === "downloaded" ? undefined : entry.failureReason,
      stale: existing?.stale ?? false,
      updatedAt: now,
    });
  }
  return {
    ...session,
    attachments: [...byId.values()],
    updatedAt: now,
    lastAttachmentStatusAt: now,
  };
}

function truncateText(value: string | undefined, maxChars: number): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 12)).trimEnd()}…[truncated]`;
}

function formatPostLine(
  post: MattermostThreadSessionPost,
  index: number,
  currentPostId: string | undefined,
  maxPostChars: number,
): string {
  const marker = post.id === currentPostId ? " [current message]" : "";
  const timestamp = post.createAt !== undefined ? ` timestamp=${post.createAt}` : "";
  const sender = post.userId ?? "unknown";
  const body = post.deleted ? "[deleted Mattermost post]" : truncateText(post.message, maxPostChars);
  return `${index}. post_id=${post.id}${marker} sender=${sender}${timestamp}: ${body}`;
}

export function compileMattermostThreadSessionContext(
  session: MattermostThreadSession,
  opts: {
    currentPostId?: string;
    maxRecentPosts?: number;
    maxSummaryBullets?: number;
    maxPostChars?: number;
  } = {},
): string {
  const maxRecentPosts = Math.max(1, opts.maxRecentPosts ?? DEFAULT_RECENT_POSTS);
  const maxSummaryBullets = Math.max(1, opts.maxSummaryBullets ?? DEFAULT_SUMMARY_BULLETS);
  const maxPostChars = Math.max(80, opts.maxPostChars ?? DEFAULT_POST_CHARS);
  const visiblePosts = sortPosts(session.posts).filter((entry) => !entry.deleted && truncateText(entry.message, 1));
  const activeAttachments = session.attachments.filter((entry) => !entry.stale);
  if (visiblePosts.length <= 1 && activeAttachments.length === 0 && !session.syncCaveat) {
    return "";
  }
  const recent = visiblePosts.slice(Math.max(0, visiblePosts.length - maxRecentPosts));
  const older = visiblePosts.slice(0, Math.max(0, visiblePosts.length - recent.length));
  const lines: string[] = [
    "Mattermost thread session:",
    `session_id=${session.id}`,
    `account_id=${session.accountId}`,
    `channel_id=${session.channelId}`,
    `root_post_id=${session.rootPostId}`,
    `posts=${visiblePosts.length}`,
    `attachments=${session.attachments.length}`,
    `activation_count=${session.activationCount}`,
  ];
  if (session.syncCaveat) {
    lines.push(`[Mattermost thread sync caveat: ${session.syncCaveat}]`);
  }
  if (older.length > 0) {
    const participants = [...new Set(older.map((entry) => entry.userId).filter(Boolean))].join(",") || "unknown";
    lines.push("", "Older thread checkpoint summary:");
    lines.push(
      `older_posts=${older.length} participants=${participants} first_timestamp=${older[0]?.createAt ?? "unknown"} last_timestamp=${older.at(-1)?.createAt ?? "unknown"}`,
    );
    older.slice(-maxSummaryBullets).forEach((entry, index) => {
      lines.push(`- ${formatPostLine(entry, index + 1, opts.currentPostId, Math.min(maxPostChars, 280))}`);
    });
  }
  if (recent.length > 0) {
    lines.push("", "Recent Mattermost thread messages (oldest to newest):");
    recent.forEach((entry, index) => {
      lines.push(formatPostLine(entry, index + 1, opts.currentPostId, maxPostChars));
    });
  }
  if (activeAttachments.length > 0) {
    lines.push("", "Mattermost thread attachment manifest:");
    activeAttachments.forEach((entry, index) => {
      const parts = [
        `${index + 1}. file_id=${entry.fileId}`,
        `source_post_id=${entry.sourcePostId}`,
        `status=${entry.status ?? "pending"}`,
      ];
      if (entry.filename) parts.push(`filename=${entry.filename}`);
      if (entry.contentType) parts.push(`content_type=${entry.contentType}`);
      if (entry.sizeBytes !== undefined) parts.push(`size_bytes=${entry.sizeBytes}`);
      if (entry.status === "downloaded" && entry.localPath) parts.push(`local_path=${entry.localPath}`);
      if (entry.failureReason) parts.push(`failure_reason=${entry.failureReason}`);
      lines.push(parts.join(" "));
    });
    lines.push(
      "Do not answer document-grounded requests from general memory or unrelated installed skills when expected Mattermost attachments are missing, failed, stale, or not yet synthesized. First cite/summarize retrieved files, or explicitly say which files could not be retrieved/extracted.",
    );
  }
  return lines.join("\n");
}
