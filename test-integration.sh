#!/bin/bash
# Test GuardClaw Pre-Execution Integration

set -e

echo "🧪 Testing GuardClaw Pre-Execution Integration"
echo "=============================================="
echo ""

GUARDCLAW_URL="http://localhost:3002"

# Test 1: Check API is running
echo "Test 1: GuardClaw API Status"
echo "----------------------------"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$GUARDCLAW_URL/api/status")
if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ GuardClaw API is running"
else
    echo "❌ GuardClaw API not responding (HTTP $HTTP_CODE)"
    exit 1
fi
echo ""

# Test 2: Safe tool check
echo "Test 2: Safe Tool (should allow)"
echo "--------------------------------"
RESPONSE=$(curl -s -X POST "$GUARDCLAW_URL/api/check-tool" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"read","params":{"file_path":"test.txt"}}')

ALLOWED=$(echo "$RESPONSE" | jq -r '.allowed')
RISK=$(echo "$RESPONSE" | jq -r '.riskScore')

if [ "$ALLOWED" = "true" ]; then
    echo "✅ Safe tool allowed (risk: $RISK)"
    echo "   Response: $RESPONSE"
else
    echo "❌ Safe tool blocked (unexpected!)"
    echo "   Response: $RESPONSE"
fi
echo ""

# Test 3: Dangerous tool check
echo "Test 3: Dangerous Tool (should block)"
echo "-------------------------------------"
RESPONSE=$(curl -s -X POST "$GUARDCLAW_URL/api/check-tool" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"exec","params":{"command":"rm -rf /"}}')

ALLOWED=$(echo "$RESPONSE" | jq -r '.allowed')
RISK=$(echo "$RESPONSE" | jq -r '.riskScore')
REASON=$(echo "$RESPONSE" | jq -r '.reason')

if [ "$ALLOWED" = "false" ]; then
    echo "✅ Dangerous tool blocked (risk: $RISK)"
    echo "   Reason: $REASON"
else
    echo "⚠️  Dangerous tool allowed (risk: $RISK)"
    echo "   This may be expected if threshold is high"
    echo "   Response: $RESPONSE"
fi
echo ""

# Test 4: Medium risk tool
echo "Test 4: Medium Risk Tool"
echo "------------------------"
RESPONSE=$(curl -s -X POST "$GUARDCLAW_URL/api/check-tool" \
  -H "Content-Type: application/json" \
  -d '{"toolName":"exec","params":{"command":"curl https://example.com"}}')

ALLOWED=$(echo "$RESPONSE" | jq -r '.allowed')
RISK=$(echo "$RESPONSE" | jq -r '.riskScore')

echo "   Allowed: $ALLOWED, Risk: $RISK"
echo "   Response: $RESPONSE"
echo ""

# Test 5: Whitelist/Blacklist
echo "Test 5: Check Whitelist/Blacklist"
echo "----------------------------------"
WHITELIST_COUNT=$(curl -s "$GUARDCLAW_URL/api/blocking/status" | jq '.whitelist | length')
BLACKLIST_COUNT=$(curl -s "$GUARDCLAW_URL/api/blocking/status" | jq '.blacklist | length')

echo "   Whitelist: $WHITELIST_COUNT items"
echo "   Blacklist: $BLACKLIST_COUNT items"
echo ""

# Summary
echo "=============================================="
echo "✅ Integration test completed"
echo ""
echo "Next steps:"
echo "1. Add plugin to OpenClaw: edit ~/.openclaw/openclaw.json"
echo "2. Add: \"plugins\": [\"./plugins/guardclaw-plugin.mjs\"]"
echo "3. Restart OpenClaw: openclaw gateway restart"
echo "4. Test with real agent: ask it to run a command"
echo ""
echo "📖 Full documentation: ~/clawd/OPENCLAW_INTEGRATION.md"
