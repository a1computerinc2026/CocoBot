#!/usr/bin/env node
// Local webhook simulator for the PHP billing backend — a test-mode dry run
// without spending real money or waiting for the provider to call you.
//
// It builds a sample event, signs it the way Stripe/Razorpay would, and POSTs
// it to your webhook URL. A correct signature should return {"received":true};
// a deliberately wrong secret should return 400 invalid_signature.
//
// Usage:
//   node simulate-webhook.mjs stripe   https://billing.yourdomain.tld/stripe-webhook.php   whsec_xxx
//   node simulate-webhook.mjs razorpay https://billing.yourdomain.tld/razorpay-webhook.php rzp_webhook_secret
//
// It also exercises the provisioner hook if you set PROVISIONER_* — but the
// simplest dry run is to point this at your webhook and watch the DB.

import { createHmac } from "node:crypto";

const [provider, url, secret] = process.argv.slice(2);
if (!provider || !url || !secret) {
  console.error("usage: node simulate-webhook.mjs <stripe|razorpay> <webhook-url> <webhook-secret>");
  process.exit(1);
}

const tier = process.env.TIER ?? "pro";
const sample =
  provider === "stripe"
    ? {
      id: "evt_test_" + Date.now(),
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          client_reference_id: tier,
          customer: "cus_test_" + Date.now(),
          subscription: "sub_test_" + Date.now(),
          customer_details: { email: "test-" + Date.now() + "@example.test" },
          amount_total: 4900,
          currency: "usd",
        },
      },
    }
    : {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_test_" + Date.now(),
            order_id: "order_test_existing",
            amount: 399900,
            currency: "INR",
          },
        },
      },
    };

const body = JSON.stringify(sample);
let headers;
if (provider === "stripe") {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  headers = { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` };
} else {
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  headers = { "content-type": "application/json", "x-razorpay-signature": signature };
}

const response = await fetch(url, { method: "POST", headers, body });
const text = await response.text();
console.log(provider, "->", response.status, text.slice(0, 200));

// Negative test: wrong secret must be rejected.
const badHeaders = provider === "stripe"
  ? { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" }
  : { "content-type": "application/json", "x-razorpay-signature": "deadbeef" };
const bad = await fetch(url, { method: "POST", headers: badHeaders, body });
console.log("negative (bad signature) ->", bad.status, (await bad.text()).slice(0, 120));