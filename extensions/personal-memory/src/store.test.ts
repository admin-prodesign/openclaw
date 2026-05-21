import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PersonalMemoryStore } from "./store.js";

const roots: string[] = [];

function tmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-memory-store-"));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("PersonalMemoryStore", () => {
  it("creates schema, writes, updates, soft-deletes, and survives reopen", () => {
    const dbPath = path.join(tmpRoot(), "memory.sqlite");
    const store = new PersonalMemoryStore({ storePath: dbPath });
    const first = store.upsertEntry({
      subjectKey: "subject-a",
      id: "entry-1",
      category: "preference",
      content: "Prefers concise updates",
    });
    expect(first.content).toBe("Prefers concise updates");
    store.upsertEntry({
      subjectKey: "subject-a",
      id: "entry-1",
      category: "workflow",
      content: "Prefers Friday summaries",
    });
    expect(store.listEntries("subject-a")).toHaveLength(1);
    expect(store.listEntries("subject-a")[0]?.category).toBe("workflow");
    expect(store.softDeleteEntry("subject-a", "entry-1")).toBe(true);
    expect(store.listEntries("subject-a")).toHaveLength(0);
    expect(store.listEntries("subject-a", { includeDeleted: true })).toHaveLength(1);
    store.close();

    const reopened = new PersonalMemoryStore({ storePath: dbPath });
    expect(reopened.listEntries("subject-a", { includeDeleted: true })).toHaveLength(1);
    reopened.close();
  });

  it("isolates subjects and refuses cross-subject forget", () => {
    const store = new PersonalMemoryStore({ storePath: path.join(tmpRoot(), "memory.sqlite") });
    const a = store.upsertEntry({
      subjectKey: "subject-a",
      id: "same-id-a",
      category: "role",
      content: "A",
    });
    store.upsertEntry({ subjectKey: "subject-b", id: "same-id-b", category: "role", content: "B" });
    expect(store.listEntries("subject-a").map((entry) => entry.content)).toEqual(["A"]);
    expect(store.listEntries("subject-b").map((entry) => entry.content)).toEqual(["B"]);
    expect(store.softDeleteEntry("subject-b", a.id)).toBe(false);
    expect(store.listEntries("subject-a")).toHaveLength(1);
    store.close();
  });

  it("increments revision for writes and deletes", () => {
    const store = new PersonalMemoryStore({ storePath: path.join(tmpRoot(), "memory.sqlite") });
    expect(store.getRevision("subject-a")).toBe(0);
    store.upsertEntry({ subjectKey: "subject-a", category: "other", content: "one" });
    const afterWrite = store.getRevision("subject-a");
    expect(afterWrite).toBeGreaterThan(0);
    const id = store.listEntries("subject-a")[0]?.id ?? "";
    store.softDeleteEntry("subject-a", id);
    expect(store.getRevision("subject-a")).toBeGreaterThan(afterWrite);
    store.close();
  });

  it("refuses symlinked db paths and insecure parent permissions", () => {
    const root = tmpRoot();
    const target = path.join(root, "target.sqlite");
    const link = path.join(root, "link.sqlite");
    fs.writeFileSync(target, "");
    fs.symlinkSync(target, link);
    expect(() => new PersonalMemoryStore({ storePath: link })).toThrow(/symlink/);

    const insecure = path.join(root, "insecure");
    fs.mkdirSync(insecure, { mode: 0o777 });
    fs.chmodSync(insecure, 0o777);
    expect(
      () => new PersonalMemoryStore({ storePath: path.join(insecure, "memory.sqlite") }),
    ).toThrow(/owner-only/);
  });
});
