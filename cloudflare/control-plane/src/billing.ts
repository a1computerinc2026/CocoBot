import { z } from "zod";

import { HTTPError, readBoundedJSON } from "./http";

/** The cloud tiers CocoBot sells, lowest to highest. */
export const PLAN_TIERS = ["starter", "personal", "pro", "max"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/**
 * Display copy for a tier. Amounts are in minor units (cents / paise) and are
 * what a pricing page shows; the amount actually charged is the provider's own
 * Price (Stripe) or Plan (Razorpay) named by the matching *_PRICE_*_ / *_PLAN_*
 * secret. Keep these in step with those objects.
 */
export interface PlanDisplay {
  tier: PlanTier;
  label: string;
  amountUsdMinor: number;
  amountInrMinor: number;
  interval: "month" | "year";
}

export const PLAN_CATALOG: Record<PlanTier, PlanDisplay> = {
  starter: { tier: "starter", label: "Starter", amountUsdMinor: 900, amountInrMinor: 74_900, interval: "month" },
  personal: { tier: "personal", label: "Personal", amountUsdMinor: 1_900, amountInrMinor: 149_900, interval: "month" },
  pro: { tier: "pro", label: "Pro", amountUsdMinor: 4_900, amountInrMinor: 399_900, interval: "month" },
  max: { tier: "max", label: "Max", amountUsdMinor: 9_900, amountInrMinor: 799_900, interval: "month" },
};

export type BillingProvider = "stripe" | "razorpay";

export interface StripeBillingConfig {
  secretKey: string;
  webhookSecret: string;
  prices: Record<PlanTier, string>;
  successUrl: string;
  cancelUrl: string;
}

export interface RazorpayBillingConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  plans: Record<PlanTier, string>;
  currency: "INR" | "USD";
}

export interface BillingConfig {
  provider: BillingProvider;
  stripe: StripeBillingConfig | null;
  razorpay: RazorpayBillingConfig | null;
}

export interface CheckoutParams {
  tier: PlanTier;
  email?: string | null;
  customerId?: string | null;
  successUrl?: string | null;
  cancelUrl?: string | null;
}

export interface CheckoutResult {
  provider: BillingProvider;
  /** Stripe Checkout Session id, or Razorpay Order id. */
  id: string;
  /** Stripe hosted page to redirect to; absent for Razorpay (the client opens its Checkout). */
  url?: string;
  /** Razorpay only: the amount and currency the client must confirm. */
  amount?: number;
  currency?: string;
  /** Razorpay only: the public key id the client needs to open Checkout. */
  keyId?: string;
}

const envString = (env: Record<string, unknown>, key: string): string => {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
};

const priceMap = (env: Record<string, unknown>, prefix: string): Record<PlanTier, string> | null => {
  const entries = PLAN_TIERS.map((tier) => [tier, envString(env, `${prefix}_${tier.toUpperCase()}`)] as const);
  if (entries.some(([, value]) => !value)) return null;
  return Object.fromEntries(entries) as Record<PlanTier, string>;
};

/**
 * Reads the billing configuration from the Worker env. A provider is configured
 * when its credentials and its per-tier price/plan map are all present. When
 * BILLING_PROVIDER names a provider that is not fully configured, that is an
 * error rather than a silent fall-through, so a typo cannot bill on the wrong
 * rail.
 */
export function readBillingConfig(env: Record<string, unknown>): BillingConfig {
  const stripeSecret = envString(env, "STRIPE_SECRET_KEY");
  const stripePrices = priceMap(env, "STRIPE_PRICE");
  const stripe: StripeBillingConfig | null = stripeSecret && stripePrices
    ? {
      secretKey: stripeSecret,
      webhookSecret: envString(env, "STRIPE_WEBHOOK_SECRET"),
      prices: stripePrices,
      successUrl: envString(env, "STRIPE_SUCCESS_URL") || "https://app.cocobot.ss2.in/billing/success",
      cancelUrl: envString(env, "STRIPE_CANCEL_URL") || "https://app.cocobot.ss2.in/billing",
    }
    : null;

  const razorpayKeyId = envString(env, "RAZORPAY_KEY_ID");
  const razorpayKeySecret = envString(env, "RAZORPAY_KEY_SECRET");
  const razorpayPlans = priceMap(env, "RAZORPAY_PLAN");
  const razorpay: RazorpayBillingConfig | null = razorpayKeyId && razorpayKeySecret && razorpayPlans
    ? {
      keyId: razorpayKeyId,
      keySecret: razorpayKeySecret,
      webhookSecret: envString(env, "RAZORPAY_WEBHOOK_SECRET"),
      plans: razorpayPlans,
      currency: envString(env, "RAZORPAY_CURRENCY") === "USD" ? "USD" : "INR",
    }
    : null;

  const requested = envString(env, "BILLING_PROVIDER").toLowerCase();
  const provider: BillingProvider | null =
    (requested === "stripe" || requested === "razorpay")
      ? requested
      : stripe
      ? "stripe"
      : razorpay
      ? "razorpay"
      : null;

  if (!provider) throw new HTTPError(503, "billing_unconfigured");
  const chosen = provider === "stripe" ? stripe : razorpay;
  if (!chosen) throw new HTTPError(503, "billing_unconfigured");
  if (provider === "stripe" && !stripe?.webhookSecret) throw new HTTPError(503, "billing_unconfigured");
  if (provider === "razorpay" && !razorpay?.webhookSecret) throw new HTTPError(503, "billing_unconfigured");

  return { provider, stripe, razorpay };
}

