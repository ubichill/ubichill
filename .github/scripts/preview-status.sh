#!/usr/bin/env bash
# PR のプレビュー環境の状態を 1 つのコメントにまとめて書く（既にあれば更新する）。
# プレビューは home-manifests の ApplicationSet が PR の head の sha のイメージで立てるので、
# ここでは「イメージを作れたか」「https://pr-<番号>.ubichill.com が新しいコミットで応答するか（wait-preview.sh）」と、
# スモーク（packages/e2e）の結果を載せる。
#
# SMOKE: running（走らせている途中）/ done（SMOKE_REPORT に結果の JSON）/ skipped（立ち上がらなかったので走らせていない）
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

# スモークの 1 段（api / browser）の表の値
smoke_mark() {
  case "${SMOKE:-skipped}" in
    running) echo "実行中" ; return ;;
    skipped) echo "スキップ（プレビューが立ち上がっていません）" ; return ;;
  esac
  if [ -z "${SMOKE_REPORT:-}" ] || [ ! -s "$SMOKE_REPORT" ]; then
    echo "**失敗**（結果がありません。CI の実行のログを見てください）"
    return
  fi
  local status seconds failed
  status=$(jq -r --arg s "$1" '.suites[$s].status // "missing"' "$SMOKE_REPORT")
  seconds=$(jq -r --arg s "$1" '((.suites[$s].ms // 0) / 1000 | floor)' "$SMOKE_REPORT")
  # 表の 1 マスに収める（| と改行を潰し、長すぎる理由は切る）
  failed=$(jq -r --arg s "$1" '.suites[$s].failedStep // "" | gsub("[|\n\r]"; " ") | .[0:200]' "$SMOKE_REPORT")
  case "$status" in
    passed) echo "通過（${seconds} 秒）" ;;
    failed) echo "**失敗**: ${failed}" ;;
    *) echo "**失敗**（結果がありません。CI の実行のログを見てください）" ;;
  esac
}

images_ok=true
for r in "$BUILD_BACKEND" "$BUILD_FRONTEND" "$BUILD_INSTANCE"; do
  [ "$r" = "success" ] || images_ok=false
done

if [ "${DEPLOYED:-false}" = "true" ]; then
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
smoke_notes=""
if [ "${SMOKE:-}" = "done" ]; then
  smoke_notes="スモークは今は情報だけで、落ちてもマージは止めません。失敗したときのスクリーンショット・コンソールのログは CI の実行の成果物（smoke-results）にあります。テスト用アカウントは \`smoke_\` で始まります。"
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
| スモーク（API） | $(smoke_mark api) |
| スモーク（ブラウザ） | $(smoke_mark browser) |

${notes}

${smoke_notes}

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
