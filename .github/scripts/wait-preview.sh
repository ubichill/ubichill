#!/usr/bin/env bash
# プレビュー（https://pr-<番号>.ubichill.com）が PR の head のコミットで応答するまで待ち、GITHUB_OUTPUT に deployed=true|false を書く。
# Argo CD が新しい sha のイメージで入れ替えるのを、backend の /api/version の commitHash で確かめる。
set -euo pipefail

url="https://pr-${PR_NUMBER}.ubichill.com"
short_sha="${HEAD_SHA:0:7}"
deadline=$(( $(date +%s) + ${WAIT_MINUTES:-15} * 60 ))

deployed=false
while [ "$(date +%s)" -lt "$deadline" ]; do
  current=$(curl -fsS --max-time 10 "${url}/api/version" 2>/dev/null | sed -n 's/.*"commitHash":"\([0-9a-f]*\)".*/\1/p' || true)
  if [ "$current" = "$short_sha" ]; then
    deployed=true
    break
  fi
  sleep 20
done

echo "deployed=${deployed}" >> "$GITHUB_OUTPUT"
echo "プレビュー ${url} は ${short_sha} で応答: ${deployed}"