/** The public plan list for the pricing UI. Never leaks secrets. */
export function planCatalog(env: Record<string, unknown>): {
  provider: BillingProvider | null;
  plans: PlanDisplay[];
} {
  let provider: BillingProvider | null = null;
  try {
    provider = readBillingConfig(env).provider;
  } catch {
    provider = null;
  }
  return { provider, plans: PLAN_TIERS.map((tier) => PLAN_CATALOG[tier]) };
}

const tierSchema = z.enum(PLAN_TIERS);

/** Creates a hosted checkout for Stripe, or an order for Razorpay Checkout. */
export async function createCheckout(
  config: BillingConfig,
  params: CheckoutParams,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutResult> {
  const tier = tierSchema.parse(params.tier);
  if (config.provider === "stripe") {
    if (!config.stripe) throw new HTTPError(503, "billing_unconfigured");
    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("line_items[0][price]", config.stripe.prices[tier]);
    form.set("line_items[0][quantity]", "1");
    form.set("success_url", `${params.successUrl ?? config.stripe.successUrl}${params.successUrl ? "" : "?session_id={CHECKOUT_SESSION_ID}"}`);
    form.set("cancel_url", params.cancelUrl ?? config.stripe.cancelUrl);
    form.set("client_reference_id", tier);
    form.set("metadata[coco_tier]", tier);
    if (params.email) form.set("customer_email", params.email);
    if (params.customerId) form.set("customer", params.customerId);

    const response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.stripe.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const data = await response.json().catch(() => null) as { id?: string; url?: string } | null;
    if (!response.ok || !data?.id || !data.url) throw new HTTPError(502, "billing_provider_error");
    return { provider: "stripe", id: data.id, url: data.url };
  }

  if (!config.razorpay) throw new HTTPError(503, "billing_unconfigured");
  const display = PLAN_CATALOG[tier];
  const amount = config.razorpay.currency === "USD" ? display.amountUsdMinor : display.amountInrMinor;
  const response = await fetchImpl("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${config.razorpay.keyId}:${config.razorpay.keySecret}`)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      amount,
      currency: config.razorpay.currency,
      receipt: `coco_${tier}_${Date.now()}`,
      notes: { coco_tier: tier },
    }),
  });
  const data = await response.json().catch(() => null) as { id?: string; amount?: number; currency?: string } | null;
  if (!response.ok || !data?.id) throw new HTTPError(502, "billing_provider_error");
  return {
    provider: "razorpay",
    id: data.id,
    amount: data.amount ?? amount,
    currency: data.currency ?? config.razorpay.currency,
    keyId: config.razorpay.keyId,
  };
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

/**
 * Verifies a Stripe webhook signature (`Stripe-Signature: t=...,v1=...`). The
 * signed payload is `${timestamp}.${rawBody}`, HMAC-SHA256 with the endpoint
 * secret, compared in constant time and rejected outside the tolerance window.
 */
export async function verifyStripeWebhook(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  const parts = header.split(",").map((part) => part.trim());
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }
  if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (age > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

/** Verifies a Razorpay webhook signature (`X-Razorpay-Signature`), HMAC-SHA256 of the raw body. */
export async function verifyRazorpayWebhook(rawBody: string, header: string, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  const expected = await hmacHex(secret, rawBody);
  return timingSafeEqual(header, expected);
}

const checkoutBodySchema = z.object({
  tier: tierSchema,
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

/** Handles POST /v1/billing/checkout for a signed-in account. */
export async function handleCheckout(
  request: Request,
  env: Record<string, unknown>,
  session: { user: { email: string } },
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutResult> {
  const raw = await readBoundedJSON(request);
  const parsed = checkoutBodySchema.safeParse(raw);
  if (!parsed.success) throw new HTTPError(400, "invalid_request");
  const body = parsed.data;
  const config = readBillingConfig(env);
  return createCheckout(config, {
    tier: body.tier,
    email: session.user.email,
    successUrl: body.successUrl ?? null,
    cancelUrl: body.cancelUrl ?? null,
  }, fetchImpl);
}