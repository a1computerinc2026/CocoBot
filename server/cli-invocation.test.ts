import { describe, expect, it } from "vitest";

import { cliCommand, cliPrefix } from "./cli-invocation.ts";

describe("cliPrefix", () => {
  it("prints commands the way the CLI was started", () => {
    expect(cliPrefix({}, "/home/me/.npm/_npx/1a2b/node_modules/cocobot/dist-server/cocobot.js")).toBe("npx cocobot");
    expect(cliPrefix({ npm_command: "exec" }, "/repo/node_modules/vitest/vitest.mjs"), "another tool run by npx").toBe("cocobot");
    expect(cliPrefix({ npm_lifecycle_event: "omb" }, "/repo/server/cocobot.ts")).toBe("pnpm omb");
    expect(cliPrefix({ OMB_CLI_PREFIX: "docker compose exec omb cocobot" }, "/app/dist-server/cocobot.js")).toBe("docker compose exec omb cocobot");
    expect(cliPrefix({}, "/usr/lib/node_modules/cocobot/dist-server/cocobot.js")).toBe("cocobot");
    expect(cliCommand("pair", {}, "C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\9\\node_modules\\cocobot\\x.js")).toBe("npx cocobot pair");
  });
});
