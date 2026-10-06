#!/usr/bin/env bash
#
# 変更パスを検知し、backend / frontend / instance の build 要否を判定する。
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
#   push to main では PR_ACTION=synchronize / PR_BEFORE_SHA=push 前の HEAD として呼ぶ。
#   diff が取れなければ全部 true にする（ビルド漏れより無駄なビルドの方がまし）。
#
# 出力 (GITHUB_OUTPUT):
#   backend       = true|false
#   frontend      = true|false
#   instance      = true|false
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

backend=false
frontend=false
instance=false

if ! CHANGED=$(git diff --name-only "${BASE_SHA}" "${PR_HEAD_SHA}"); then
    echo "diff を取得できないため全部ビルドする"
    CHANGED=""
    backend=true
    frontend=true
    instance=true
fi
echo "Changed files:"
echo "${CHANGED}" | sed 's/^/  /'

while IFS= read -r f; do
    [[ -z "${f}" ]] && continue
    case "${f}" in
        packages/backend/*|packages/shared/*|packages/db/*|Dockerfile|pnpm-lock.yaml)
            backend=true ;;
    esac
    case "${f}" in
        packages/react/*|packages/frontend/*|packages/bff/*|packages/shared/*|packages/sdk/*|packages/ecs/*|packages/sandbox/*|packages/ui-renderer/*|packages/loader/*|packages/runtime/*|packages/core-components/*|mods/*|scripts/build-workers.mjs|Dockerfile|pnpm-lock.yaml)
            frontend=true ;;
    esac
    case "${f}" in
        services/instance/*)
            instance=true ;;
    esac
done <<< "${CHANGED}"

{
    echo "backend=${backend}"
    echo "frontend=${frontend}"
    echo "instance=${instance}"
} >> "${GITHUB_OUTPUT}"

echo "→ backend=${backend} frontend=${frontend} instance=${instance}"
