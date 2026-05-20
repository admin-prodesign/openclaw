#!/usr/bin/env node
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OPENCLAW_DIST = "/home/prodesign/.npm-global/lib/node_modules/openclaw/dist";
const DEFAULT_OPENCLAW_PACKAGE_ROOT = path.dirname(DEFAULT_OPENCLAW_DIST);
const DEFAULT_OPENCLAW_PLUGIN_NPM_ROOT = "/home/prodesign/.openclaw/npm";

const IMPORT_BEFORE =
  'import { c as resolveCodexAppServerAuthAccountCacheKey, d as resolveCodexAppServerEnvApiKeyCacheKey, f as resolveCodexAppServerHomeDir, l as resolveCodexAppServerAuthProfileId, n as clearSharedCodexAppServerClientIfCurrent, s as refreshCodexAppServerAuthTokens, u as resolveCodexAppServerAuthProfileIdForAgent } from "./shared-client-BLfb9cHM.js";';
const IMPORT_AFTER =
  'import { c as resolveCodexAppServerAuthAccountCacheKey, d as resolveCodexAppServerEnvApiKeyCacheKey, f as resolveCodexAppServerHomeDir, l as resolveCodexAppServerAuthProfileId, n as clearSharedCodexAppServerClientIfCurrent, t as clearSharedCodexAppServerClientAndWait, s as refreshCodexAppServerAuthTokens, u as resolveCodexAppServerAuthProfileIdForAgent } from "./shared-client-BLfb9cHM.js";';

const CONSTANT_BEFORE = "const CODEX_APP_SERVER_STARTUP_TIMEOUT_FLOOR_MS = 100;";
const CONSTANT_AFTER =
  "const CODEX_APP_SERVER_STARTUP_TIMEOUT_FLOOR_MS = 100;\nconst CODEX_APP_SERVER_RECYCLE_TIMEOUT_MS = 5_000;";

const RETRY_BEFORE = `\t\t\t\t\tconst failedClient = attemptedClient;
\t\t\t\t\tconst clearedSharedClient = clearSharedCodexAppServerClientIfCurrent(failedClient);
\t\t\t\t\tif (startupClientForCleanup === failedClient) startupClientForCleanup = void 0;`;

const RETRY_AFTER = `\t\t\t\t\tconst failedClient = attemptedClient;
\t\t\t\t\tconst clearedSharedClient = clearSharedCodexAppServerClientIfCurrent(failedClient);
\t\t\t\t\tlet recycledSharedClients = false;
\t\t\t\t\ttry {
\t\t\t\t\t\tawait clearSharedCodexAppServerClientAndWait({ timeoutMs: CODEX_APP_SERVER_RECYCLE_TIMEOUT_MS });
\t\t\t\t\t\trecycledSharedClients = true;
\t\t\t\t\t} catch (recycleError) {
\t\t\t\t\t\tlog.warn("codex app-server shared-client recycle failed during startup self-heal", { error: formatErrorMessage(recycleError) });
\t\t\t\t\t}
\t\t\t\t\tif (startupClientForCleanup === failedClient) startupClientForCleanup = void 0;`;

const LOG_RE = /^(\t+)clearedSharedClient,\n\1error: formatErrorMessage\(error\)/gm;

export function applyCodexSelfHealPatchToText(input) {
  let text = input;
  let changed = false;

  if (
    text.includes(
      "clearSharedCodexAppServerClientAndWait({ timeoutMs: CODEX_APP_SERVER_RECYCLE_TIMEOUT_MS })",
    )
  ) {
    return { text, changed: false };
  }

  for (const [before, after, label] of [
    [IMPORT_BEFORE, IMPORT_AFTER, "shared-client import"],
    [CONSTANT_BEFORE, CONSTANT_AFTER, "recycle timeout constant"],
    [RETRY_BEFORE, RETRY_AFTER, "startup retry recycle block"],
  ]) {
    if (!text.includes(before)) {
      throw new Error(`Cannot apply Codex self-heal patch: missing ${label} anchor`);
    }
    text = text.replace(before, after);
    changed = true;
  }

  let logInsertions = 0;
  text = text.replace(LOG_RE, (_match, indent) => {
    logInsertions += 1;
    return `${indent}clearedSharedClient,\n${indent}recycledSharedClients,\n${indent}error: formatErrorMessage(error)`;
  });
  if (logInsertions < 2) {
    throw new Error(
      `Cannot apply Codex self-heal patch: expected at least 2 log anchors, found ${logInsertions}`,
    );
  }

  return { text, changed };
}

async function findRunAttemptFile(distDir) {
  const entries = await readdir(distDir);
  const candidates = entries.filter((name) => /^run-attempt-.*\.js$/.test(name));
  for (const name of candidates) {
    const file = path.join(distDir, name);
    const text = await readFile(file, "utf8");
    if (
      text.includes("CODEX_APP_SERVER_STARTUP_CONNECTION_CLOSE_MAX_ATTEMPTS") &&
      text.includes("clearSharedCodexAppServerClientIfCurrent")
    ) {
      return file;
    }
  }
  throw new Error(`Could not find run-attempt chunk under ${distDir}`);
}

export async function ensureOpenClawPeerLink({
  pluginNpmRoot = DEFAULT_OPENCLAW_PLUGIN_NPM_ROOT,
  openclawPackageRoot = DEFAULT_OPENCLAW_PACKAGE_ROOT,
} = {}) {
  const nodeModulesDir = path.join(pluginNpmRoot, "node_modules");
  const linkPath = path.join(nodeModulesDir, "openclaw");
  await mkdir(nodeModulesDir, { recursive: true });
  try {
    const stat = await lstat(linkPath);
    if (stat.isSymbolicLink()) {
      const target = await readlink(linkPath);
      const resolved = path.resolve(path.dirname(linkPath), target);
      if (resolved === openclawPackageRoot) {
        return { linkPath, changed: false };
      }
      await unlink(linkPath);
    } else {
      return { linkPath, changed: false, skipped: "existing-non-symlink" };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  await symlink(openclawPackageRoot, linkPath, "dir");
  return { linkPath, changed: true };
}

export async function applyCodexSelfHealPatch({
  distDir = DEFAULT_OPENCLAW_DIST,
  backup = true,
  ensurePeerLink = true,
} = {}) {
  const file = await findRunAttemptFile(distDir);
  const original = await readFile(file, "utf8");
  const result = applyCodexSelfHealPatchToText(original);
  if (result.changed) {
    if (backup) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await copyFile(file, `${file}.bak-pd-one-codex-self-heal-${stamp}`);
    }
    await writeFile(file, result.text, "utf8");
  }
  const peerLink = ensurePeerLink ? await ensureOpenClawPeerLink() : undefined;
  return { file, changed: result.changed, peerLink };
}

async function main() {
  const distDir = process.argv[2] || process.env.OPENCLAW_DIST || DEFAULT_OPENCLAW_DIST;
  const result = await applyCodexSelfHealPatch({ distDir });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exit(1);
  });
}
