export { HEADLESS_VERBS as HEADLESS_VERB_NAMES } from "./headless/args.ts";

export const HEADLESS_USAGE = `Drive a running workspace (scripts, CI, other agents):
  cocobot doctor                    check the server answers and an engine is ready
  cocobot doctor --host             check this Linux machine can run a server (exit 7 if not)
  cocobot doctor --data [--fix]     check (and safely repair) this computer's data folder (exit 8 if a problem is left)
  cocobot bots | channels | models  your bots, your rooms, the engines and their models
  cocobot run BOT "do this"         give a bot one job and wait until it and every teammate it asked are done
  cocobot send BOT "text"           send one message and return at once
  cocobot wait BOT                  wait on work already running
  cocobot messages BOT              the latest messages of a conversation
  cocobot interrupt BOT [--tree]    press Stop (--tree: and every teammate on its job)
  cocobot export BOT --out DIR      write a job's transcripts, files and screens to DIR
  cocobot events [--job THREAD]     the server's live events as JSON lines
  cocobot team apply FILE           make the workspace match a team file (team export writes one)
  cocobot engine set claude --key-env ANTHROPIC_API_KEY   give it an engine without a screen
  cocobot connect URL --code CODE --out FILE              get a token for a workspace elsewhere
  cocobot token create NAME --out FILE [--expires 90d]    a token for CI that ends on its date (token list, token revoke ID)
  cocobot new-bot | new-channel | set-model | edit | mcp

  Server: --url URL (or COCOBOT_URL), --port N (or OMB_PORT), else this computer's.
  Token: COCOBOT_TOKEN or --token-file FILE. --json prints one JSON document;
  progress goes to stderr (--quiet drops it). cocobot help VERB for the details.`;

/** The usage text, its commands written the way this CLI was started (`npx cocobot …`). */
export function usage(prefix = "cocobot"): string {
  return USAGE.split("\n").map((line) => line.replace(/^(\s+)cocobot(?= )/, `$1${prefix}`)).join("\n");
}

export const USAGE = `cocobot — your team of AI bots, ready in a few steps

  cocobot                         set up once, then open your workspace
  cocobot setup [--data-dir DIR]
  cocobot start [the same options as serve]
  cocobot serve [--port 8799] [--data-dir DIR] [--label NAME]
                    [--public-url https://host | --domain HOST | --tunnel | --tailscale] [--lan] [--relay]
  cocobot pair  [--label NAME] [--phone [ios|android]] [--ttl 24h] [--public-url https://host]
  cocobot devices [revoke ID]
  cocobot status
  cocobot --version
  cocobot login [--email you@example.com] [--relay]
  cocobot logout
  cocobot access list | add EMAIL [--chat-only] | remove EMAIL
  cocobot service install [the same way-in options as serve] [--port N] [--data-dir DIR] | uninstall
                    [--sentinel]   (the health scan below, every two minutes, instead of the server)
  cocobot sentinel [--data-dir DIR] [--out DIR] [--once] [--json]   (read-only health scan; see --help)
  cocobot config backups | restore NAME    (dated copies of the settings file; see --help)
  cocobot browser install [--with-deps] | status
  cocobot fleet init --domain HOST [--operator USER] | create NAME --admin EMAIL [--member EMAIL] [--brand FILE]
                    [--anthropic-key-file FILE] [--cap USD] [--license-key KEY] [--memory 1G]
                  | list | users NAME add|remove EMAIL [--chat-only] | suspend NAME | resume NAME
                  | delete NAME --yes [--keep-data] | upgrade   (all take --dry-run)
                  | agent [--socket PATH] [--group USER]   (root; installed by init --operator)

setup   choose AI access and optional phone access; keep existing bots and chats
start   same as cocobot: use your saved settings and open the workspace
serve   starts the server without prompts; in a terminal it prints a pairing
        code, the link to paste into the desktop app (＋ → Connect to a
        server) and a QR for a phone
pair    a new pairing code for the running server, with its link and QR
        (--phone: chat and approvals only; --ttl keeps it open up to 24h,
        still single use)
devices lists paired devices; "devices revoke ID" signs one out
status  the running server, the address others reach it at, and whether
        that address answers as this server
login   signs this machine in to an CocoBot account (an emailed code)
        and reserves its public address for --tunnel; with --relay it
        reserves none, for serve --relay
logout  releases that address and signs out
access  who may sign in with an emailed code at /pair: an address or
        @domain; --chat-only gives chat and approvals without settings.
        Takes effect at once, no restart.
service keep the server running across reboots: writes a systemd unit
        (Linux) or a launchd agent (macOS) for the same serve options and
        prints the commands that install it. Run from npx, it first
        installs a copy of this version next to your data for the service.
browser install: the bots' browser engine (agent-browser, pinned) into the
        data dir, and Chrome for Testing into the user's browser cache.
        --with-deps also installs
        the Linux libraries Chrome needs (run as root once). Then run
        browser install as the user running serve, from that user's home.
        status: what the current user and data directory have.
fleet   many client workspaces on one Linux server, each its own account,
        service, data folder, brand, sign-in list and keys at NAME.HOST
        behind the system Caddy. Plans are printed unless run as root;
        --dry-run always prints. Install the package permanently first.
        init --operator USER also installs the fleet agent, a root service
        on a Unix socket only USER may open, so the workspace running as
        USER manages the others from Settings → Installations.

Ways in (pick one; --lan can join any):
--public-url you already have HTTPS in front (cloudflared, Caddy, nginx):
             the link uses that address, after checking it reaches this
             server. http:// is accepted only for a private network address.
--lan        this network only, plain http: listens on this machine's
             private addresses and answers nobody on the open internet
--tailscale  serve over your tailnet: Tailscale terminates HTTPS and the
             link uses this machine's MagicDNS name (needs Tailscale signed in
             and HTTPS certificates enabled for the tailnet); the share ends
             when serve stops
--tunnel     serve at a public https://c-… address through a
             Cloudflare tunnel: no domain, no proxy, no open port. Run
             \`cocobot login\` once on this machine first.
--domain     serve at https://HOST on your own domain: a pinned Caddy is
             downloaded once and run alongside the server, and gets the
             certificate itself. Point the domain's DNS at this machine and
             open ports 80 and 443.

--relay      phones only, and it can join any of the above except --tunnel:
             the CocoBot phone app pairs by QR through CocoBot Relay,
             end-to-end encrypted, with no address, open port or VPN. Run
             \`cocobot login --relay\` once on this machine first. Not on a
             machine with a tunnel address: the relay stays off there.

--no-open   do not open a browser window
--no-pair   do not print a pairing code
--local     start locally this time, ignoring saved remote-access settings

${HEADLESS_USAGE}

Install once with \`npm install -g cocobot\`, then type \`cocobot\`.
Or run without a global install: \`npx cocobot\`. Node 24+ is required.
`;
