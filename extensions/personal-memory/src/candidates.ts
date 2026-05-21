import {
  isSensitivePersonalMemoryCandidate,
  validatePersonalMemoryContent,
  type PersonalMemoryCategory,
} from "./filter.js";
import type { PersonalMemoryIdentityContext } from "./identity.js";

export type PersonalMemoryCandidate = {
  category: PersonalMemoryCategory;
  content: string;
  suggestOnly: true;
};

export function detectPersonalMemoryCandidate(
  text: string,
  context: Pick<PersonalMemoryIdentityContext, "conversationVisibility">,
): PersonalMemoryCandidate | null {
  if (context.conversationVisibility !== "direct") {
    return null;
  }
  if (isSensitivePersonalMemoryCandidate(text)) {
    return null;
  }
  const explicit = text.match(/(?:remember that\s+|記住\s*|记住\s*)(.+)/i)?.[1];
  const preference = text.match(/\bI\s+(?:usually|prefer|like|want)\s+(.+)/i)?.[0];
  const chinesePreference = text.match(/我(?:通常|偏好|喜歡|喜欢)(.+)/)?.[0];
  const content = explicit ?? preference ?? chinesePreference;
  if (!content) {
    return null;
  }
  const validated = validatePersonalMemoryContent(content);
  if (!validated.ok) {
    return null;
  }
  const category: PersonalMemoryCategory = /language|中文|english|英文/i.test(validated.content)
    ? "language"
    : /format|summary|bullet|格式|摘要/i.test(validated.content)
      ? "format"
      : "preference";
  return { category, content: validated.content, suggestOnly: true };
}
