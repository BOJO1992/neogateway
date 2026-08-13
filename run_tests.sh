#!/bin/bash
# OmniRoute Gateway - Full E2E Test Script
# Run after npm install and npm run build

set -e
PROJ="/Users/soumen/ALL route gateway/omniroute-gateway"
cd "$PROJ"

echo "=== STEP 1: Prisma DB Push ==="
DATABASE_URL="file:./data/dev.db" npx prisma db push --accept-data-loss
echo "DB push complete"

echo ""
echo "=== STEP 2: Build ==="
npm run build 2>&1 | tail -20
echo "Build complete"

echo ""
echo "=== STEP 3: Start Server ==="
NODE_ENV=production DATABASE_URL="file:./data/dev.db" node .next/standalone/server.js &
SERVER_PID=$!
echo "Server started with PID $SERVER_PID"

# Wait for server to be ready
echo "Waiting for server on port 3000..."
for i in {1..30}; do
  if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "Server is up!"
    break
  fi
  sleep 1
done

echo ""
echo "=== STEP 4: Health Check ==="
curl -s http://localhost:3000/api/health | python3 -m json.tool

echo ""
echo "=== STEP 5: Stats API ==="
curl -s http://localhost:3000/api/stats | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f'total: {d[\"total\"]}')
print(f'freeTier: {d[\"freeTier\"]}')
print(f'totalModels: {d[\"totalModels\"]}')
"

echo ""
echo "=== STEP 6: POST /api/chat ==="
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}],"model":"gpt-4.1"}' | python3 -m json.tool | head -20

echo ""
echo "=== STEP 7: Frontend Check ==="
PAGE=$(curl -s http://localhost:3000)
for keyword in "OmniRoute" "Gateway" "Provider" "Free"; do
  if echo "$PAGE" | grep -qi "$keyword"; then
    echo "✓ Found: $keyword"
  else
    echo "✗ Missing: $keyword"
  fi
done

echo ""
echo "=== STEP 8: Providers API ==="
curl -s http://localhost:3000/api/providers | python3 -c "
import json,sys
d=json.load(sys.stdin)
if isinstance(d, list):
  print(f'Providers count: {len(d)}')
else:
  print(d)
" 2>/dev/null | head -5

echo ""
echo "=== All tests complete ==="
echo "Server PID: $SERVER_PID (still running)"
