---
"@ubichill/shared": minor
"@ubichill/loader": minor
"@ubichill/cli": minor
"@ubichill/backend": minor
"@ubichill/db": patch
---

作者参照から分散配布の mod package を取得・追加できるようにし、作者固定の lock v2、package 内プレハブの配置・差分更新・Unpack、標準 Component の表示、作成用CLIと作品ページ・検索を追加する。既存lockを保存時に維持し、依存更新の失敗で YAML と lock が食い違わないようにする。DB は配布物や版履歴を保存せず、作者と mod ID ごとの登録ポインタを使う。

エディタで更新先を取得できなかった場合は、古い lock で補わず変更を取りやめ、以前の依存と lock を維持する。
