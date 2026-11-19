# Billing (Stripe + Razorpay)

CocoBot Cloud sells four tiers — `starter`, `personal`, `pro`, `max` — through a
provider-agnostic billing module in `src/billing.ts`, exposed by the control
plane under `/v1/billing/*`. Both Stripe (global, USD) and Razorpay (India, INR)
are supported; pick one with `BILLING_PROVIDER`, or leave it unset to use
whichever is fully configured (Stripe first).

## Secrets (set with `wrangler secret put <NAME>`)

Never commit these; they live in the Worker's secret store.

Stripe:
- `STRIPE_SECRET_KEY` — `sk_live_...` / `sk_test_...`
- `STRIPE_WEBHOOK_SECRET` — the endpoint's signing secret (`whsec_...`)
- `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PERSONAL`, `STRIPE_PRICE_PRO`,
  `STRIPE_PRICE_MAX` — recurring Price IDs (`price_...`) for each tier

Razorpay:
- `RAZORPAY_KEY_ID` — `rzp_live_...` / `rzp_test_...`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET` — set when adding the webhook in the Razorpay dashboard
- `RAZORPAY_PLAN_STARTER`, `RAZORPAY_PLAN_PERSONAL`, `RAZORPAY_PLAN_PRO`,
  `RAZORPAY_PLAN_MAX` — Plan IDs (`plan_...`) for each tier

## Optional vars (in `wrangler.jsonc`)

- `BILLING_PROVIDER` — `stripe` | `razorpay` (default: first fully configured)
- `RAZORPAY_CURRENCY` — `INR` (default) | `USD`
- `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL` — where Stripe returns the user
  (default `https://app.cocobot.ss2.in/billing/success` and `.../billing`)

A provider is "configured" only when its secret key **and** all four per-tier
price/plan IDs are present. `readBillingConfig` refuses a `BILLING_PROVIDER`
that is not fully configured, so a typo cannot silently bill on the wrong rail.

## Endpoints

- `GET /v1/billing/plans` → `{ provider, plans: [{ tier, label, amountUsdMinor,
  amountInrMinor, interval }] }` (public; powers the pricing UI).
- `POST /v1/billing/checkout` (signed-in) → body `{ tier, successUrl?, cancelUrl? }`.
  Returns a Stripe hosted `url` to redirect to, or a Razorpay `order` (`id`,
  `amount`, `currency`, `keyId`) the client opens with Razorpay Checkout.
- `POST /v1/billing/webhook/stripe` — verify `Stripe-Signature`, then apply
  `checkout.session.completed` / `customer.subscription.*` to the account.
- `POST /v1/billing/webhook/razorpay` — verify `X-Razorpay-Signature`, then
  apply `payment.captured` / `subscription.*`.

Both webhook handlers verify an HMAC-SHA256 signature over the raw body with a
constant-time compare and a 5-minute Stripe timestamp tolerance; a bad signature
is `400 invalid_signature`.

## Wiring a provider dashboard

- **Stripe**: add a webhook endpoint
  `https://accounts.cocobot.ss2.in/v1/billing/webhook/stripe` subscribed to
  `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_failed`. Copy its signing
  secret into `STRIPE_WEBHOOK_SECRET`.
- **Razorpay**: add a webhook URL
  `https://accounts.cocobot.ss2.in/v1/billing/webhook/razorpay` subscribed to
  `payment.captured`, `order.paid`, `subscription.charged`, `subscription.cancelled`.

## Client flow

1. `GET /v1/billing/plans` and render the tiers.
2. On "Subscribe", `POST /v1/billing/checkout` with the chosen `tier`.
3. Stripe → `window.location = result.url`. Razorpay → open Checkout with
   `{ key: result.keyId, order_id: result.id, amount, currency }`.

The webhook handlers currently acknowledge events; apply the entitlement write
in the marked spot once an account store is wired.