<?php
// Starts a checkout: Stripe redirects to its hosted page; Razorpay renders the
// in-page Checkout widget. Reads tier + provider from the POST/GET request.
require __DIR__ . '/lib.php';

$tier = (string) ($_REQUEST['tier'] ?? '');
if (!in_array($tier, TIERS, true)) {
    http_response_code(400);
    exit('unknown tier');
}
$provider = (string) ($_REQUEST['provider'] ?? '');
if ($provider === '' ) {
    $provider = active_provider();
}
$email = trim((string) ($_REQUEST['email'] ?? ''));

if ($provider === 'stripe') {
    try {
        $session = stripe_create_session($tier, $email);
    } catch (Throwable $e) {
        http_response_code(502);
        exit('could not start checkout');
    }
    header('Location: ' . $session['url']);
    exit;
}

if ($provider === 'razorpay') {
    try {
        $order = razorpay_create_order($tier);
    } catch (Throwable $e) {
        http_response_code(502);
        exit('could not start checkout');
    }
    record_order('razorpay', $order['id'], $tier, $email !== '' ? $email : null, $order['amount'], $order['currency']);
    $cfg = config()['razorpay'];
    $plan = config()['plans'][$tier];
    $json = function ($value) { return json_encode($value, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT); };
    ?>
    <!doctype html>
    <html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Pay with Razorpay</title></head>
    <body style="font-family:system-ui,sans-serif;text-align:center;padding:60px">
      <h2>Pay for <?= htmlspecialchars($plan['label']) ?></h2>
      <button id="rzp-btn" style="padding:12px 24px;font-size:16px;border:0;border-radius:10px;background:#4f8cff;color:#fff;cursor:pointer">Pay now</button>
      <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
      <script>
        var options = {
          key: <?= $json($cfg['key_id']) ?>,
          order_id: <?= $json($order['id']) ?>,
          amount: <?= $json($order['amount']) ?>,
          currency: <?= $json($order['currency']) ?>,
          name: "CocoBot",
          description: <?= $json($plan['label'] . ' plan') ?>,
          prefill: { email: <?= $json($email) ?> },
          theme: { color: "#4f8cff" },
          handler: function (response) {
            fetch('razorpay-verify.php', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature
              })
            }).then(function (r) {
              if (r.ok) { window.location = 'success.php'; }
              else { alert('Verification failed. If you were charged, contact support.'); }
            });
          }
        };
        var rzp = new Razorpay(options);
        document.getElementById('rzp-btn').addEventListener('click', function (e) { rzp.open(); e.preventDefault(); });
      </script>
    </body></html>
    <?php
    exit;
}

http_response_code(400);
exit('billing is not configured');