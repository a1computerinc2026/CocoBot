# Test-mode dry run (Stripe + Razorpay) before going live

Do all of this with the providers' **test** keys first. Nothing is charged and
no real instance is created until you switch to live keys.

## 0. One-time prerequisites
- Enable **AutoSSL** in cPanel (SSL/TLS Status) for the billing domain and run
  the `.htaccess` HTTPS redirect — webhooks and the Razorpay/Stripe callbacks
  require HTTPS.
- Import `schema.sql`, fill `config.php` with test keys, set
  `provider = 'auto'` (or `stripe` / `razorpay`).

## 1. Stripe (test)
- Get test keys: `sk_test_...` → `stripe.secret_key`.
- **Local webhook testing (easiest):** install the Stripe CLI, run
  `stripe listen --forward-to https://YOURDOMAIN/stripe-webhook.php`
  (or `--forward-to localhost:.../stripe-webhook.php` if testing locally).
  Copy the printed `whsec_...` into `stripe.webhook_secret`.
- Create four **recurring Prices** (one per tier) in test mode → put the
  `price_...` IDs into `stripe.prices`.
- Buy with test card **4242 4242 4242 4242**, any future expiry / CVC.
- **Or** simulate without Stripe: 
  `node simulate-webhook.mjs stripe https://YOURDOMAIN/stripe-webhook.php <whsec>`
- Verify: a `subscriptions` row appears with `status = active`, and (if the
  provisioner is configured) a CocoBot container starts on the VPS.

## 2. Razorpay (test)
- Get test keys: `rzp_test_...` / key secret → `razorpay.key_id` / `key_secret`.
- Razorpay dashboard → *Settings → Webhooks* → add
  `https://YOURDOMAIN/razorpay-webhook.php`, set a secret →
  `razorpay.webhook_secret`, enable `payment.captured`, `order.paid`.
- Do a test payment with a **test** method (test UPI / test card shown in the
  Razorpay test checkout). 
- Verify: a `subscriptions` row appears `active` and the VPS instance starts.

## 3. Full dry-run checklist
- [ ] `index.php` shows the four plans and a Subscribe button.
- [ ] Stripe checkout redirects to Stripe and returns to `success.php`.
- [ ] Razorpay checkout opens, pays, and lands on `success.php`.
- [ ] `customers` + `subscriptions` rows created; `status = active`.
- [ ] `events` table records each webhook once (no duplicate processing on
      provider retries).
- [ ] The provisioner created a container (`GET /instances` on the VPS).
- [ ] Cancel/refund flow: a `subscription.deleted` / `subscription.cancelled`
      sets `status = canceled` and deprovisions the instance.
- [ ] `simulate-webhook.mjs` negative case returns **400** for a bad signature.

## 4. Going live
- Swap every `test`/`whsec` value for the **live** keys in `config.php`.
- Use the live webhook URLs + live secrets in both dashboards.
- Confirm AutoSSL is active (https only).
- Set `provider` to your chosen rail (or leave `auto`).
- Keep `config.php` out of public access (`.htaccess` already blocks it).