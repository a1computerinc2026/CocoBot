import { describe, expect, it } from "vitest";

import { checkReach, envPublicUrl, lanProblem, localLinkBase, publicUrlProblem, reachLines, waitForReach } from "./cli-reach.ts";

const descriptor = (environmentId: string) => Response.json({ environmentId });

describe("ways in", () => {
  it("--public-url: https anywhere, http only on a private network", () => {
    expect(publicUrlProblem("https://coco.example.com")).toBeNull();
    expect(publicUrlProblem("http://192.168.1.20:8799")).toBeNull();
    expect(publicUrlProblem("http://box.tail1234.ts.net")).toBeNull();
    expect(publicUrlProblem("http://coco.example.com")).toContain("plain http isn't encrypted");
    expect(publicUrlProblem("coco.example.com")).toContain("must start with https://");
  });

  it("OMB_PUBLIC_URL counts as the address unless it is plain http on the open internet", () => {
    const said: string[] = [];
    expect(envPublicUrl({ OMB_PUBLIC_URL: "https://coco.example.com/" }, (line) => said.push(line))).toBe("https://coco.example.com");
    expect(envPublicUrl({ OMB_PUBLIC_URL: "http://coco.example.com" }, (line) => said.push(line))).toBeUndefined();
    expect(envPublicUrl({}, (line) => said.push(line))).toBeUndefined();
    expect(said).toEqual([expect.stringContaining("OMB_PUBLIC_URL is ignored")]);
  });

  it("--lan on a machine with only public addresses says so", () => {
    expect(lanProblem({ lan: ["192.168.1.20"], tailscale: [] })).toBeNull();
    expect(lanProblem({ lan: [], tailscale: [] })).toContain("no private network address");
  });

  it("a browser on the Docker host opens the published port; elsewhere this server's own", () => {
    expect(localLinkBase("http://localhost:8080", 8799, { OMB_CLI_PREFIX: "docker compose exec omb cocobot" })).toEqual({ base: "http://localhost:8080", place: "docker" });
    expect(localLinkBase(null, 8799, {})).toEqual({ base: "http://127.0.0.1:8799", place: "machine" });
    expect(localLinkBase("https://coco.example.com", 8799, {})).toEqual({ base: "http://127.0.0.1:8799", place: "machine" });
  });
});

describe("the Reach line", () => {
  const fetching = (remote: () => Response) => (async (url: string | URL | Request) => (String(url).startsWith("http://127.0.0.1") ? descriptor("mine") : remote())) as typeof fetch;

  it("checks the address answers as this very server, with nothing secret sent", async () => {
    expect(await checkReach(8799, "https://coco.example.com", fetching(() => descriptor("mine")), () => 1)).toEqual({ ok: true, at: 1 });
    expect(await checkReach(8799, "https://coco.example.com", fetching(() => descriptor("someone-else")))).toEqual({ ok: false, kind: "other-server" });
    const refused = fetching(() => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); });
    expect(await checkReach(8799, "https://coco.example.com", refused)).toEqual({ ok: false, kind: "unreachable", reason: "connection refused" });
  });

  it("says what to fix when it doesn't, as a command that pastes", () => {
    expect(reachLines("public-url", "https://coco.example.com", 8799, "npx cocobot", { ok: false, kind: "unreachable", reason: "connection refused" })).toEqual([
      "Reach    ✗ https://coco.example.com doesn't reach this server (connection refused).",
      "           Point your tunnel or proxy at http://127.0.0.1:8799 (on another machine: add --lan and use this machine's address), then run: npx cocobot status",
    ]);
    expect(reachLines("public-url", "https://coco.example.com", 8799, "cocobot", { ok: false, kind: "other-server" })[0]).toContain("answers as a different server");
    expect(reachLines("lan", "http://192.168.1.20:8799", 8799, "cocobot")).toEqual(["Reach    http://192.168.1.20:8799   this network only, not encrypted"]);
    expect(reachLines("tailscale", "https://mini.tail1234.ts.net", 8799, "cocobot", { ok: true, at: Date.parse("2026-11-07T11:04:00") })[0]).toMatch(/✓ answers as this server \(.+\) · your tailnet$/);
  });

  it("waits a while for a tunnel or certificate, then gives up on its budget", async () => {
    let clock = 0, calls = 0;
    const result = await waitForReach(8799, "https://coco.example.com", 3_000, async () => { calls += 1; return { ok: false, kind: "unreachable" }; }, async (ms) => { clock += ms; }, () => clock);
    expect([result.ok, calls]).toEqual([false, 3]);
    calls = 0;
    expect(await waitForReach(8799, "x", 3_000, async () => (++calls === 2 ? { ok: true, at: 1 } : { ok: false, kind: "unreachable" }), async () => {}, () => 0)).toEqual({ ok: true, at: 1 });
  });
});
