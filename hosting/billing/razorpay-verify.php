<?php
// Razorpay client-side callback: verify the payment signature, then activate
// the subscription for the order's tier.
require __DIR__ . '/lib.php';

$orderId   = (string) ($_POST['razorpay_order_id'] ?? '');
$paymentId = (string) ($_POST['razorpay_payment_id'] ?? '');
$signature = (string) ($_POST['razorpay_signature'] ?? '');

if ($orderId === '' || $paymentId === '' || !razorpay_verify_payment($orderId, $paymentId, $signature)) {
    http_response_code(400);
    header('Content-Type: text/plain');
    exit('verification failed');
}

$order = order_info('razorpay', $orderId);
if (!$order) {
    http_response_code(400);
    exit('unknown order');
}

$email = $order['email'] ?? (string) ($_POST['email'] ?? '');
if ($email !== '') {
    $customerId = customer_id_for_email($email);
    upsert_subscription([
        'customer_id'        => $customerId,
        'provider'           => 'razorpay',
        'provider_sub_id'    => $paymentId,
        'plan'               => $order['tier'],
        'status'             => 'active',
    ]);
    provisioner_call('provision', (string) $email, (string) $order['tier']);
}

header('Content-Type: application/json');
echo json_encode(['ok' => true]);