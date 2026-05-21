import { escapePersonalMemoryForChat } from "./filter.js";
import { buildPersonalMemorySubjectKey, type PersonalMemorySubjectTuple } from "./identity.js";
import type { PersonalMemoryStore } from "./store.js";

export type PersonalMemoryCliSubjectArgs = PersonalMemorySubjectTuple;

export const RAW_EXPORT_ACK = "I-understand-this-exports-personal-data";

export function cliSubjectKey(args: PersonalMemoryCliSubjectArgs): string {
  return buildPersonalMemorySubjectKey(args);
}

export function cliListPersonalMemory(
  store: Pick<PersonalMemoryStore, "listEntries">,
  args: PersonalMemoryCliSubjectArgs,
  options: { json?: boolean; includeDeleted?: boolean; rawAck?: string } = {},
) {
  const entries = store.listEntries(cliSubjectKey(args), {
    includeDeleted: options.includeDeleted,
    limit: 500,
  });
  if (options.json) {
    if (options.rawAck !== RAW_EXPORT_ACK) {
      throw new Error("raw personal memory export requires acknowledgement");
    }
    return JSON.stringify(entries, null, 2);
  }
  return entries
    .map((entry) => `${entry.id}\t${entry.category}\t${escapePersonalMemoryForChat(entry.content)}`)
    .join("\n");
}

export function cliDoctorPersonalMemory(
  storePath: string,
  stats: { activeEntries: number; deletedEntries: number },
): string {
  return JSON.stringify({
    storePath,
    activeEntries: stats.activeEntries,
    deletedEntries: stats.deletedEntries,
    contentRedacted: true,
  });
}
