import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyCodexSelfHealPatchToText,
  ensureOpenClawPeerLink,
} from "./pd-one-hotpatch-codex-self-heal.mjs";

const importLine =
  'import { c as resolveCodexAppServerAuthAccountCacheKey, d as resolveCodexAppServerEnvApiKeyCacheKey, f as resolveCodexAppServerHomeDir, l as resolveCodexAppServerAuthProfileId, n as clearSharedCodexAppServerClientIfCurrent, s as refreshCodexAppServerAuthTokens, u as resolveCodexAppServerAuthProfileIdForAgent } from "./shared-client-BLfb9cHM.js";';
const retryBlock = `\t\t\t\t\tconst failedClient = attemptedClient;\n\t\t\t\t\tconst clearedSharedClient = clearSharedCodexAppServerClientIfCurrent(failedClient);\n\t\t\t\t\tif (startupClientForCleanup === failedClient) startupClientForCleanup = void 0;`;

function patchFixture() {
  return `${importLine}\nconst CODEX_APP_SERVER_STARTUP_TIMEOUT_FLOOR_MS = 100;\n${retryBlock}\n\t\t\t\t\t\t\tclearedSharedClient,\n\t\t\t\t\t\t\terror: formatErrorMessage(error)\n\t\t\t\t\t\tclearedSharedClient,\n\t\t\t\t\t\terror: formatErrorMessage(error)\n`;
}

test("patch adds fleet-wide shared Codex client recycle on startup connection-close retries", () => {
  const result = applyCodexSelfHealPatchToText(patchFixture());

  assert.equal(result.changed, true);
  assert.match(result.text, /t as clearSharedCodexAppServerClientAndWait/);
  assert.match(
    result.text,
    /await clearSharedCodexAppServerClientAndWait\(\{ timeoutMs: CODEX_APP_SERVER_RECYCLE_TIMEOUT_MS \}\)/,
  );
  assert.match(result.text, /recycledSharedClients/);
});

test("patch is idempotent", () => {
  const once = applyCodexSelfHealPatchToText(patchFixture());
  const twice = applyCodexSelfHealPatchToText(once.text);

  assert.equal(once.changed, true);
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

test("creates the optional openclaw peer link for the installed Codex plugin tree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pd-one-codex-peer-"));
  try {
    const pluginNpmRoot = path.join(root, "plugin-npm");
    const openclawPackageRoot = path.join(root, "openclaw-package");
    const first = await ensureOpenClawPeerLink({ pluginNpmRoot, openclawPackageRoot });
    const second = await ensureOpenClawPeerLink({ pluginNpmRoot, openclawPackageRoot });

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(second.linkPath, path.join(pluginNpmRoot, "node_modules", "openclaw"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
