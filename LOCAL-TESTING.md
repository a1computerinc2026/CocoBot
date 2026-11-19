# Testing CocoBot locally (PC) and on the Cloud VPS

Three pieces run in different places: the **CocoBot app/server** (PC or VPS),
the **billing** PHP app (PC via XAMPP, or cPanel), and the **provisioner**
(VPS, Docker + Caddy). Work through them in order.

---

## 1. CocoBot app on your PC (Windows)

```powershell
cd "C:\Users\Arif Aziz\Downloads\Test Folder\CocoBot"
pnpm install
# Terminal 1 — the harness server on 127.0.0.1:8799:
pnpm dev:server
# Terminal 2 — the Electron desktop app:
pnpm dev:desktop
```
Add a provider key in Settings → AI, then chat. `pnpm typecheck` and `pnpm test`
confirm the build is healthy.

---

## 2. Billing (PHP) locally — no real money

Install **XAMPP** (Apache + PHP + MySQL): https://www.apachefriends.org

1. Start **Apache** + **MySQL** in the XAMPP panel.
2. phpMyAdmin (http://localhost/phpmyadmin) → create database `cocobot_billing`
   → **Import** `hosting/billing/schema.sql`.
3. Edit `hosting/billing/config.php`: `db.user = root`, `db.pass = ''`,
   `db.name = cocobot_billing`, `stripe.webhook_secret = 'testsecret'`.
4. Serve the folder with XAMPP's PHP (bypasses the `.htaccess` HTTPS redirect
   that would otherwise break local http):
   ```powershell
   C:\xampp\php\php.exe -S localhost:8080 -t "C:\Users\Arif Aziz\Downloads\Test Folder\CocoBot\hosting\billing"
   ```
   Open http://localhost:8080/index.php → the four plans should appear.
5. Dry-run the webhook (signs locally, no Stripe account):
   ```powershell
   node hosting/billing/simulate-webhook.mjs stripe http://localhost:8080/stripe-webhook.php testsecret
   ```
   Expect `stripe -> 200 {"received":true}` and `negative ... -> 400`.
6. In phpMyAdmin confirm a `customers` row, a `subscriptions` row
   (`status = active`), and an `events` row exist.

> Razorpay's local webhook needs an order first (do a test checkout or insert an
   `orders` row) because it looks up the order's tier. Stripe is the easy full
   local test. For a real Stripe test, use the Stripe CLI:
   `stripe listen --forward-to http://localhost:8080/stripe-webhook.php` and pay
   with card `4242 4242 4242 4242`.

---

## 3. Provisioner on the Cloud VPS (Ubuntu)

```bash
# from the CocoBot repo on the VPS:
curl -fsSL https://get.docker.com | sh

# Run the provisioner (placeholder image proves the flow; swap for the real image later)
sudo PROVISIONER_SHARED_SECRET=testsecret \
     COCO_DOMAIN=cocobot.example.com \
     COCO_IMAGE=nginx:latest \
     node hosting/provisioner/server.mjs
```
Smoke-test it (automatic):

```bash
PROVISIONER_KEY=testsecret bash hosting/provisioner/test.sh
```
Or manually:
```bash
curl -s -X POST localhost:9000/provision -H "X-Provisioner-Key: testsecret" \
  -H 'Content-Type: application/json' -d '{"email":"test@example.com","plan":"pro"}'
docker ps
curl -s -X POST localhost:9000/deprovision -H "X-Provisioner-Key: testsecret" \
  -H 'Content-Type: application/json' -d '{"email":"test@example.com"}'
```

**For the real HTTPS + CocoBot:**
1. Build a real image (`docker build -t cocobot:test .`) and set `COCO_IMAGE=cocobot:test`.
2. Wildcard DNS `*.cocobot.example.com` → VPS IP; install Caddy; copy
   `hosting/provisioner/Caddyfile.example` to `/etc/caddy/Caddyfile` (edit domains).
3. `https://<id>.cocobot.example.com` then serves the customer's CocoBot (auto-TLS).

---

## 4. Full end-to-end (billing → provisioner)

1. In `config.php`: `provisioner.url = https://api.cocobot.example.com`,
   `provisioner.shared_secret = testsecret` (match the VPS).
2. Run the provisioner with Caddy exposing `api.cocobot.example.com → 127.0.0.1:9000`.
3. Trigger a payment (simulate-webhook or a Stripe test checkout).
4. **Success =** a `subscriptions` row `active` **and** `docker ps` on the VPS
   shows the customer's container at its subdomain.
5. Cancel/refund → the row becomes `canceled` and the container is removed.

---

## What "working" looks like

| Layer | Pass condition |
|---|---|
| App | chat replies |
| Billing | `200 {"received":true}`; DB rows created; bad signature → `400` |
| Provisioner | `/provision` creates a container, `/deprovision` removes it, wrong key → `401` |
| End-to-end | paying customer → live CocoBot at their URL; lapse → instance gone |