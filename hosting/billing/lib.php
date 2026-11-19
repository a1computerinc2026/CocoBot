<?php
// Shared helpers for the CocoBot PHP billing backend (cPanel + MySQL).
// Include with: require __DIR__ . '/lib.php';

declare(strict_types=1);

function config(): array
{
    static $config = null;
    if ($config === null) {
        $config = require __DIR__ . '/config.php';
    }
    return $config;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config()['db'];
        $dsn = "mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4";
        $pdo = new PDO($dsn, $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

const TIERS = ['starter', 'personal', 'pro', 'max'];

function plan_amount(string $tier, string $currency): int
{
    $plans = config()['plans'];
    if (!isset($plans[$tier])) {
        throw new InvalidArgumentException("unknown tier: $tier");
    }
    $field = strtoupper($currency) === 'USD' ? 'usd' : 'inr';
    return (int) $plans[$tier][$field];
}

/** Picks the provider to use: forced, or the first fully configured. */
function active_provider(): ?string
{
    $cfg = config();
    $stripeReady = $cfg['stripe']['secret_key']
        && !str_contains($cfg['stripe']['secret_key'], 'replace_me')
        && count(array_filter($cfg['stripe']['prices'], fn ($p) => $p && !str_contains($p, 'replace_me'))) === 4;
    $razorpayReady = $cfg['razorpay']['key_id']
        && !str_contains($cfg['razorpay']['key_id'], 'replace_me')
        && $cfg['razorpay']['key_secret']
        && !str_contains($cfg['razorpay']['key_secret'], 'replace_me');

    $want = $cfg['provider'];
    if ($want === 'stripe' || $want === 'razorpay') {
        return ($want === 'stripe' ? $stripeReady : $razorpayReady) ? $want : null;
    }
    if ($stripeReady) return 'stripe';
    if ($razorpayReady) return 'razorpay';
    return null;
}

function http_form_post(string $url, array $fields, array $headers): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_POSTFIELDS     => http_build_query($fields),
        CURLOPT_TIMEOUT        => 20,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return [$code, $body, $err];
}

function http_json_post(string $url, string $json, array $headers): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_POSTFIELDS     => $json,
        CURLOPT_TIMEOUT        => 20,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    return [$code, $body, $err];
}

/** Stripe: create a Checkout Session and return ['id' => ..., 'url' => ...]. */
function stripe_create_session(string $tier, string $email): array
{
    $cfg = config()['stripe'];
    $price = $cfg['prices'][$tier] ?? '';
    if (!$price) {
        throw new RuntimeException('no Stripe price for tier ' . $tier);
    }
    $success = config()['success_url'] . '?session_id={CHECKOUT_SESSION_ID}';
    $fields = [
        'mode'                       => 'subscription',
        'line_items[0][price]'       => $price,
        'line_items[0][quantity]'    => '1',
        'success_url'                => $success,
        'cancel_url'                 => config()['cancel_url'],
        'client_reference_id'        => $tier,
        'metadata[coco_tier]'        => $tier,
    ];
    if ($email !== '') {
        $fields['customer_email'] = $email;
    }
    [$code, $body] = http_form_post('https://api.stripe.com/v1/checkout/sessions', $fields, [
        'Authorization: Bearer ' . $cfg['secret_key'],
        'Content-Type: application/x-www-form-urlencoded',
    ]);
    $data = json_decode((string) $body, true);
    if ($code < 200 || $code >= 300 || empty($data['id']) || empty($data['url'])) {
        throw new RuntimeException('Stripe checkout failed: ' . $code);
    }
    return ['id' => $data['id'], 'url' => $data['url']];
}

/** Stripe: verify the Stripe-Signature header against the raw body. */
function stripe_verify(string $payload, string $header): bool
{
    $secret = config()['stripe']['webhook_secret'];
    if (!$secret || !$header) {
        return false;
    }
    $timestamp = '';
    $signatures = [];
    foreach (explode(',', $header) as $part) {
        $part = trim($part);
        $pos = strpos($part, '=');
        if ($pos === false) continue;
        $k = substr($part, 0, $pos);
        $v = substr($part, $pos + 1);
        if ($k === 't') $timestamp = $v;
        elseif ($k === 'v1') $signatures[] = $v;
    }
    if ($timestamp === '' || !ctype_digit($timestamp) || !$signatures) {
        return false;
    }
    if (abs(time() - (int) $timestamp) > 300) {
        return false;
    }
    $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
    foreach ($signatures as $sig) {
        if (hash_equals($expected, $sig)) {
            return true;
        }
    }
    return false;
}

/** Razorpay: create an Order and return ['id','amount','currency']. */
function razorpay_create_order(string $tier): array
{
    $cfg = config()['razorpay'];
    $currency = strtoupper($cfg['currency']) === 'USD' ? 'USD' : 'INR';
    $amount = plan_amount($tier, $currency);
    $payload = json_encode([
        'amount'   => $amount,
        'currency' => $currency,
        'receipt'  => 'coco_' . $tier . '_' . time() . '_' . bin2hex(random_bytes(3)),
        'notes'    => ['coco_tier' => $tier],
    ], JSON_THROW_ON_ERROR);
    [$code, $body] = http_json_post('https://api.razorpay.com/v1/orders', $payload, [
        'Authorization: Basic ' . base64_encode($cfg['key_id'] . ':' . $cfg['key_secret']),
        'Content-Type: application/json',
    ]);
    $data = json_decode((string) $body, true);
    if ($code < 200 || $code >= 300 || empty($data['id'])) {
        throw new RuntimeException('Razorpay order failed: ' . $code);
    }
    return ['id' => $data['id'], 'amount' => (int) $data['amount'], 'currency' => $data['currency']];
}

