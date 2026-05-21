import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePersonalMemoryConfig } from "./config.js";

describe("resolvePersonalMemoryConfig", () => {
  it("returns disabled defaults when config is missing", () => {
    const config = resolvePersonalMemoryConfig(undefined, {
      homeDir: "/home/tester",
      stateDir: "/var/lib/openclaw",
    });

    expect(config.enabled).toBe(false);
    expect(config.scopeId).toBe("agent:{agentId}");
    expect(config.readsRequirePrivateConversation).toBe(true);
    expect(config.atRestEncryption).toBe(false);
    expect(config.storePath).toBe(path.resolve("/var/lib/openclaw", "personal-memory.sqlite"));
  });

  it("resolves enabled config with safe defaults", () => {
    const config = resolvePersonalMemoryConfig(
      { enabled: true, storePath: "~/personal-memory.sqlite" },
      { homeDir: "/home/tester" },
    );

    expect(config.enabled).toBe(true);
    expect(config.storePath).toBe(path.resolve("/home/tester", "personal-memory.sqlite"));
    expect(config.prompt.maxItems).toBe(12);
    expect(config.prompt.maxChars).toBe(1800);
    expect(config.autoCapture).toEqual({ enabled: false, suggestOnly: true });
    expect(config.admin.allowOwnerInspect).toBe(false);
  });

  it("clamps prompt limits", () => {
    const low = resolvePersonalMemoryConfig({ prompt: { maxItems: -1, maxChars: 10 } });
    expect(low.prompt.maxItems).toBe(1);
    expect(low.prompt.maxChars).toBe(200);

    const high = resolvePersonalMemoryConfig({ prompt: { maxItems: 500, maxChars: 50_000 } });
    expect(high.prompt.maxItems).toBe(50);
    expect(high.prompt.maxChars).toBe(5000);
  });

  it("rejects unsafe MVP config combinations without leaking raw identity", () => {
    expect(() =>
      resolvePersonalMemoryConfig({ enabled: true, readsRequirePrivateConversation: false }),
    ).toThrow(/readsRequirePrivateConversation/);

    expect(() =>
      resolvePersonalMemoryConfig({ enabled: true, autoCapture: { enabled: true } }),
    ).toThrow(/experimentalAutoCaptureAcknowledge/);

    expect(() => resolvePersonalMemoryConfig({ enabled: true, scopeId: "shared:company" })).toThrow(
      /allowSharedScope/,
    );

    expect(() => resolvePersonalMemoryConfig({ enabled: true, scopeId: "company" })).toThrow(
      /allowSharedScope/,
    );

    expect(() =>
      resolvePersonalMemoryConfig({ enabled: true, scopeId: "agent:{agentid}" }),
    ).toThrow(/allowSharedScope/);

    expect(() =>
      resolvePersonalMemoryConfig({ enabled: true, scopeId: "agent:{agentID}" }),
    ).toThrow(/allowSharedScope/);

    expect(() =>
      resolvePersonalMemoryConfig({ enabled: true, storePath: "relative.sqlite" }),
    ).toThrow(/absolute/);
  });

  it("uses the OS home directory as a fallback for tilde expansion", () => {
    const config = resolvePersonalMemoryConfig({ storePath: "~/pm.sqlite" });
    expect(config.storePath).toBe(path.resolve(os.homedir(), "pm.sqlite"));
  });
});
