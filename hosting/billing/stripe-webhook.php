<?php
// Stripe webhook: verify the signature, then apply the event to subscriptions.
// Register this URL in Stripe: https://YOURDOMAIN/stripe-webhook.php
// Events: checkout.session.completed, customer.subscription.updated,
//         customer.subscription.deleted, invoice.payment_failed
require __DIR__ . '/lib.php';

$payload = file_get_contents('php://input') ?: '';
$header  = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';

if (!stripe_verify($payload, $header)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'invalid_signature']);
    exit;
}

$event = json_decode($payload, true);
$type  = $event['type'] ?? '';
$obj   = $event['data']['object'] ?? [];

// Idempotency: ignore an event id we already handled.
if (!empty($event['id']) && !claim_event('stripe', (string) $event['id'], (string) $type)) {
    header('Content-Type: application/json');
    echo json_encode(['received' => true, 'duplicate' => true]);
    exit;
}

function stripe_period_end(array $obj): ?int
{
    $end = $obj['current_period_end']
        ?? $obj['items']['data'][0]['current_period_end']
        ?? null;
    return $end !== null ? (int) $end : null;
}

if ($type === 'checkout.session.completed' && ($obj['payment_status'] ?? '') === 'paid') {
    $tier    = $obj['client_reference_id'] ?? ($obj['metadata']['coco_tier'] ?? null);
    $subId   = $obj['subscription'] ?? null;
    $email   = $obj['customer_details']['email'] ?? ($obj['customer_email'] ?? '');
    if ($tier && $subId && $email) {
        $customerId = customer_id_for_email($email);
        upsert_subscription([
            'customer_id'          => $customerId,
            'provider'             => 'stripe',
            'provider_customer_id' => $obj['customer'] ?? null,
            'provider_sub_id'      => $subId,
            'plan'                 => $tier,
            'status'               => 'active',
            'amount_minor'         => isset($obj['amount_total']) ? (int) $obj['amount_total'] : null,
            'currency'             => strtoupper($obj['currency'] ?? '') ?: null,
            'current_period_end'   => stripe_period_end($obj),
        ]);
        provisioner_call('provision', (string) $email, (string) $tier);
    }
} elseif ($type === 'customer.subscription.updated' || $type === 'customer.subscription.deleted') {
    $subId = $obj['id'] ?? null;
    if ($subId) {
        $status = $type === 'customer.subscription.deleted' ? 'canceled' : ($obj['status'] ?? 'active');
        $priceId = $obj['items']['data'][0]['price']['id'] ?? null;
        $tier = $priceId ? stripe_price_to_tier($priceId) : null;
        $fields = [
            'status'               => $status,
            'current_period_end'   => stripe_period_end($obj),
            'cancel_at_period_end' => !empty($obj['cancel_at_period_end']) ? 1 : 0,
        ];
        if ($tier) {
            $fields['plan'] = $tier;
        }
        update_subscription('stripe', $subId, $fields);
        if (($fields['status'] ?? '') === 'canceled') {
            $email = email_for_sub('stripe', $subId);
            if ($email) {
                provisioner_call('deprovision', $email);
            }
        }
    }
} elseif ($type === 'invoice.payment_failed') {
    $subId = $obj['subscription'] ?? ($obj['parent']['subscription_details']['subscription'] ?? null);
    if ($subId) {
        update_subscription('stripe', $subId, ['status' => 'past_due']);
    }
}

header('Content-Type: application/json');
echo json_encode(['received' => true]);