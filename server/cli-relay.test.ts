import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { applyStartupPreferences, parseArgs, runLogin, type CliOptions } from "./cli.ts";
import { RELAY_NOT_WITH_TUNNEL, relayPairingBlock, relayProblemLines, showRelayPairing } from "./cli-pairing.ts";
import { serviceServeArgs } from "./service-cli.ts";
import type { PhoneRelayStatus } from "./phone-relay.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { startControlPlaneStub } from "./testing/control-plane-stub.ts";

const status = (over: Partial<PhoneRelayStatus> = {}): PhoneRelayStatus => ({ relay: "connected", node: "relay1.cocobot.com", grant: "ok", phones: 1, maxPhones: 20, ...over });
const invite = "cocobot://pair?address=relay-only.invalid%3A443&token=omb_pair_x&e2e=eyJ2IjoxfQ";

describe("cocobot serve --relay", () => {
  it("is off unless asked for, joins any way in but --tunnel, and never a local start", () => {
    expect(parseArgs(["serve"], {})).not.toHaveProperty("relay");
    expect(parseArgs(["serve", "--relay"], {})).toMatchObject({ command: "serve", relay: true, tunnel: false });
    expect(parseArgs(["serve", "--relay", "--domain", "coco.example.com"], {})).toMatchObject({ relay: true, domain: "coco.example.com" });
    expect(parseArgs(["serve", "--tailscale", "--relay"], {})).toMatchObject({ relay: true, tailscale: true });
    expect(parseArgs(["service", "install", "--relay"], {})).toMatchObject({ command: "service", relay: true });
    expect(parseArgs(["serve", "--relay", "--tunnel"], {})).toEqual({ error: "choose one of --relay (phones through CocoBot Relay) and --tunnel (a public address)" });
    expect(parseArgs(["serve", "--tailscale", "--tunnel"], {})).toEqual({ error: "choose one of --tailscale (your tailnet) and --tunnel (a public address)" });
    expect(parseArgs(["--local", "--relay"], {})).toEqual({ error: "--local cannot be combined with a remote-access option" });
  });

  it("prints the relay QR for a phone code, and the usual block for everything else", () => {
    const body = { inviteUrl: invite, expiresAt: Date.now() + 600_000, relay: status() };
    const block = relayPairingBlock(body, true, "cocobot")!;
    expect(block).toContain("Scan with the CocoBot app. It connects through CocoBot Relay, end-to-end encrypted");
    expect(block).toContain("Paired phones: 1 of 20. Remove one: cocobot devices revoke ID");
    expect(relayPairingBlock(body, false, "cocobot")).toBeNull();
    expect(relayPairingBlock({ ...body, relay: undefined }, true, "cocobot")).toBeNull();
    expect(relayPairingBlock({ ...body, inviteUrl: "cocobot://pair?address=https%3A%2F%2Fcoco.example.com&token=omb_pair_x" }, true, "cocobot")).toBeNull();
  });

  it("says why a phone cannot pair yet, in the person's terms", () => {
    expect(relayProblemLines(null, "cocobot")).toEqual(["CocoBot Relay is off on this server. Start it with: cocobot serve --relay"]);
    expect(relayProblemLines(status({ grant: "signed-out", relay: "off" }), "cocobot")[0]).toMatch(/^CocoBot Relay needs this machine signed in to a CocoBot account: cocobot login --relay/);
    expect(relayProblemLines(status({ grant: "unavailable", relay: "off" }), "npx cocobot")[0]).toMatch(/not available for this machine right now\. The server keeps working here/);
    expect(relayProblemLines(status({ relay: "connecting", node: null }), "cocobot")[0]).toMatch(/^Can't reach CocoBot Relay yet\. The server keeps working here/);
    expect(relayProblemLines(status(), "cocobot")).toEqual([]);
    expect(relayProblemLines(status({ grant: "tunnel", relay: "off", reason: "this server runs with --tunnel" }), "cocobot")).toEqual([
      "CocoBot Relay stays off here: this server runs with --tunnel. A relay token would make that tunnel go for good; use the relay on a machine signed in with cocobot login --relay.",
    ]);
  });

  it("waits for the relay before making a code, and makes none it can't use", async () => {
    const reads = [status({ grant: "waiting", relay: "off" }), status({ relay: "connecting" }), status()];
    const lines: string[] = [];
    let minted = 0;
    const mint = async () => `code ${++minted}`;
    expect(await showRelayPairing({ tty: true, status: async () => reads.shift() ?? status(), mint, log: (line) => lines.push(line), prefix: "cocobot", waitMs: 5_000 })).toBe(true);
    expect(lines).toEqual(["code 1"]);

    lines.length = 0;
    expect(await showRelayPairing({ tty: true, status: async () => status({ grant: "signed-out", relay: "off" }), mint, log: (line) => lines.push(line), prefix: "cocobot", waitMs: 0 })).toBe(false);
    expect(minted).toBe(1);
    expect(lines[1]).toBe("Then: cocobot pair --phone");
  });

  it("signs a machine in for the relay without reserving one of the scarce tunnel addresses", async () => {
    const stub = await startControlPlaneStub();
    const dataDir = mkdtempSync(join(tmpdir(), "omb-login-relay-"));
    vi.stubEnv("OMB_CONTROL_PLANE_URL", stub.url);
    try {
      const lines: string[] = [];
      const io = { log: (line: string) => lines.push(line), error: (line: string) => lines.push(`error: ${line}`), ask: async () => stub.otp };
      const options = parseArgs(["login", "--relay", "--email", "vps@example.test", "--data-dir", dataDir], {});
      if ("error" in options) throw new Error(options.error);
      expect(await runLogin(options, io)).toBe(0);
      expect(lines).toEqual(["Signed in as vps@example.test.", "No public address reserved: phones reach this machine through CocoBot Relay.", expect.stringMatching(/^Serve there with: {2}.*serve --relay$/)]);
      expect(stub.calls).toContain("POST /v1/installations");
      expect([...stub.installations.values()].map((installation) => installation.kind)).toEqual(["server"]);
      expect(stub.calls.filter((call) => call.includes("/endpoint"))).toEqual([]);
      const file = join(dataDir, "tunnel-account.json");
      expect(JSON.parse(readFileSync(file, "utf8")).companionInstallationCredential).toMatch(/^omb_install_/);
      if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      vi.unstubAllEnvs();
      await stub.close();
      await removeTempDir(dataDir);
    }
  });

  it("never prints the one-time credential into a service's log", async () => {
    const lines: string[] = [];
    let minted = 0;
    expect(await showRelayPairing({ tty: false, status: async () => status(), mint: async () => `code ${++minted}`, log: (line) => lines.push(line), prefix: "cocobot" })).toBe(false);
    expect(minted).toBe(0);
    expect(lines).toEqual(["Pair a phone: cocobot pair --phone"]);
  });

  it("keeps a saved tunnel choice and the relay apart, and passes --relay to a service", () => {
    const start = (argv: string[]) => {
      const parsed = parseArgs(argv, {});
      if ("error" in parsed) throw new Error(parsed.error);
      return parsed as CliOptions;
    };
    expect(() => applyStartupPreferences(start(["start", "--relay"]), { access: "tunnel" })).toThrow(RELAY_NOT_WITH_TUNNEL);
    expect(applyStartupPreferences(start(["start", "--relay"]), { access: "local" })).toMatchObject({ relay: true, tunnel: false });
    expect(applyStartupPreferences(start(["start", "--relay"]), undefined)).toMatchObject({ relay: true });
    expect(applyStartupPreferences(start(["start"]), { access: "tunnel" })).toMatchObject({ tunnel: true });
    expect(serviceServeArgs({ port: 8799, dataDir: "/d", relay: true })).toEqual(["--port", "8799", "--data-dir", "/d", "--relay"]);
    expect(serviceServeArgs({ port: 8799, dataDir: "/d", domain: "coco.example.com", relay: true })).toEqual(["--port", "8799", "--data-dir", "/d", "--domain", "coco.example.com", "--relay"]);
    expect(serviceServeArgs({ port: 8799, dataDir: "/d" })).toEqual(["--port", "8799", "--data-dir", "/d"]);
  });
});
