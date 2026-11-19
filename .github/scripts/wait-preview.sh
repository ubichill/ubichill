#!/usr/bin/env bash
# プレビューのフロントエンド・バックエンドが対象のコミットで応答するまで待つ。
set -euo pipefail

pr_number="${1:-${PR_NUMBER:-}}"
head_sha="${2:-${HEAD_SHA:-}}"
if [[ ! "$pr_number" =~ ^[1-9][0-9]*$ || ! "$head_sha" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "使い方: $0 <PR 番号> <コミット SHA>" >&2
  exit 2
fi

url="https://pr-${pr_number}.ubichill.com"
short_sha="${head_sha:0:7}"
deadline=$(( $(date +%s) + ${WAIT_MINUTES:-15} * 60 ))

commit_at() {
  curl -fsS --max-time 10 "${url}$1?t=$(date +%s)" 2>/dev/null     | jq -er '.commitHash | select(type == "string")' 2>/dev/null || true
}

deployed=false
frontend=
backend=
while [ "$(date +%s)" -lt "$deadline" ]; do
  frontend=$(commit_at /version.json)
  backend=$(commit_at /api/version)
  if [ "$frontend" = "$short_sha" ] && [ "$backend" = "$short_sha" ]; then
    deployed=true
    break
  fi
  sleep 20
done

echo "プレビュー ${url} (${short_sha}): frontend=${frontend:-未応答} backend=${backend:-未応答}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "deployed=${deployed}" >> "$GITHUB_OUTPUT"
else
  [ "$deployed" = true ]
fi
