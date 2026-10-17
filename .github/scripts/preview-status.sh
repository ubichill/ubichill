#!/usr/bin/env bash
# PR のプレビュー環境の状態を 1 つのコメントにまとめて書く（既にあれば更新する）。
# プレビューは home-manifests の ApplicationSet が PR の head の sha のイメージで立てるので、
# ここでは「イメージを作れたか」と「https://pr-<番号>.ubichill.com が新しいコミットで応答するか」を確かめる。
set -euo pipefail

marker='<!-- ubichill-preview-status -->'
url="https://pr-${PR_NUMBER}.ubichill.com"
# URL は必ず Markdown のリンクにする。裸の URL の後に全角の「）」「。」が続くと、GitHub の自動リンクがそれも URL に含める
link="[pr-${PR_NUMBER}.ubichill.com](${url})"
short_sha="${HEAD_SHA:0:7}"

mark() {
  case "$1" in
    success) echo "通過" ;;
    failure) echo "**失敗**" ;;
    skipped) echo "スキップ" ;;
    cancelled) echo "取り消し" ;;
    *) echo "$1" ;;
  esac
}

images_ok=true
for r in "$BUILD_BACKEND" "$BUILD_FRONTEND" "$BUILD_INSTANCE"; do
  [ "$r" = "success" ] || images_ok=false
done

deployed=false
if $images_ok; then
  # Argo CD が新しい sha のイメージで入れ替えるのを待つ（backend の /api/version が新しいコミットを返すまで）
  deadline=$(( $(date +%s) + 15 * 60 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    current=$(curl -fsS --max-time 10 "${url}/api/version" 2>/dev/null | sed -n 's/.*"commitHash":"\([0-9a-f]*\)".*/\1/p' || true)
    if [ "$current" = "$short_sha" ]; then
      deployed=true
      break
    fi
    sleep 20
  done
fi

if $deployed; then
  headline="プレビューは \`${short_sha}\` で動いています: ${link}"
elif $images_ok; then
  headline="イメージは作りましたが、15 分以内に \`${short_sha}\` で立ち上がりませんでした（${link}）。Argo CD の Application \`ubichill-preview-pr-${PR_NUMBER}\` を確認してください"
else
  headline="プレビュー用のイメージを作れなかったので、プレビューは古いコミットのまま（または起動できない）です"
fi

notes=""
if [ "$TEST" != "success" ] || [ "$LINT" != "success" ]; then
  notes="lint・テストが通っていない状態のプレビューです。動作の確認には使えますが、マージの前に直してください。"
fi

body="${marker}
### プレビュー環境

${headline}

| 項目 | 結果 |
|---|---|
| typecheck | $(mark "$TYPECHECK") |
| lint | $(mark "$LINT") |
| test | $(mark "$TEST") |
| backend のイメージ | $(mark "$BUILD_BACKEND") |
| frontend のイメージ | $(mark "$BUILD_FRONTEND") |
| instance のイメージ | $(mark "$BUILD_INSTANCE") |

${notes}

PR の \`charts/ubichill/values-preview.yaml\` で、このプレビューだけの構成を指定できます（例: Go を複数 Pod にする）。
[CI の実行](${RUN_URL})"

existing=$(gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" --paginate \
  --jq ".[] | select(.body | startswith(\"${marker}\")) | .id" | head -n 1)
if [ -n "$existing" ]; then
  gh api --method PATCH "repos/${REPO}/issues/comments/${existing}" -f body="$body" >/dev/null
else
  gh api --method POST "repos/${REPO}/issues/${PR_NUMBER}/comments" -f body="$body" >/dev/null
fi
echo "$headline"
