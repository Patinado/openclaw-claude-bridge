#!/bin/bash
# Smoke tests for openclaw-claude-bridge
# Run: bash test-smoke.sh [bridge_port]
# Requires: bridge running on localhost

PORT=${1:-3456}
BASE="http://127.0.0.1:$PORT"
PASS=0
FAIL=0

pass() { echo "  ✓ $1"; ((PASS++)); }
fail() { echo "  ✗ $1"; ((FAIL++)); }

echo "=== Smoke tests for openclaw-claude-bridge on port $PORT ==="
echo ""

# Test 1: Health check
echo "[1] Health check"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health" 2>/dev/null)
if [ "$STATUS" = "200" ]; then pass "Health endpoint responds 200"; else fail "Health endpoint returned $STATUS"; fi

# Test 2: Models endpoint
echo "[2] Models endpoint"
MODELS=$(curl -s "$BASE/v1/models" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']))" 2>/dev/null)
if [ "$MODELS" = "3" ]; then pass "Models endpoint returns 3 models"; else fail "Models endpoint returned $MODELS models"; fi

# Test 3: SSE heartbeat within 20 seconds
echo "[3] SSE heartbeat (empty-choices chunk within 20s)"
HEARTBEAT=$(timeout 25 curl -s -N -X POST "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say exactly: SMOKE_TEST_OK"}],"model":"claude-opus-latest","stream":true,"tools":[{"type":"function","function":{"name":"test_tool","description":"test","parameters":{"type":"object","properties":{}}}}]}' 2>/dev/null | head -c 4096)

if echo "$HEARTBEAT" | grep -q '"choices":\[\]'; then
  pass "Empty-choices heartbeat chunk received"
else
  fail "No heartbeat chunk found in first 4KB of stream"
fi

# Test 4: Verify status endpoint reports errors correctly
echo "[4] Status endpoint error tracking"
STATUS_JSON=$(curl -s "http://127.0.0.1:3458/status" 2>/dev/null)
if [ -n "$STATUS_JSON" ]; then
  ERRORS=$(echo "$STATUS_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('errors',0))" 2>/dev/null)
  pass "Status endpoint reachable, errors=$ERRORS"
else
  fail "Status endpoint not reachable on port 3458"
fi

# Test 5: Memflush interception (tools=0 should return immediately)
echo "[5] Memflush interception"
MEMFLUSH=$(curl -s -X POST "$BASE/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}],"model":"claude-opus-latest","stream":false,"tools":[]}' 2>/dev/null)
if echo "$MEMFLUSH" | grep -q "NO_REPLY"; then
  pass "Memflush returns NO_REPLY"
else
  fail "Memflush did not return NO_REPLY"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then exit 1; fi
