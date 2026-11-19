<?php
// CocoBot billing configuration for cPanel shared hosting.
// Fill this in after creating the MySQL database (see README.md) and your
// Stripe / Razorpay accounts. Never commit real keys to a public repo.

return [
    'db' => [
        'host' => 'localhost',
        'name' => 'cocobot_billing',   // cPanel usually prefixes: youruser_cocobot
        'user' => 'cocobot_user',      // youruser_cocobot
        'pass' => 'CHANGE_ME',
    ],

    // Where this billing app is served from (no trailing slash).
    'site_url'    => 'https://billing.yourdomain.tld',
    'success_url' => 'https://billing.yourdomain.tld/success.php',
    'cancel_url'  => 'https://billing.yourdomain.tld/cancel.php',

    // 'auto' uses whichever provider is fully configured (Stripe first),
    // or force 'stripe' / 'razorpay'.
    'provider' => 'auto',

    'stripe' => [
        'secret_key'     => 'sk_test_replace_me',
        'webhook_secret' => 'whsec_replace_me',
        // Recurring Price IDs, one per tier, from your Stripe dashboard.
        'prices' => [
            'starter'  => 'price_replace_me',
            'personal' => 'price_replace_me',
            'pro'      => 'price_replace_me',
            'max'      => 'price_replace_me',
        ],
    ],

    'razorpay' => [
        'key_id'         => 'rzp_test_replace_me',
        'key_secret'     => 'replace_me',
        'webhook_secret' => 'replace_me',
        // Plan IDs per tier (for reference). Orders are created with the
        // amount from the 'plans' catalog below.
        'plans' => [
            'starter'  => 'plan_replace_me',
            'personal' => 'plan_replace_me',
            'pro'      => 'plan_replace_me',
            'max'      => 'plan_replace_me',
        ],
        'currency' => 'INR', // INR or USD
    ],

    // Display catalog: amounts in minor units (cents / paise). Keep these in
    // step with your Stripe Prices / Razorpay amounts.
    'plans' => [
        'starter'  => ['label' => 'Starter',  'usd' => 900,      'inr' => 74900],
        'personal' => ['label' => 'Personal', 'usd' => 1900,     'inr' => 149900],
        'pro'      => ['label' => 'Pro',      'usd' => 4900,     'inr' => 399900],
        'max'      => ['label' => 'Max',      'usd' => 9900,     'inr' => 799900],
    ],
];