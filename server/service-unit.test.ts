import { describe, expect, it } from "vitest";

import {
  checkSentinelInstall, launchdPlist, sentinelCommand, sentinelLaunchdPlist, sentinelServicePlan, sentinelSystemdService, sentinelSystemdTimer,
  sentinelUnitCommand, serviceCommand, servicePlan, shippedSentinelCli, systemdUnit, unstableInstallWarning, type ServiceSpec,
} from "./service-unit.ts";

const spec: ServiceSpec = {
  node: "/usr/bin/node",
  script: "/usr/lib/node_modules/cocobot/cli.js",
  serveArgs: ["--port", "8799", "--data-dir", "/home/coco/.cocobot", "--domain", "coco.example.com", "--no-pair"],
  dataDir: "/home/coco/.cocobot",
  user: "coco",
  home: "/home/coco",
  bindsLowPorts: true,
  label: "agentada",
};

describe("service units", () => {
  it("runs the same serve command, with strip-types only for a checkout", () => {
    expect(serviceCommand(spec)).toEqual(["/usr/bin/node", "/usr/lib/node_modules/cocobot/cli.js", "serve", ...spec.serveArgs]);
    expect(serviceCommand({ ...spec, script: "/srv/CocoBot/server/cocobot.ts" })[1]).toBe("--experimental-strip-types");
  });

  it("renders a systemd unit that restarts, runs as the user, and grants low ports only for --domain", () => {
    const unit = systemdUnit(spec);
    expect(unit).toContain("Description=CocoBot (agentada)");
    expect(unit).toContain("User=coco");
    expect(unit).toContain("Environment=OMB_DATA_DIR=/home/coco/.cocobot");
    expect(unit).toContain("ExecStart=/usr/bin/node /usr/lib/node_modules/cocobot/cli.js serve --port 8799 --data-dir /home/coco/.cocobot --domain coco.example.com --no-pair");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("AmbientCapabilities=CAP_NET_BIND_SERVICE");
    expect(unit).toContain("WantedBy=multi-user.target");
    const local = systemdUnit({ ...spec, bindsLowPorts: false, serveArgs: ["--port", "8799", "--data-dir", "/home/coco/.cocobot"] });
    expect(local).not.toContain("CAP_NET_BIND_SERVICE");
    expect(systemdUnit({ ...spec, dataDir: "/home/coco/My Data", serveArgs: ["--data-dir", "/home/coco/My Data"] })).toContain('ExecStart=/usr/bin/node /usr/lib/node_modules/cocobot/cli.js serve --data-dir "/home/coco/My Data"');
  });

  it("renders a launchd agent that keeps the server alive and logs under the data dir", () => {
    const plist = launchdPlist({ ...spec, home: "/Users/coco", dataDir: "/Users/coco/.cocobot" });
    expect(plist).toContain("<string>com.cocobot.serve</string>");
    expect(plist).toContain("<string>/usr/bin/node</string>");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("<string>coco.example.com</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("/Users/coco/.cocobot/logs/service.log");
    expect(launchdPlist({ ...spec, serveArgs: ["--label", "a & b <c>"] })).toContain("<string>a &amp; b &lt;c&gt;</string>");
  });

  it("refuses to point a service at an npx cache, and knows where each platform's file goes", () => {
    expect(unstableInstallWarning("/home/coco/.npm/_npx/abc123/node_modules/cocobot/cli.js")).toMatch(/npm install -g cocobot/);
    expect(unstableInstallWarning("/usr/lib/node_modules/cocobot/cli.js")).toBeNull();
    const linux = servicePlan("linux", "/home/coco/.cocobot");
    expect(linux?.installed).toBe("/etc/systemd/system/cocobot.service");
    expect(linux?.activate.join("\n")).toContain("systemctl enable --now cocobot");
    const mac = servicePlan("darwin", "/Users/coco/.cocobot", "/Users/coco");
    expect(mac?.installed).toBe("/Users/coco/Library/LaunchAgents/com.cocobot.serve.plist");
    expect(mac?.activate.join("\n")).toContain("launchctl bootstrap gui/$(id -u)");
    expect(servicePlan("win32", "C:\\x")).toBeNull();
  });

  it("renders Sentinel as a launchd agent on an interval, under its own label, logging outside the data dir", () => {
    const out = "/Users/coco/Library/Application Support/cocobot-sentinel";
    const sentinel = { node: "/usr/bin/node", script: "/usr/lib/node_modules/cocobot/cli.js", dataDir: "/Users/coco/.cocobot", home: "/Users/coco", out };
    expect(sentinelCommand(sentinel)).toEqual(["/usr/bin/node", "/usr/lib/node_modules/cocobot/cli.js", "sentinel", "--once", "--data-dir", "/Users/coco/.cocobot", "--out", out]);
    expect(sentinelCommand({ ...sentinel, script: "/srv/CocoBot/server/cocobot.ts" })[1]).toBe("--experimental-strip-types");
    const plist = sentinelLaunchdPlist(sentinel);
    expect(plist).toContain("<string>com.cocobot.sentinel</string>");
    expect(plist).toContain("<key>StartInterval</key>\n\t<integer>120</integer>");
    expect(plist).toContain("<string>sentinel</string>");
    expect(plist).not.toContain("KeepAlive");
    expect(plist).toContain(`<string>${out}/sentinel.log</string>`);
    expect(plist).not.toContain(".cocobot/logs");
    const mac = sentinelServicePlan("darwin", out, "/Users/coco");
    expect(mac?.files).toEqual([{ name: "com.cocobot.sentinel.plist", installed: "/Users/coco/Library/LaunchAgents/com.cocobot.sentinel.plist" }]);
    // a path with a space is one argument in the printed commands
    expect(mac?.activate[0]).toBe("mkdir -p /Users/coco/Library/LaunchAgents && cp '/Users/coco/Library/Application Support/cocobot-sentinel/com.cocobot.sentinel.plist' /Users/coco/Library/LaunchAgents/com.cocobot.sentinel.plist");
    expect(mac?.deactivate[0]).toBe("launchctl bootout gui/$(id -u)/com.cocobot.sentinel");
  });

  it("renders Sentinel as a systemd user timer, with no root", () => {
    const sentinel = { node: "/usr/bin/node", script: "/usr/lib/node_modules/cocobot/cli.js", dataDir: "/home/coco/My Data", home: "/home/coco", out: "/home/coco/.local/state/cocobot-sentinel" };
    const unit = sentinelSystemdService(sentinel);
    expect(unit).toContain("Type=oneshot");
    expect(unit).toContain('ExecStart=/usr/bin/node /usr/lib/node_modules/cocobot/cli.js sentinel --once --data-dir "/home/coco/My Data" --out /home/coco/.local/state/cocobot-sentinel');
    expect(unit).not.toContain("User=");
    expect(sentinelSystemdTimer()).toContain("OnUnitActiveSec=120s");
    expect(sentinelSystemdTimer()).toContain("WantedBy=timers.target");
    const linux = sentinelServicePlan("linux", sentinel.out, "/home/coco");
    expect(linux?.files.map((file) => file.installed)).toEqual(["/home/coco/.config/systemd/user/cocobot-sentinel.service", "/home/coco/.config/systemd/user/cocobot-sentinel.timer"]);
    expect(linux?.activate[0]).toContain("cp /home/coco/.local/state/cocobot-sentinel/cocobot-sentinel.service");
    expect(linux?.activate.join("\n")).toContain("systemctl --user enable --now cocobot-sentinel.timer");
    expect(linux?.activate.join("\n")).not.toContain("sudo");
    expect(sentinelServicePlan("win32", "C:\\x")).toBeNull();
  });

  it("finds the CLI the installed desktop app ships, and runs it as Node", () => {
    const app = "/Applications/CocoBot.app/Contents";
    const present = new Set([`${app}/MacOS/CocoBot`, `${app}/Resources/server/cocobot.js`]);
    expect(shippedSentinelCli("darwin", "/Users/coco", (path) => present.has(path))).toEqual({ node: `${app}/MacOS/CocoBot`, script: `${app}/Resources/server/cocobot.js` });
    const user = "/Users/coco/Applications/CocoBot.app/Contents";
    expect(shippedSentinelCli("darwin", "/Users/coco", (path) => path.startsWith(user))?.script).toBe(`${user}/Resources/server/cocobot.js`);
    expect(shippedSentinelCli("linux", "/home/coco", (path) => path.startsWith("/opt/CocoBot/"))).toEqual({ node: "/opt/CocoBot/cocobot", script: "/opt/CocoBot/resources/server/cocobot.js" });
    // an app with its script missing, or one released before Sentinel, is no CLI for it
    expect(shippedSentinelCli("darwin", "/Users/coco", (path) => path.endsWith("MacOS/CocoBot"))).toBeNull();
    expect(shippedSentinelCli("darwin", "/Users/coco", (path) => present.has(path), () => false)).toBeNull();
    expect(shippedSentinelCli("win32", "C:\\Users\\coco", () => true)).toBeNull();

    const spec = { node: `${app}/MacOS/CocoBot`, script: `${app}/Resources/server/cocobot.js`, dataDir: "/Users/coco/.cocobot", home: "/Users/coco", out: "/tmp/s", electronRunAsNode: true };
    expect(sentinelLaunchdPlist(spec)).toContain("<key>ELECTRON_RUN_AS_NODE</key>\n\t\t<string>1</string>");
    expect(sentinelSystemdService(spec)).toContain("Environment=ELECTRON_RUN_AS_NODE=1");
    expect(sentinelLaunchdPlist({ ...spec, electronRunAsNode: false })).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("keeps every path one quoted value in the systemd unit, and refuses one no unit can hold", () => {
    const spec = { node: "/usr/bin/node", script: "/srv/omb/cli.js", dataDir: "/home/coco/100% $HOME\\", home: "/home/my coco", out: "/home/my coco/.local/state/cocobot-sentinel" };
    const unit = sentinelSystemdService(spec);
    expect(unit).toContain('Environment="HOME=/home/my coco"');
    // % is no specifier, $ no variable, and the trailing backslash no continuation
    expect(unit).toContain('"/home/coco/100%% $$HOME\\\\"');
    expect(sentinelUnitCommand(unit)).toEqual({ node: "/usr/bin/node", script: "/srv/omb/cli.js" });
    expect(sentinelUnitCommand(sentinelSystemdService({ ...spec, script: "/srv/100% $x/cli.js" }))?.script).toBe("/srv/100% $x/cli.js");
    for (const bad of ["/home/coco\n[Service]\nExecStartPre=/bin/true", "/home/coco\r", "/home/\0coco"]) {
      expect(() => sentinelSystemdService({ ...spec, home: bad })).toThrow(/line break or NUL/);
      expect(() => sentinelLaunchdPlist({ ...spec, dataDir: bad })).toThrow(/line break or NUL/);
    }
  });

  it("reads back what an installed unit runs, and calls it stale when either path is gone", () => {
    const spec = { node: "/opt/node & co/bin/node", script: "/srv/omb/cli.js", dataDir: "/home/coco/My Data", home: "/home/coco", out: "/home/coco/.local/state/cocobot-sentinel" };
    expect(sentinelUnitCommand(sentinelLaunchdPlist(spec))).toEqual({ node: "/opt/node & co/bin/node", script: "/srv/omb/cli.js" });
    expect(sentinelUnitCommand(sentinelSystemdService(spec))).toEqual({ node: "/opt/node & co/bin/node", script: "/srv/omb/cli.js" });
    expect(sentinelUnitCommand("[Service]\nType=oneshot\n")).toBeNull();

    const unit = "/home/coco/.config/systemd/user/cocobot-sentinel.service";
    const timer = "/home/coco/.config/systemd/user/cocobot-sentinel.timer";
    const files = new Map([[unit, sentinelSystemdService(spec)]]);
    const fs = (present: string[]) => ({ exists: (path: string) => files.has(path) || present.includes(path), read: (path: string) => files.get(path)! });
    expect(checkSentinelInstall("linux", "/home/coco", fs([spec.node, spec.script, timer]))).toMatchObject({ status: "ok", unit });
    expect(checkSentinelInstall("linux", "/home/coco", fs([spec.node, timer]))).toMatchObject({ status: "stale", missing: ["/srv/omb/cli.js"] });
    // the service without its timer never runs
    expect(checkSentinelInstall("linux", "/home/coco", fs([spec.node, spec.script]))).toMatchObject({ status: "stale", missing: [timer] });
    expect(checkSentinelInstall("darwin", "/Users/coco", fs([]))).toEqual({ status: "not_installed", unit: "/Users/coco/Library/LaunchAgents/com.cocobot.sentinel.plist" });
    files.set(unit, "garbage");
    expect(checkSentinelInstall("linux", "/home/coco", fs([]))).toEqual({ status: "unreadable", unit });
    expect(checkSentinelInstall("win32", "C:\\Users\\coco", fs([]))).toEqual({ status: "unsupported" });
  });
});
