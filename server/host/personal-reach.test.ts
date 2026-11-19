import { describe, expect, it } from "vitest";

import type { BotAccessLevel } from "../../shared/bot-access.ts";
import { resolveTeammate, unreachableTeammate, type RosterMember } from "../peer-roster.ts";
import { createPersonalReach } from "./personal-reach.ts";

const MIRA = "mira@acme.test";
const key = (email: string) => `p_${email.replace(/\W/g, "").padEnd(22, "x").slice(0, 22)}`;
const cocobot: RosterMember = { id: "coco", name: "CocoBot", defaultBot: { person: MIRA }, visibility: { people: [MIRA] } };
const bensCocobot: RosterMember = { id: "ben-coco", name: "CocoBot", defaultBot: { person: "ben@acme.test" }, visibility: { people: ["ben@acme.test"] } };
const sales: RosterMember = { id: "sales", name: "Sales" };
const archive: RosterMember = { id: "archive", name: "Archive" };
const payroll: RosterMember = { id: "payroll", name: "Payroll", visibility: { people: ["ben@acme.test"] } };
const gone: RosterMember = { id: "gone", name: "Gone", hidden: true };
const bots = [cocobot, bensCocobot, sales, archive, payroll, gone];
const levels: Record<string, BotAccessLevel> = { sales: "chat", archive: "view", payroll: "none", gone: "chat", "ben-coco": "edit" };
const privateTo: Record<string, string | null> = { mine: key(MIRA), bens: key("ben@acme.test"), shared: null };

function world(acting: string | null = key(MIRA), behind = true) {
  return createPersonalReach({
    privateTo: (threadId) => privateTo[threadId] ?? null,
    personKey: key,
    level: (bot) => levels[bot.id] ?? "none",
    personBehind: () => behind,
    actingFor: () => acting,
  });
}

describe("a person's own CocoBot reaching the team's bots", () => {
  it("reaches only the bots its person may chat with, from a chat private to them", () => {
    expect(world().peers(bots, cocobot, "mine").map((bot) => bot.id)).toEqual(["sales"]);
    expect(world().reaches(cocobot, sales, "shared")).toBe(false);
    expect(world().reaches(cocobot, sales, "bens")).toBe(false);
    expect(world().reaches(sales, archive, "mine"), "any other bot keeps the audience rule").toBe(false);
  });

  it("lists nothing, and hands nothing on, when its person's own request is not behind the turn", () => {
    expect(world(key(MIRA), false).peers(bots, cocobot, "mine")).toEqual([]);
    expect(world(null).handOnProblem(cocobot, sales, "mine", "turn")).toMatch(/routine, an event or a line another app passed on/);
    expect(world().handOnProblem(cocobot, sales, "mine", "turn")).toBeUndefined();
  });

  it("never names a bot its person cannot see, nor another person's CocoBot", () => {
    for (const hidden of [payroll, bensCocobot]) {
      expect(world().hides(cocobot, hidden)).toBe(true);
      expect(world().refusal(cocobot, hidden, "mine")).toBe(`No bot with id "${hidden.id}" — call list_bots and copy the exact id from the result`);
      expect(unreachableTeammate(bots, cocobot, hidden.name, (bot) => world().hides(cocobot, bot))?.id).not.toBe(hidden.id);
    }
    const wider = (reach = world()) => ({ reaches: (bot: RosterMember) => reach.listed(cocobot, bot, "mine"), hides: (bot: RosterMember) => reach.hides(cocobot, bot), refusal: (bot: RosterMember) => reach.refusal(cocobot, bot, "mine") });
    const unknown = resolveTeammate(bots, cocobot, "Nobody", undefined, undefined, wider());
    expect(resolveTeammate(bots, cocobot, "Payroll", undefined, undefined, wider())).toEqual({ error: (unknown as { error: string }).error.replaceAll("Nobody", "Payroll") });
    expect(resolveTeammate(bots, cocobot, "payroll", undefined, undefined, wider())).not.toEqual({ id: "payroll", byName: false });
    // "Sales" is this bot's id in another case, which names it as its id would (byName false).
    expect(resolveTeammate(bots, cocobot, "Sales", undefined, undefined, wider())).toEqual({ id: "sales", byName: false });
    expect(resolveTeammate(bots, cocobot, "@sales", undefined, undefined, wider())).toEqual({ id: "sales", byName: true });
  });

  it("refuses a bot its person can only view, and says so", () => {
    expect(world().reaches(cocobot, archive, "mine")).toBe(false);
    expect(world().refusal(cocobot, archive, "mine")).toMatch(/view only/);
  });

  it("carries placed work only in a thread private to the same person, traced to their request", () => {
    const placed = (threadId: string, kind: "user" | "outside" = "user") => ({ id: "as_1", threadId, origin: kind === "user" ? { kind, request: "pull Q3" } as const : { kind } as const });
    expect(world().carries(cocobot, sales, "mine", placed("mine"))).toBe(true);
    expect(world().carries(cocobot, sales, "mine", placed("shared"))).toBe(false);
    expect(world().carries(cocobot, sales, "mine", placed("bens"))).toBe(false);
    expect(world().carries(cocobot, sales, "mine", placed("mine", "outside"))).toBe(false);
  });

  it("hands on only in its person's own name, and leaves every other hand-off to the usual rules", () => {
    expect(() => world().checkHandOn(cocobot, sales, "mine", key(MIRA))).not.toThrow();
    expect(() => world().checkHandOn(cocobot, sales, "mine", key(MIRA), { threadId: "mine" })).not.toThrow();
    expect(() => world().checkHandOn(cocobot, sales, "mine", key("ben@acme.test"))).toThrow(/person's own chats/);
    expect(() => world().checkHandOn(cocobot, sales, "mine", key(MIRA), { threadId: "bens" })).toThrow(/person's own chats/);
    expect(() => world().checkHandOn(cocobot, sales, "mine", key(MIRA), {})).toThrow(/person's own chats/);
    expect(() => world().checkHandOn(cocobot, archive, "mine", key("ben@acme.test"))).not.toThrow();
    expect(() => world().checkHandOn(sales, archive, "mine", key("ben@acme.test"))).not.toThrow();
  });

  it("answers a waiting question only in its person's own chats", () => {
    expect(world().mayAnswerIn("mine", "mine")).toBe(true);
    expect(world().mayAnswerIn("mine", "bens")).toBe(false);
    expect(world().mayAnswerIn("shared", "shared")).toBe(false);
  });
});
