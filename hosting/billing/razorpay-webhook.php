<?php
// Razorpay webhook: verify the signature, then apply the event.
// Register this URL in the Razorpay dashboard: https://YOURDOMAIN/razorpay-webhook.php
// Events: payment.captured, order.paid, subscription.charged, subscription.cancelled
require __DIR__ . '/lib.php';

if (rate_limited('razorpay-webhook', 120, 60)) {
    http_response_code(429);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'rate_limited']);
    exit;
}

$payload = file_get_contents('php://input') ?: '';
$header  = $_SERVER['HTTP_X_RAZORPAY_SIGNATURE'] ?? '';

if (!razorpay_verify_webhook($payload, $header)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'invalid_signature']);
    exit;
}

$event = json_decode($payload, true);
$type  = $event['event'] ?? '';
$payment = $event['payload']['payment']['entity'] ?? null;

// Idempotency key: Razorpay has no top-level event id in the classic payload,
// so key on event + entity id.
$entityId = $payment['id'] ?? ($event['payload']['subscription']['entity']['id'] ?? '');
if ($entityId !== '' && !claim_event('razorpay', $type . ':' . $entityId, (string) $type)) {
    header('Content-Type: application/json');
    echo json_encode(['received' => true, 'duplicate' => true]);
    exit;
}

if (in_array($type, ['payment.captured', 'order.paid'], true) && $payment) {
    $orderId   = $payment['order_id'] ?? null;
    $paymentId = $payment['id'] ?? null;
    if ($orderId && $paymentId) {
        $order = order_info('razorpay', $orderId);
        if ($order && !empty($order['email'])) {
            $customerId = customer_id_for_email((string) $order['email']);
            upsert_subscription([
                'customer_id'       => $customerId,
                'provider'          => 'razorpay',
                'provider_sub_id'   => $paymentId,
                'plan'              => $order['tier'],
                'status'            => 'active',
                'amount_minor'      => isset($payment['amount']) ? (int) $payment['amount'] : null,
                'currency'          => strtoupper($payment['currency'] ?? '') ?: null,
            ]);
            provisioner_call('provision', (string) $order['email'], (string) $order['tier']);
        }
    }
} elseif ($type === 'subscription.cancelled') {
    $sub = $event['payload']['subscription']['entity'] ?? null;
    if ($sub && !empty($sub['id'])) {
        update_subscription('razorpay', (string) $sub['id'], ['status' => 'canceled']);
        $email = email_for_sub('razorpay', (string) $sub['id']);
        if ($email) {
            provisioner_call('deprovision', $email);
        }
    }
}
// subscription.charged / halted / pending: extend as needed (see README).

header('Content-Type: application/json');
echo json_encode(['received' => true]);