# CocoBot billing (PHP + MySQL) for cPanel shared hosting

A self-contained Stripe **and** Razorpay billing backend for selling hosted
CocoBot instances. It runs on ordinary cPanel shared hosting (PHP 8+ and
MySQL/MariaDB) — no Node.js, no background workers, no Cloudflare. The payment
provider webhooks do the work; a cron job is optional.

> This is the **billing / signup** piece. The actual CocoBot instances run on a
> separate Node-capable server (a VPS) via `deploy/install.sh`. See
> "Connecting to instances" below.

## Files

| File | Purpose |
|---|---|
| `index.php` | Pricing page (lists tiers, "Subscribe" buttons) |
| `checkout.php` | Starts a Stripe Checkout Session or a Razorpay order |
| `razorpay-verify.php` | Verifies the Razorpay client payment signature |
| `stripe-webhook.php` | Stripe webhook receiver (signature-verified) |
| `razorpay-webhook.php` | Razorpay webhook receiver (signature-verified) |
| `success.php`, `cancel.php` | Return pages |
| `config.php` | **Edit me** — DB creds, API keys, price/plan IDs |
| `lib.php` | DB, plans, Stripe/Razorpay helpers |
| `schema.sql` | MySQL tables |

## Setup (cPanel)

1. **Create the database**: cPanel → *MySQL Databases*. Create a database and a
   user, add the user to the database (All Privileges). Note the **prefix**
   (e.g. `youruser_cocobot`, `youruser_cbill`).

2. **Import the schema**: open *phpMyAdmin*, select your new database, and run
   `schema.sql` (Import tab). Or paste its contents into the SQL tab.

3. **Upload the files** into a web-accessible folder, e.g.
   `public_html/billing/` (or a subdomain `billing.yourdomain.tld` whose
   document root is that folder).

4. **Edit `config.php`**:
   - `db` — host (`localhost`), name/user/pass with the cPanel prefix.
   - `site_url`, `success_url`, `cancel_url` — your billing URL.
   - `provider` — `auto`, `stripe`, or `razorpay`.
   - Fill in the provider secrets and per-tier price/plan IDs (below).

5. **Stripe** (see also `../cloudflare/control-plane/BILLING.md` for the same
   concepts in the Cloudflare backend):
   - Create a Product per tier and a **recurring Price** for each → copy the
     `price_...` IDs into `config.php` → `stripe.prices`.
   - Dashboard → *Developers → Webhooks → Add endpoint*:
     `https://YOURDOMAIN/stripe-webhook.php`, events
     `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.payment_failed`.
   - Copy the endpoint's signing secret (`whsec_...`) into
     `stripe.webhook_secret`, and your `sk_live_...`/`sk_test_...` into
     `stripe.secret_key`.

6. **Razorpay**:
   - Dashboard → *Settings → API Keys* → copy `rzp_live_...` / `rzp_test_...`
     into `razorpay.key_id` and `razorpay.key_secret`.
   - *Settings → Webhooks → Add*: `https://YOURDOMAIN/razorpay-webhook.php`,
     active events `payment.captured`, `order.paid`, `subscription.charged`,
     `subscription.cancelled`. Set a webhook secret → `razorpay.webhook_secret`.
   - (Optional) create Plans per tier → `razorpay.plans`. Orders are created
     with the amount from `config.php` → `plans`.

7. **Test** with the providers' test keys first, then switch to live keys.

## Connecting to instances (the hosted service)

The `subscriptions` table records, per customer email: `provider`, `plan`,
`status`, `current_period_end`. To run a customer's instance:

1. When a row becomes `status = 'active'`, provision a CocoBot server on your
   VPS: follow `deploy/install.sh --domain <customer>.yourdomain.tld`
   (or run it per customer with Docker).
2. Email the customer their URL + pairing code.
3. When the row leaves `active` (canceled / past_due past grace), stop the
   instance.

Automating step 1 (a small provisioning script on the VPS that reads the DB)
is the natural next step; until then this is a manual but complete flow.

## Security notes

- Serve over **HTTPS** (cPanel AutoSSL / Let's Encrypt). The webhooks and the
  Razorpay/Stripe callbacks require it.
- `config.php` and `lib.php` emit no output when accessed directly, but still
  keep them out of a public folder or add an `.htaccess` rule blocking direct
  access to `config.php`.
- All SQL uses prepared statements; all provider signatures are verified with
  constant-time comparison before anything is written.
- Webhook events are idempotent (recorded in `events`), so retries are safe.