/** Razorpay: verify the X-Razorpay-Signature webhook header against the raw body. */
function razorpay_verify_webhook(string $payload, string $header): bool
{
    $secret = config()['razorpay']['webhook_secret'];
    if (!$secret || !$header) {
        return false;
    }
    $expected = hash_hmac('sha256', $payload, $secret);
    return hash_equals($expected, $header);
}

/** Razorpay: verify the client checkout payment signature. */
function razorpay_verify_payment(string $orderId, string $paymentId, string $signature): bool
{
    $secret = config()['razorpay']['key_secret'];
    if (!$secret) {
        return false;
    }
    $expected = hash_hmac('sha256', $orderId . '|' . $paymentId, $secret);
    return hash_equals($expected, $signature);
}

/** Records a webhook event id once; returns false if already seen. */
function claim_event(string $provider, string $eventId, string $type): bool
{
    try {
        $stmt = db()->prepare('INSERT INTO events (provider, event_id, type) VALUES (?, ?, ?)');
        $stmt->execute([$provider, $eventId, $type]);
        return true;
    } catch (PDOException $e) {
        // Duplicate unique key = already processed.
        return false;
    }
}

function customer_id_for_email(string $email): int
{
    $stmt = db()->prepare('SELECT id FROM customers WHERE email = ?');
    $stmt->execute([$email]);
    $row = $stmt->fetch();
    if ($row) {
        return (int) $row['id'];
    }
    $stmt = db()->prepare('INSERT INTO customers (email) VALUES (?)');
    $stmt->execute([$email]);
    return (int) db()->lastInsertId();
}

function record_order(string $provider, string $orderId, string $tier, ?string $email, ?int $amount, ?string $currency): void
{
    $stmt = db()->prepare(
        'INSERT INTO orders (provider, provider_order_id, tier, email, amount_minor, currency)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE tier = VALUES(tier), email = VALUES(email)'
    );
    $stmt->execute([$provider, $orderId, $tier, $email, $amount, $currency]);
}

function order_info(string $provider, string $orderId): ?array
{
    $stmt = db()->prepare('SELECT tier, email FROM orders WHERE provider = ? AND provider_order_id = ?');
    $stmt->execute([$provider, $orderId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function stripe_price_to_tier(string $priceId): ?string
{
    foreach (config()['stripe']['prices'] as $tier => $price) {
        if ($price === $priceId) {
            return $tier;
        }
    }
    return null;
}

function find_subscription_customer_id(string $provider, string $subId): ?int
{
    $stmt = db()->prepare('SELECT customer_id FROM subscriptions WHERE provider = ? AND provider_sub_id = ?');
    $stmt->execute([$provider, $subId]);
    $row = $stmt->fetch();
    return $row ? (int) $row['customer_id'] : null;
}

function update_subscription(string $provider, string $subId, array $fields): void
{
    $allowed = ['status', 'current_period_end', 'cancel_at_period_end', 'amount_minor', 'currency', 'plan'];
    $set = [];
    $params = [];
    foreach ($allowed as $key) {
        if (array_key_exists($key, $fields)) {
            $set[] = "$key = ?";
            $params[] = $fields[$key];
        }
    }
    if (!$set) {
        return;
    }
    $params[] = $provider;
    $params[] = $subId;
    $stmt = db()->prepare('UPDATE subscriptions SET ' . implode(', ', $set) . ' WHERE provider = ? AND provider_sub_id = ?');
    $stmt->execute($params);
}

function provisioner_call(string $action, string $email, string $plan = ''): bool
{
    $cfg = config()['provisioner'] ?? [];
    $url = rtrim((string) ($cfg['url'] ?? ''), '/');
    $key = (string) ($cfg['shared_secret'] ?? '');
    if ($url === '' || $key === '' || str_contains($key, 'CHANGE_ME')) {
        return false;
    }
    $payload = json_encode(['email' => $email, 'plan' => $plan]);
    $ch = curl_init($url . '/' . $action);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'X-Provisioner-Key: ' . $key],
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_TIMEOUT        => 30,
    ]);
    curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code >= 200 && $code < 300;
}

function email_for_sub(string $provider, string $subId): ?string
{
    $stmt = db()->prepare(
        'SELECT c.email FROM subscriptions s JOIN customers c ON c.id = s.customer_id
         WHERE s.provider = ? AND s.provider_sub_id = ?'
    );
    $stmt->execute([$provider, $subId]);
    $row = $stmt->fetch();
    return $row ? (string) $row['email'] : null;
}

function upsert_subscription(array $s): void
{
    $stmt = db()->prepare(
        'INSERT INTO subscriptions
           (customer_id, provider, provider_customer_id, provider_sub_id, plan, status,
            amount_minor, currency, current_period_end, cancel_at_period_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           amount_minor = VALUES(amount_minor),
           currency = VALUES(currency),
           current_period_end = VALUES(current_period_end),
           cancel_at_period_end = VALUES(cancel_at_period_end)'
    );
    $stmt->execute([
        $s['customer_id'],
        $s['provider'],
        $s['provider_customer_id'] ?? null,
        $s['provider_sub_id'],
        $s['plan'],
        $s['status'],
        $s['amount_minor'] ?? null,
        $s['currency'] ?? null,
        $s['current_period_end'] ?? null,
        !empty($s['cancel_at_period_end']) ? 1 : 0,
    ]);
}