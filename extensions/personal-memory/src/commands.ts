import {
  escapePersonalMemoryForChat,
  normalizePersonalMemoryText,
  validatePersonalMemoryContent,
} from "./filter.js";
import {
  forgetPersonalMemoryForCurrentSubject,
  listPersonalMemoryForCurrentSubject,
  NON_PRIVATE_MEMORY_RESPONSE,
  rememberPersonalMemoryForCurrentSubject,
  type PersonalMemoryToolDeps,
} from "./tools.js";

export type PersonalMemoryCommandResult =
  | { handled: false }
  | { handled: true; response: string; persistent: false };

function normalizeCommand(text: string): string {
  return normalizePersonalMemoryText(text).toLowerCase();
}

function formatEntries(entries: Array<{ id: string; category: string; content: string }>): string {
  if (!entries.length) {
    return "I don’t have any private memory saved for you yet.";
  }
  return entries
    .map(
      (entry) => `- ${entry.id} [${entry.category}] ${escapePersonalMemoryForChat(entry.content)}`,
    )
    .join("\n");
}

export function handlePersonalMemoryCommand(
  deps: PersonalMemoryToolDeps,
  messageText: string,
): PersonalMemoryCommandResult {
  const normalized = normalizeCommand(messageText);
  const listIntent =
    /what do you remember about me\??/.test(normalized) ||
    /你記得我什麼|你记得我什么/.test(messageText);
  if (listIntent) {
    const listed = listPersonalMemoryForCurrentSubject(deps);
    if (!listed.ok) {
      return { handled: true, response: NON_PRIVATE_MEMORY_RESPONSE, persistent: false };
    }
    return { handled: true, response: formatEntries(listed.entries), persistent: false };
  }

  const rememberMatch = messageText.match(/^\s*(?:remember that\s+|記住\s*|记住\s*)(.+)/i);
  if (rememberMatch?.[1]) {
    const validation = validatePersonalMemoryContent(rememberMatch[1]);
    if (!validation.ok) {
      return {
        handled: true,
        response: "I can’t save that as personal memory.",
        persistent: false,
      };
    }
    const result = rememberPersonalMemoryForCurrentSubject(deps, {
      category: "other",
      content: validation.content,
    });
    if (!result.ok) {
      return { handled: true, response: result.message, persistent: false };
    }
    return {
      handled: true,
      response: `Saved private memory ${result.entry.id}.`,
      persistent: false,
    };
  }

  const forgetMatch = messageText.match(/^\s*(?:forget|忘記|忘记)\s+(.+)/i);
  if (forgetMatch?.[1]) {
    const target = normalizePersonalMemoryText(forgetMatch[1]);
    const listed = listPersonalMemoryForCurrentSubject(deps);
    if (!listed.ok) {
      return { handled: true, response: NON_PRIVATE_MEMORY_RESPONSE, persistent: false };
    }
    const matches = listed.entries.filter(
      (entry) => entry.id === target || normalizePersonalMemoryText(entry.content).includes(target),
    );
    if (matches.length === 0) {
      return {
        handled: true,
        response: "No matching private memory entry found.",
        persistent: false,
      };
    }
    if (matches.length > 1) {
      return {
        handled: true,
        response: `Multiple entries match. Please specify one id:\n${matches.map((entry) => `- ${entry.id}`).join("\n")}`,
        persistent: false,
      };
    }
    const deleted = forgetPersonalMemoryForCurrentSubject(deps, { id: matches[0].id });
    return {
      handled: true,
      response:
        deleted.ok && deleted.deleted
          ? "Forgot that private memory."
          : "No matching private memory entry found.",
      persistent: false,
    };
  }

  return { handled: false };
}
