#!/usr/bin/env bash
# Phase 1 exit criterion: with a Keycloak token a fan can hold a seat and the catalog
# shows it as HELD; without a token the gateway answers 401.
#
# Everything goes through the API Gateway on port 8000, the only port a client may use.
#
#   docker compose up -d --build
#   ./scripts/smoke-phase1.sh
set -u

GATEWAY=${GATEWAY:-http://localhost:8000}
KEYCLOAK=${KEYCLOAK:-http://localhost:8080}
EVENT_ID=${EVENT_ID:-3f0c8a52-0000-4000-8000-000000000001}
SEAT=${SEAT:-A-01-01}

passed=0
failed=0

check() { # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  PASS  %-52s %s\n' "$1" "$3"
    passed=$((passed + 1))
  else
    printf '  FAIL  %-52s expected %s, got %s\n' "$1" "$2" "$3"
    failed=$((failed + 1))
  fi
}

token_for() { # token_for <username> <password>
  curl -s -X POST "$KEYCLOAK/realms/flashtix/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=flashtix-web \
    -d "username=$1" -d "password=$2" |
    sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
}

# Since Phase 2 a hold needs the admission token of the virtual queue (WR-3).
admission_for() { # admission_for <token>
  local ticket
  ticket=$(curl -s -X POST "$GATEWAY/v1/events/$EVENT_ID/queue" -H "Authorization: Bearer $1" |
    sed -n 's/.*"queueTicketId":"\([^"]*\)".*/\1/p')
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    local turn
    turn=$(curl -s "$GATEWAY/v1/events/$EVENT_ID/queue/$ticket" -H "Authorization: Bearer $1")
    if echo "$turn" | grep -q '"ADMITTED"'; then
      echo "$turn" | sed -n 's/.*"admissionToken":"\([^"]*\)".*/\1/p'
      return
    fi
    sleep 1
  done
}

seat_status() { # seat_status <seatId>
  curl -s "$GATEWAY/v1/events/$EVENT_ID/seats" |
    tr '{' '\n' | grep "\"seatId\":\"$1\"" |
    sed -n 's/.*"status":"\([A-Z]*\)".*/\1/p'
}

# Builds the JSON body with printf instead of inline escapes: nesting escaped quotes
# inside "$( ... )" corrupts them and the service would receive invalid JSON.
hold_body() { # hold_body <seatIds json array>
  printf '{"eventId":"%s","seatIds":%s}' "$EVENT_ID" "$1"
}

post_holds_code() { # post_holds_code <token|-> <seatIds json array> [admission token]
  local body
  body=$(hold_body "$2")
  if [ "$1" = "-" ]; then
    curl -s -o /dev/null -w '%{http_code}' -X POST "$GATEWAY/v1/holds" \
      -H 'content-type: application/json' --data "$body"
  else
    curl -s -o /dev/null -w '%{http_code}' -X POST "$GATEWAY/v1/holds" \
      -H "Authorization: Bearer $1" -H "X-Admission-Token: ${3:-}" \
      -H 'content-type: application/json' --data "$body"
  fi
}

echo "== 1. Authentication =="
FAN1=$(token_for fan1 fan12345)
FAN2=$(token_for fan2 fan12345)
check "fan1 receives an access token" "yes" "$([ -n "$FAN1" ] && echo yes || echo no)"
check "fan2 receives an access token" "yes" "$([ -n "$FAN2" ] && echo yes || echo no)"
ADM1=$(admission_for "$FAN1")
ADM2=$(admission_for "$FAN2")
check "both fans are admitted by the virtual queue" "yes" \
  "$([ -n "$ADM1" ] && [ -n "$ADM2" ] && echo yes || echo no)"

echo "== 2. The catalog is public (CAT-2, CAT-3) =="
check "GET /v1/events" "200" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$GATEWAY/v1/events")"
check "GET /v1/events/{id}/seats" "200" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$GATEWAY/v1/events/$EVENT_ID/seats")"
check "the seeded event has 200 seats" "200" \
  "$(curl -s "$GATEWAY/v1/events/$EVENT_ID/seats" | grep -o '"seatId"' | wc -l | tr -d ' ')"
check "$SEAT starts AVAILABLE" "AVAILABLE" "$(seat_status "$SEAT")"

echo "== 3. The gateway rejects anonymous holds (GW-2, feature 1) =="
check "POST /v1/holds with no token" "401" "$(post_holds_code - "[\"$SEAT\"]")"
check "POST /v1/holds with a forged token" "401" "$(post_holds_code not.a.jwt "[\"$SEAT\"]")"

echo "== 4. A fan holds the seat (RES-2) =="
HOLD_RESPONSE=$(curl -s -X POST "$GATEWAY/v1/holds" \
  -H "Authorization: Bearer $FAN1" -H "X-Admission-Token: $ADM1" -H 'content-type: application/json' \
  --data "$(hold_body "[\"$SEAT\"]")")
HOLD_ID=$(echo "$HOLD_RESPONSE" | sed -n 's/.*"holdId":"\([^"]*\)".*/\1/p')
check "the hold is created" "yes" "$([ -n "$HOLD_ID" ] && echo yes || echo no)"
check "it carries an expiry" "yes" \
  "$(echo "$HOLD_RESPONSE" | grep -q '"expiresAt"' && echo yes || echo no)"

echo "== 5. The read model catches up (RES-6 -> RabbitMQ -> CAT-5) =="
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ "$(seat_status "$SEAT")" = "HELD" ] && break
  sleep 0.5
done
check "$SEAT is now HELD in the catalog" "HELD" "$(seat_status "$SEAT")"

echo "== 6. The seat is really taken (core domain invariant) =="
check "fan2 asking for the same seat" "409" "$(post_holds_code "$FAN2" "[\"$SEAT\"]" "$ADM2")"
check "all-or-nothing: a group with one taken seat" "409" \
  "$(post_holds_code "$FAN2" "[\"A-01-09\",\"$SEAT\"]" "$ADM2")"
check "and A-01-09 was NOT taken either" "AVAILABLE" "$(seat_status A-01-09)"
check "more than 6 seats is refused" "422" \
  "$(post_holds_code "$FAN2" "[\"B-01-01\",\"B-01-02\",\"B-01-03\",\"B-01-04\",\"B-01-05\",\"B-01-06\",\"B-01-07\"]" "$ADM2")"

echo "== 7. Releasing gives the seat back (RES-3) =="
check "DELETE /v1/holds/{id} by another fan" "403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$GATEWAY/v1/holds/$HOLD_ID" \
     -H "Authorization: Bearer $FAN2")"
check "DELETE /v1/holds/{id} by the owner" "204" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$GATEWAY/v1/holds/$HOLD_ID" \
     -H "Authorization: Bearer $FAN1")"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ "$(seat_status "$SEAT")" = "AVAILABLE" ] && break
  sleep 0.5
done
check "$SEAT is AVAILABLE again" "AVAILABLE" "$(seat_status "$SEAT")"

echo
echo "passed: $passed   failed: $failed"
[ "$failed" -eq 0 ]
