import { describe, expect, it, vi } from "vitest";

import {
  createCheckout,
  PLAN_CATALOG,
  PLAN_TIERS,
  planCatalog,
  readBillingConfig,
  verifyRazorpayWebhook,
  verifyStripeWebhook,
  type BillingConfig,
} from "../src/billing";

const encoder = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const STRIPE_ENV = {
  BILLING_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
  STRIPE_PRICE_STARTER: "price_starter",
  STRIPE_PRICE_PERSONAL: "price_personal",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_MAX: "price_max",
};
const RAZORPAY_ENV = {
  BILLING_PROVIDER: "razorpay",
  RAZORPAY_KEY_ID: "rzp_test_id",
  RAZORPAY_KEY_SECRET: "rzp_test_secret",
  RAZORPAY_WEBHOOK_SECRET: "rzp_webhook_secret",
  RAZORPAY_PLAN_STARTER: "plan_starter",
  RAZORPAY_PLAN_PERSONAL: "plan_personal",
  RAZORPAY_PLAN_PRO: "plan_pro",
  RAZORPAY_PLAN_MAX: "plan_max",
};

describe("readBillingConfig", () => {
  it("selects stripe when it is fully configured", () => {
    const config = readBillingConfig(STRIPE_ENV);
    expect(config.provider).toBe("stripe");
    expect(config.stripe?.prices.pro).toBe("price_pro");
  });

  it("selects razorpay when it is fully configured", () => {
    expect(readBillingConfig(RAZORPAY_ENV).provider).toBe("razorpay");
  });

  it("throws billing_unconfigured when nothing is configured", () => {
    expect(() => readBillingConfig({})).toThrowError();
  });

  it("refuses a requested provider that is not fully configured", () => {
    expect(() => readBillingConfig({ ...STRIPE_ENV, BILLING_PROVIDER: "razorpay" })).toThrowError();
  });
});

describe("planCatalog", () => {
  it("lists every tier with display amounts", () => {
    const catalog = planCatalog(STRIPE_ENV);
    expect(catalog.provider).toBe("stripe");
    expect(catalog.plans.map((plan) => plan.tier)).toEqual([...PLAN_TIERS]);
    expect(PLAN_CATALOG.pro.amountUsdMinor).toBeGreaterThan(0);
  });

  it("reports no provider when billing is unconfigured", () => {
    expect(planCatalog({}).provider).toBeNull();
  });
});

describe("verifyStripeWebhook", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });

  it("accepts a correct signature", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await hmacHex(secret, `${timestamp}.${body}`);
    const header = `t=${timestamp},v1=${signature}`;
    await expect(verifyStripeWebhook(body, header, secret)).resolves.toBe(true);
  });

  it("rejects a tampered body", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await hmacHex(secret, `${timestamp}.${body}`);
    const header = `t=${timestamp},v1=${signature}`;
    await expect(verifyStripeWebhook(`${body} `, header, secret)).resolves.toBe(false);
  });

  it("rejects a stale timestamp outside the tolerance", async () => {
    const timestamp = Math.floor(Date.now() / 1000) - 10_000;
    const signature = await hmacHex(secret, `${timestamp}.${body}`);
    const header = `t=${timestamp},v1=${signature}`;
    await expect(verifyStripeWebhook(body, header, secret)).resolves.toBe(false);
  });

  it("rejects a missing signature header", async () => {
    await expect(verifyStripeWebhook(body, "", secret)).resolves.toBe(false);
  });
});

describe("verifyRazorpayWebhook", () => {
  const secret = "rzp_webhook_secret";
  const body = JSON.stringify({ event: "payment.captured" });

  it("accepts a correct signature", async () => {
    const signature = await hmacHex(secret, body);
    await expect(verifyRazorpayWebhook(body, signature, secret)).resolves.toBe(true);
  });

  it("rejects an incorrect signature", async () => {
    await expect(verifyRazorpayWebhook(body, "deadbeef", secret)).resolves.toBe(false);
  });

  it("rejects an empty header", async () => {
    await expect(verifyRazorpayWebhook(body, "", secret)).resolves.toBe(false);
  });
});

describe("createCheckout", () => {
  it("creates a Stripe Checkout Session with the right price", async () => {
    const config: BillingConfig = readBillingConfig(STRIPE_ENV);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "cs_test_1", url: "https://checkout.stripe.com/pay/cs_test_1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await createCheckout(config, { tier: "pro", email: "person@example.test" }, fetchImpl);
    expect(result).toMatchObject({ provider: "stripe", id: "cs_test_1", url: "https://checkout.stripe.com/pay/cs_test_1" });
    expect(calls[0]?.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const body = calls[0]?.init.body as URLSearchParams;
    expect(body.get("line_items[0][price]")).toBe("price_pro");
    expect(body.get("customer_email")).toBe("person@example.test");
    expect(body.get("client_reference_id")).toBe("pro");
  });

  it("creates a Razorpay order with the display amount", async () => {
    const config: BillingConfig = readBillingConfig({ ...RAZORPAY_ENV, RAZORPAY_CURRENCY: "INR" });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "order_1", amount: PLAN_CATALOG.pro.amountInrMinor, currency: "INR" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await createCheckout(config, { tier: "pro" }, fetchImpl);
    expect(result).toMatchObject({ provider: "razorpay", id: "order_1", keyId: "rzp_test_id", currency: "INR" });
    expect(result.amount).toBe(PLAN_CATALOG.pro.amountInrMinor);
    const body = JSON.parse(String(calls[0]?.init.body)) as { amount: number; currency: string };
    expect(body.amount).toBe(PLAN_CATALOG.pro.amountInrMinor);
    expect(body.currency).toBe("INR");
  });

  it("surfaces a provider failure as a 502", async () => {
    const config: BillingConfig = readBillingConfig(STRIPE_ENV);
    const fetchImpl = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    await expect(createCheckout(config, { tier: "pro" }, fetchImpl)).rejects.toMatchObject({ status: 502 });
  });
});