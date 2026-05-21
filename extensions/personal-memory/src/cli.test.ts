import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cliDoctorPersonalMemory,
  cliListPersonalMemory,
  cliSubjectKey,
  RAW_EXPORT_ACK,
} from "./cli.js";
import { PersonalMemoryStore } from "./store.js";

const roots: string[] = [];
const tuple = {
  scopeId: "agent:pd-one",
  channelProviderId: "mattermost",
  workspaceId: "workspace",
  agentAccountId: "bot",
  senderId: "user-a",
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function store() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-memory-cli-"));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  return new PersonalMemoryStore({ storePath: path.join(root, "memory.sqlite") });
}

describe("personal memory cli helpers", () => {
  it("lists only explicitly selected subject and redacts chat side effects", () => {
    const s = store();
    s.upsertEntry({
      subjectKey: cliSubjectKey(tuple),
      category: "preference",
      content: "Use @here hxxp",
    });
    s.upsertEntry({
      subjectKey: cliSubjectKey({ ...tuple, senderId: "user-b" }),
      category: "preference",
      content: "Other",
    });
    const output = cliListPersonalMemory(s, tuple);
    expect(output).toContain("Use");
    expect(output).not.toContain("@here");
    expect(output).not.toContain("Other");
    s.close();
  });

  it("requires acknowledgement for raw json export and doctor redacts content", () => {
    const s = store();
    s.upsertEntry({
      subjectKey: cliSubjectKey(tuple),
      category: "preference",
      content: "private content",
    });
    expect(() => cliListPersonalMemory(s, tuple, { json: true })).toThrow(/acknowledgement/);
    expect(cliListPersonalMemory(s, tuple, { json: true, rawAck: RAW_EXPORT_ACK })).toContain(
      "private content",
    );
    expect(
      cliDoctorPersonalMemory("/tmp/memory.sqlite", { activeEntries: 1, deletedEntries: 0 }),
    ).not.toContain("private content");
    s.close();
  });
});
