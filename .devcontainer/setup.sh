#!/bin/bash
set -xe

# 1. 権限調整
sudo chown vscode:vscode .
[ -d node_modules ] || mkdir node_modules
sudo chown vscode:vscode node_modules

# 2. mise のセットアップ (Node / pnpm のバージョンは mise.toml で固定)
export PATH="$HOME/.local/bin:$PATH"

if ! command -v mise &> /dev/null; then
    curl https://mise.run | sh
fi

if ! grep -q "mise activate" "$HOME/.zshrc"; then
    echo 'eval "$(~/.local/bin/mise activate zsh)"' >> "$HOME/.zshrc"
fi

# 3. zshプラグインのセットアップ (Oh My Zshは導入済み前提)
ZSH_CUSTOM="$HOME/.oh-my-zsh/custom"
if [ ! -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ]; then
    git clone https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
fi

if [ ! -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ]; then
    git clone https://github.com/zsh-users/zsh-syntax-highlighting "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"
fi

# プラグインを有効化するための追記
if ! grep -q "zsh-autosuggestions.zsh" "$HOME/.zshrc"; then
    echo "source $ZSH_CUSTOM/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh" >> "$HOME/.zshrc"
    echo "source $ZSH_CUSTOM/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" >> "$HOME/.zshrc"
fi

# Oh My Zshのテーマ
sed -i 's/^ZSH_THEME=.*/ZSH_THEME="agnoster"/' "$HOME/.zshrc"

# 4. パッケージインストール
mise trust
mise install
mise exec -- pnpm install