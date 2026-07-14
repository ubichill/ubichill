#!/usr/bin/env bash
#
# PR の変更パスを検知し、backend / frontend / video-player の build 要否を判定する。
#
# 呼び出し: GitHub Actions の "Detect changed paths" step から実行される。
# 環境変数:
#   PR_ACTION       — github.event.action ("opened" | "synchronize" | "reopened" 等)
#   PR_HEAD_SHA     — github.event.pull_request.head.sha
#   PR_BEFORE_SHA   — github.event.before (synchronize 時のみ意味を持つ)
#   PR_BASE_SHA     — github.event.pull_request.base.sha
#   GITHUB_OUTPUT   — Actions が自動でセットする結果書き込み先
#
# diff の取り方:
#   - synchronize かつ before が reachable: 前回 push HEAD との incremental
#   - それ以外 (opened / reopened / force-push 等): PR base からの cumulative
#
# 出力 (GITHUB_OUTPUT):
#   backend       = true|false
#   frontend      = true|false
#   video-player  = true|false
set -eo pipefail

if [[ "${PR_ACTION:-}" == "synchronize" && -n "${PR_BEFORE_SHA:-}" ]] \
   && git cat-file -e "${PR_BEFORE_SHA}" 2>/dev/null; then
    BASE_SHA="${PR_BEFORE_SHA}"
    MODE="incremental (前回 push HEAD との差分)"
else
    BASE_SHA="${PR_BASE_SHA}"
    MODE="cumulative (PR base からの差分)"
fi

echo "Mode: ${MODE}"
echo "Base: ${BASE_SHA}  Head: ${PR_HEAD_SHA}"

CHANGED=$(git diff --name-only "${BASE_SHA}" "${PR_HEAD_SHA}" || true)
echo "Changed files:"
echo "${CHANGED}" | sed 's/^/  /'

backend=false
frontend=false
video_player=false

while IFS= read -r f; do
    [[ -z "${f}" ]] && continue
    case "${f}" in
        packages/backend/*|packages/shared/*|packages/db/*|Dockerfile|pnpm-lock.yaml)
            backend=true ;;
    esac
    case "${f}" in
        packages/frontend/*|packages/shared/*|packages/sdk/*|mods/*|scripts/build-workers.mjs|Dockerfile|pnpm-lock.yaml)
            frontend=true ;;
    esac
    case "${f}" in
        mods/video-player/backend/*)
            video_player=true ;;
    esac
done <<< "${CHANGED}"

{
    echo "backend=${backend}"
    echo "frontend=${frontend}"
    echo "video-player=${video_player}"
} >> "${GITHUB_OUTPUT}"

echo "→ backend=${backend} frontend=${frontend} video-player=${video_player}"
