# CocoBot — Security & Quality Audit (2026-11-19)

**Auditor:** Hostile Goldfish protocol (security-scrutiny) + static SEO/quality pass.
**Scope:** whole repo, with focus on the newly added `hosting/billing/` (PHP) and
`hosting/provisioner/` (Node), plus the desktop app (`electron/`, `src/`) and
server.
**Note on "elephant":** that didn't map to an available tool/skill, so this run
used the available tooling — Hostile Goldfish (security), a static SEO pass, and
code-quality checks. If you meant a specific scanner, tell me which and I'll run it.

## Verdict

No **Critical** issues. The desktop app is well hardened. The findings below are
concentrated in the new billing/provisioning code and are mostly **Medium/Low
hygiene**. None are release-blocking, but the Medium items are worth fixing before
taking real payments.

---

## Findings

### Medium

**M1 — Provisioner: unbounded request body (DoS).**
`hosting/provisioner/server.mjs` `readBody()` reads the entire request into
memory with no cap. A caller with the shared secret (or any bug) could send a huge
body and exhaust memory.
*Fix:* cap the body, e.g. reject `content-length` > 64 KB and stop reading past it.

**M2 — Checkout accepts GET (`$_REQUEST`), allowing link-driven order creation.**
`hosting/billing/checkout.php` reads `tier`/`provider` from `$_REQUEST` (GET or
POST). A crafted `GET checkout.php?tier=pro` link creates an unpaid Stripe session
/ Razorpay order (resource creation, not a charge). Low real impact, but prefer
POST-only.
*Fix:* read from `$_POST` only; return 405 for GET.

**M3 — Billing responses lack security headers; webhooks unthrottled.**
`hosting/billing/*.php` send no `Content-Security-Policy`, `X-Content-Type-Options`,
or `X-Frame-Options`, and the webhook endpoints have no rate limiting.
*Fix:* add headers in `.htaccess` (`Header set X-Content-Type-Options "nosniff"`,
`Header set X-Frame-Options "DENY"`, a strict `Content-Security-Policy`), and add a
simple per-IP throttle for the webhook/verify paths.

**M4 — Provisioner: `plan` not validated against the tier list.**
`provision()` stores whatever `plan` string arrives. In MySQL strict mode an
unknown value errors the ENUM (500); otherwise it stores garbage.
*Fix:* validate `plan` ∈ {starter,personal,pro,max}; default to `pro`.

### Low

**L1 — External `<script>` without SRI.**
- `hosting/billing/checkout.php:47` loads `https://checkout.razorpay.com/v1/checkout.js` (provider script — no stable SRI published; acceptable, but keep it HTTPS-only).
- `skills/data-dashboards/dashboard.html` (echarts via jsdelivr) and `shared/app-samples.ts` (Chart.js via cdnjs) — skill/sample templates. Add `integrity`+`crossorigin` where the CDN publishes stable hashes.

**L2 — Secrets in a web-served file.**
`hosting/billing/config.php` holds API keys. `.htaccess` blocks direct HTTP access, but best practice is to keep it outside the web root (or confirm 403 on direct access).

**L3 — No CSP on the PHP pages** (see M3). A strict CSP is cheap here since the pages are static-ish.

**L4 — Dev tool in webroot.**
`hosting/billing/simulate-webhook.mjs` is a local test helper — do not deploy it to the production web root.

**L5 — Razorpay webhook idempotency key.**
Keyed on `event:entityId`; the classic payload has no top-level event id. Fine as-is, but prefer a stable id when Razorpay includes one.

---

## What's done right (verified)

- **Electron hardened everywhere:** every `BrowserWindow`/`WebContentsView` uses
  `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity: true`, `allowRunningInsecureContent: false`.
- **No model HTML → DOM:** `ChatMarkdown.tsx` documents "model output never reaches
  the DOM as raw HTML (no rehype-raw); Shiki output is generator-escaped";
  `MarkdownTable` "never renders model-authored raw HTML". The
  `dangerouslySetInnerHTML` uses are escaped/controlled.
- **Bot apps sandboxed:** `shared/app-frame/csp.ts` serves bot HTML under a CSP
  (`default-src 'none'` base) in isolated frames.
- **PHP billing:** PDO prepared statements everywhere (no string-concatenated SQL);
  HMAC-SHA256 webhook verification with `hash_equals` (constant-time) + Stripe
  5-minute tolerance; idempotent `events` table.
- **Provisioner:** `execFileSync` with argv arrays (no shell interpolation → no
  command injection); `timingSafeEqual` for the shared secret.
- **No hardcoded secrets:** only placeholders/fixtures (`*_replace_me`, test keys).
- **No `eval`/`new Function`** in production code.

---

## SEO (static — no live URL to measure)

Core Web Vitals / Lighthouse require a **deployed URL**; none exists yet, so this
is a static review only.

- **Billing/marketing page (`hosting/billing/index.php`)**: has `lang` + `title`
  but no `<meta name="description">`, no `<link rel="canonical">`, no Open Graph
  tags. If this page is public, add description/canonical/OG. (Pricing pages rarely
  earn rich results; optional `Product`/`Offer` JSON-LD is fine but not required.)
- **Docs site (`apps/docs`, Fumadocs/Next.js):** should emit sitemap + robots and
  per-page metadata automatically — verify after deploy (run Lighthouse then).
- **Action:** once deployed, run `npx lighthouse <url> --only-categories=performance,seo`
  and collect field CrUX data; that's the only way to confirm CWV.

---

## Fixes applied (2026-11-19)

- **M1** — `hosting/provisioner/server.mjs`: `readBody` caps requests at 64 KB.
- **M2** — `hosting/billing/checkout.php`: POST-only (405 on GET); reads `$_POST`.
- **M3** — `hosting/billing/.htaccess`: added `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, and a CSP (self + Razorpay, no framing);
  `lib.php` adds `rate_limited()` and the webhook/verify handlers call it (429).
- **M4** — `hosting/provisioner/server.mjs`: `provision()` validates `plan` against
  {starter,personal,pro,max} (defaults to `pro`).

## Recommended order to fix

1. M1 (body cap) + M4 (validate plan) — small, in the provisioner.
2. M2 (POST-only checkout).
3. M3 (security headers via `.htaccess`; basic webhook throttle).
4. L1–L4 as hardening.