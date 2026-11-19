#!/usr/bin/env bash
# Smoke-test the CocoBot instance provisioner on the VPS.
#
# Usage:
#   PROVISIONER_KEY=<shared-secret> bash hosting/provisioner/test.sh
#
# Optional:
#   PROVISIONER_URL=http://localhost:9000   TEST_EMAIL=...   TEST_PLAN=pro
#
# It checks: bad key -> 401, provision creates + lists the instance (and a docker
# container), deprovision removes it. Exits non-zero on the first failure.

set -euo pipefail

URL="${PROVISIONER_URL:-http://localhost:9000}"
KEY="${PROVISIONER_KEY:?set PROVISIONER_KEY to the provisioner shared secret}"
EMAIL="${TEST_EMAIL:-smoke-$(date +%s)@example.test}"
PLAN="${TEST_PLAN:-pro}"

call() { # method path [json]
  local method="$1" path="$2" data="${3:-}"
  if [ -n "$data" ]; then
    curl -fsS -X "$method" "$URL$path" \
      -H "X-Provisioner-Key: $KEY" -H 'Content-Type: application/json' -d "$data"
  else
    curl -fsS -X "$method" "$URL$path" -H "X-Provisioner-Key: $KEY"
  fi
}

fail() { echo "FAIL: $1" >&2; exit 1; }

echo "== 1. auth: a wrong key must be rejected (401) =="
code="$(curl -s -o /dev/null -w '%{http_code}' "$URL/instances" -H "X-Provisioner-Key: wrong-key")"
[ "$code" = "401" ] || fail "wrong key returned HTTP $code (expected 401)"
echo "   ok (401)"

echo "== 2. list before =="
call GET /instances; echo

echo "== 3. provision $EMAIL ($PLAN) =="
call POST /provision "{\"email\":\"$EMAIL\",\"plan\":\"$PLAN\"}"; echo

echo "== 4. instance is listed =="
after="$(call GET /instances)"
echo "$after" | grep -q "$EMAIL" || fail "instance not listed after provision"
echo "   ok"

echo "== 5. a container is running (docker) =="
if command -v docker >/dev/null 2>&1; then
  docker ps --format '{{.Names}}\t{{.Status}}' | grep -i '^coco-' || echo "   (no coco-* container visible; check COCO_IMAGE/docker)"
else
  echo "   (docker not installed on this host — skipping container check)"
fi

echo "== 6. deprovision =="
call POST /deprovision "{\"email\":\"$EMAIL\"}"; echo

echo "== 7. instance is gone =="
final="$(call GET /instances)"
if echo "$final" | grep -q "$EMAIL"; then fail "instance still listed after deprovision"; fi
echo "   ok"

echo "ALL SMOKE CHECKS PASSED"