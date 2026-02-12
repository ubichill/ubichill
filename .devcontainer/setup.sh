#!/bin/bash
set -xe

# 1. 権限調整
sudo chown vscode:vscode .
[ -d node_modules ] || mkdir node_modules
sudo chown vscode:vscode node_modules

# 2. Volta & pnpmのセットアップ
export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"
if ! command -v volta &> /dev/null; then
    curl https://get.volta.sh | bash
fi
volta install node
volta install pnpm

# 3. インストール
pnpm install