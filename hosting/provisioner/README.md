# CocoBot instance provisioner (VPS)

Turns a paid subscription into a running CocoBot instance. It runs on your
**VPS** (not cPanel) and is called by the cPanel billing site:

- billing `POST /provision {email, plan}` → starts a CocoBot container for that
  customer behind Caddy (auto HTTPS on `<id>.yourdomain`).
- billing `POST /deprovision {email}` → stops/removes it when a subscription
  lapses.

One container per customer, a named volume for its data, a subdomain with a
Let's Encrypt certificate. Node built-ins only; needs **Docker** and **Caddy**.

## VPS setup (Ubuntu)

1. **Docker**: `curl -fsSL https://get.docker.com | sh`
2. **Caddy**: `apt install -y debian-keyring debian-archive-keyring apt-transport-https && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list && apt update && apt install -y caddy`
3. **Wild card DNS**: point `*.yourdomain` (e.g. `*.cocobot.yourdomain.tld`) at this VPS's public IP (an A record). Caddy onboards TLS per subdomain automatically.
4. **Caddy config**: copy `Caddyfile.example` to `/etc/caddy/Caddyfile` and edit the domains/email. It imports the generated per-instance file.
5. **The service**:
   ```bash
   sudo mkdir -p /var/lib/cocobot-provisioner
   sudo cp server.mjs /opt/cocobot-provisioner/server.mjs
   sudo PROVISIONER_SHARED_SECRET="$(openssl rand -hex 24)" \
        COCO_DOMAIN="cocobot.yourdomain.tld" \
        node /opt/cocobot-provisioner/server.mjs
   ```
   (Run under systemd — see `provisioner.service.example`.)
6. **Billing side**: in cPanel `config.php`, set
   ```php
   'provisioner' => [
     'url'           => 'https://api.cocobot.yourdomain.tld', // Caddy -> 127.0.0.1:9000
     'shared_secret' => 'the same PROVISIONER_SHARED_SECRET',
   ],
   ```

## Endpoints

- `GET  /instances` → list running instances
- `POST /provision {email, plan}` → ensure an instance exists (idempotent)
- `POST /deprovision {email}` → remove it

All require header `X-Provisioner-Key: <shared_secret>`.

## Notes

- The instance's AI (Claude/OpenAI/etc.) is configured by the customer inside
  their CocoBot UI after you email them their URL; the provisioner only runs
  the server.
- Data persists in the Docker volume `coco-<id>-data`; deprovision removes the
  container but keeps the volume (edit `deprovision()` to also
  `docker volume rm` if you want to wipe).
- A cron that reconciles `subscriptions` against `GET /instances` is a good
  safety net (catch anything a failed webhook missed).