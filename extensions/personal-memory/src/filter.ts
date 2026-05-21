const ZERO_WIDTH_OR_BIDI = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/gu;

function isDisallowedControlChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code === 0x7f || (code < 0x20 && ch !== "\n" && ch !== "\r" && ch !== "\t");
}

function stripDisallowedControlChars(input: string): string {
  return Array.from(input)
    .filter((ch) => !isDisallowedControlChar(ch))
    .join("");
}

function hasDisallowedControlChars(input: string): boolean {
  return Array.from(input).some(isDisallowedControlChar);
}

const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(api[_-]?key|secret|password|passwd|token|private[_-]?key|ssh-rsa|bearer\s+[a-z0-9._-]+)\b|\bsk-[a-z0-9_-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(salary|bonus|pay raise|performance review|evaluation)\b|薪水|薪資|工資|獎金|加薪|績效|考核/i,
  /\b(health|medical|diagnosis|doctor|hospital|mental health)\b|生病|病歷|醫療|診斷|醫生|醫院/i,
  /\b(conflict|complaint|harassment|gossip|rumor)\b|吵架|衝突|投訴|抱怨|八卦|謠言|騷擾/i,
  /\b(hr|human resources)\b|人資|人事/i,
];

const INSTRUCTION_PATTERNS: RegExp[] = [
  /\b(system|developer|assistant|tool)\s*:/i,
  /<\/?\s*(system|developer|assistant|tool|instructions?)\b/i,
  /```/,
  /\{\s*"(?:tool|function|arguments|name)"\s*:/i,
  /\b(ignore|override|forget)\s+(?:previous|system|developer|instructions?)/i,
  /請忽略|忽略.*指令|系統提示|開發者訊息/,
];

export const PERSONAL_MEMORY_CATEGORIES = [
  "preference",
  "role",
  "workflow",
  "language",
  "format",
  "responsibility",
  "other",
] as const;

export type PersonalMemoryCategory = (typeof PERSONAL_MEMORY_CATEGORIES)[number];

export function normalizePersonalMemoryText(input: string): string {
  return stripDisallowedControlChars(
    input.normalize("NFKC").replace(ZERO_WIDTH_OR_BIDI, ""),
  ).trim();
}

export function isPersonalMemoryCategory(value: string): value is PersonalMemoryCategory {
  return (PERSONAL_MEMORY_CATEGORIES as readonly string[]).includes(value);
}

export function isSensitivePersonalMemoryCandidate(input: string): boolean {
  const normalized = normalizePersonalMemoryText(input);
  if (!normalized || normalized.length > 500) {
    return true;
  }
  if (ZERO_WIDTH_OR_BIDI.test(input) || hasDisallowedControlChars(input)) {
    return true;
  }
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isInstructionLikePersonalMemory(input: string): boolean {
  const normalized = normalizePersonalMemoryText(input);
  if (normalized.split(/\r?\n/).length > 2) {
    return true;
  }
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function validatePersonalMemoryContent(
  input: string,
): { ok: true; content: string } | { ok: false; reason: string } {
  const content = normalizePersonalMemoryText(input);
  if (!content) {
    return { ok: false, reason: "empty" };
  }
  if (content.length > 500) {
    return { ok: false, reason: "too_long" };
  }
  if (isSensitivePersonalMemoryCandidate(input)) {
    return { ok: false, reason: "sensitive" };
  }
  if (isInstructionLikePersonalMemory(input)) {
    return { ok: false, reason: "instruction_like" };
  }
  return { ok: true, content };
}

export function escapePersonalMemoryForChat(input: string): string {
  return normalizePersonalMemoryText(input)
    .replace(/@/g, "@")
    .replace(/https?:\/\//gi, "hxxps://")
    .replace(/```/g, "ʼʼʼ")
    .replace(/[<>]/g, (ch) => (ch === "<" ? "‹" : "›"));
}
