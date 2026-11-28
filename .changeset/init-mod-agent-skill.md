---
"@ubichill/cli": minor
---

`ubichill init mod` の雛形に、AI エージェント向けの skill `ubichill-mod` を入れる。Codex が読む `.agents/skills/` と Claude Code が読む `.claude/skills/` に同じ中身で置く。Worker の中でできないこと（DOM・`fetch`・`eval`・CORS）、`Ubi.state` での共有と保存、権限、公開した版を変えない決まりを書き、API はインストールした `ubichill` の README と型を正とするよう案内する。
