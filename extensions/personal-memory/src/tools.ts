import { Type } from "@sinclair/typebox";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk/provider-web-search";
import type { PersonalMemoryConfig } from "./config.js";
import {
  escapePersonalMemoryForChat,
  isPersonalMemoryCategory,
  validatePersonalMemoryContent,
} from "./filter.js";
import { resolvePersonalMemorySubject, type PersonalMemoryIdentityContext } from "./identity.js";
import type { PersonalMemoryStore } from "./store.js";

export const NON_PRIVATE_MEMORY_RESPONSE = "Please DM PD One to manage private memory.";

export type PersonalMemoryToolDeps = {
  config: PersonalMemoryConfig;
  store: Pick<PersonalMemoryStore, "listEntries" | "upsertEntry" | "softDeleteEntry">;
  context: PersonalMemoryIdentityContext;
};

function resolveToolSubject(deps: PersonalMemoryToolDeps) {
  return resolvePersonalMemorySubject(deps.context, deps.config, { requirePrivate: true });
}

export function listPersonalMemoryForCurrentSubject(deps: PersonalMemoryToolDeps) {
  const subject = resolveToolSubject(deps);
  if (!subject) {
    return { ok: false as const, message: NON_PRIVATE_MEMORY_RESPONSE };
  }
  const entries = deps.store.listEntries(subject.subjectKey, { limit: 100 }).map((entry) => ({
    id: entry.id,
    category: entry.category,
    content: escapePersonalMemoryForChat(entry.content),
    updatedAt: entry.updatedAt,
  }));
  return { ok: true as const, entries };
}

export function rememberPersonalMemoryForCurrentSubject(
  deps: PersonalMemoryToolDeps,
  params: { category: string; content: string },
) {
  const subject = resolveToolSubject(deps);
  if (!subject) {
    return { ok: false as const, message: NON_PRIVATE_MEMORY_RESPONSE };
  }
  const category = params.category;
  if (!isPersonalMemoryCategory(category)) {
    return { ok: false as const, message: "Unsupported memory category." };
  }
  const validated = validatePersonalMemoryContent(params.content);
  if (!validated.ok) {
    return { ok: false as const, message: "I can’t save that as personal memory." };
  }
  const entry = deps.store.upsertEntry({
    subjectKey: subject.subjectKey,
    category,
    content: validated.content,
  });
  return {
    ok: true as const,
    entry: {
      id: entry.id,
      category: entry.category,
      content: escapePersonalMemoryForChat(entry.content),
    },
  };
}

export function forgetPersonalMemoryForCurrentSubject(
  deps: PersonalMemoryToolDeps,
  params: { id: string },
) {
  const subject = resolveToolSubject(deps);
  if (!subject) {
    return { ok: false as const, message: NON_PRIVATE_MEMORY_RESPONSE };
  }
  const id = params.id.trim();
  if (!id) {
    return { ok: false as const, message: "Memory id is required." };
  }
  const deleted = deps.store.softDeleteEntry(subject.subjectKey, id);
  return { ok: true as const, deleted };
}

const RememberSchema = Type.Object(
  {
    category: Type.Union([
      Type.Literal("preference"),
      Type.Literal("role"),
      Type.Literal("workflow"),
      Type.Literal("language"),
      Type.Literal("format"),
      Type.Literal("responsibility"),
      Type.Literal("other"),
    ]),
    content: Type.String({ maxLength: 500 }),
  },
  { additionalProperties: false },
);

const ForgetSchema = Type.Object({ id: Type.String() }, { additionalProperties: false });

export function createPersonalMemoryTools(deps: PersonalMemoryToolDeps) {
  if (!resolveToolSubject(deps)) {
    return [];
  }
  return [
    {
      name: "personal_memory_list",
      label: "List Personal Memory",
      description: "List private memory for the current sender in this direct conversation only.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async () => jsonResult(listPersonalMemoryForCurrentSubject(deps)),
    },
    {
      name: "personal_memory_remember",
      label: "Remember Personal Memory",
      description:
        "Save a safe private memory for the current sender in this direct conversation only.",
      parameters: RememberSchema,
      execute: async (_toolCallId: string, rawParams: Record<string, unknown>) =>
        jsonResult(
          rememberPersonalMemoryForCurrentSubject(deps, {
            category: readStringParam(rawParams, "category", { required: true }),
            content: readStringParam(rawParams, "content", { required: true }),
          }),
        ),
    },
    {
      name: "personal_memory_forget",
      label: "Forget Personal Memory",
      description:
        "Forget a private memory entry owned by the current sender in this direct conversation only.",
      parameters: ForgetSchema,
      execute: async (_toolCallId: string, rawParams: Record<string, unknown>) =>
        jsonResult(
          forgetPersonalMemoryForCurrentSubject(deps, {
            id: readStringParam(rawParams, "id", { required: true }),
          }),
        ),
    },
  ];
}
