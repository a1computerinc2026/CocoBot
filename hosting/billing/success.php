<?php
// Return page after a successful checkout. For Stripe, the session id is in the
// query; the subscription itself is activated by the webhook, so this page only
// thanks the user.
?>
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CocoBot — You're subscribed</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0d10;color:#e7ecf2;text-align:center;padding:80px 20px}h1{font-size:28px}.sub{color:#9aa6b2}</style>
</head>
<body>
  <h1>Thanks — you're all set 🎉</h1>
  <p class="sub">Your CocoBot Cloud subscription is being activated. You can close this window.</p>
</body>
</html>