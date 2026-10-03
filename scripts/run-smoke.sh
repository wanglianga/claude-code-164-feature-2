#!/usr/bin/env bash
# 业务断言冒烟测试：全场人数不足自动调整（R-MERGE-2）
# 每个场景独立进程运行，保证初始 mock 数据干净。
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p tmp
./node_modules/.bin/esbuild scripts/smoke-underfill.ts \
  --bundle --platform=node --format=esm \
  --outfile=tmp/smoke-underfill.mjs >/dev/null

for s in keep downgrade-release timeout-release merge core; do
  echo "==================== scenario: $s ===================="
  node tmp/smoke-underfill.mjs "$s"
done

echo
echo "ALL SMOKE SCENARIOS PASSED ✅"
