import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export { resolvePersonalMemoryConfig } from "./src/config.js";
export {
  buildPersonalMemorySubjectKey,
  isPrivateConversation,
  resolvePersonalMemorySubject,
} from "./src/identity.js";

export default definePluginEntry({
  id: "personal-memory",
  name: "Personal Memory",
  description: "Private per-employee memory profiles keyed from trusted runtime identity.",
  kind: "memory",
  register() {
    // Tools, prompt injection, and CLI are added in later tasks.
  },
});
