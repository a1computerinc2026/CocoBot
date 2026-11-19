<?php
// CocoBot billing — pricing page. Lists the tiers and starts checkout.
require __DIR__ . '/lib.php';

function money(int $minor, string $symbol): string
{
    return $symbol . number_format($minor / 100, 2);
}

$provider = active_provider();
$plans = config()['plans'];
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CocoBot — Plans</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #0b0d10; color: #e7ecf2; }
  header { padding: 40px 20px 8px; text-align: center; }
  h1 { margin: 0 0 6px; font-size: 32px; }
  .sub { color: #9aa6b2; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; max-width: 1000px; margin: 30px auto; padding: 0 20px; }
  .card { background: #12161b; border: 1px solid #232a31; border-radius: 14px; padding: 22px; }
  .card h2 { margin: 0 0 2px; font-size: 20px; }
  .price { font-size: 30px; font-weight: 700; margin: 12px 0 2px; }
  .per { color: #9aa6b2; font-size: 13px; }
  button { margin-top: 16px; width: 100%; padding: 11px; border: 0; border-radius: 10px; background: #4f8cff; color: white; font-size: 15px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .note { max-width: 1000px; margin: 0 auto 40px; padding: 0 20px; color: #9aa6b2; font-size: 14px; }
</style>
</head>
<body>
<header>
  <h1>CocoBot Cloud</h1>
  <div class="sub">Hosted CocoBot instances — always on.</div>
</header>

<?php if (!$provider): ?>
  <p class="note">Billing is not configured yet. Set your Stripe or Razorpay keys in <code>config.php</code>.</p>
<?php else: ?>
<div class="grid">
  <?php foreach ($plans as $tier => $plan): ?>
    <div class="card">
      <h2><?= htmlspecialchars($plan['label']) ?></h2>
      <div class="price"><?= money((int) $plan['usd'], '$') ?></div>
      <div class="per">per month · or <?= money((int) $plan['inr'], '₹') ?>/mo</div>
      <form method="post" action="checkout.php">
        <input type="hidden" name="tier" value="<?= htmlspecialchars($tier) ?>">
        <input type="hidden" name="provider" value="<?= htmlspecialchars($provider) ?>">
        <button type="submit">Subscribe</button>
      </form>
    </div>
  <?php endforeach; ?>
</div>
<p class="note">Secure checkout by <?= $provider === 'razorpay' ? 'Razorpay' : 'Stripe' ?>. Cancel anytime.</p>
<?php endif; ?>
</body>
</html>