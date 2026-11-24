---
"@ubichill/cli": minor
---

`ubichill init mod` の雛形に、AI エージェント向けの skill（`.claude/skills/ubichill-mod/SKILL.md`）を入れる。Worker の中でできないこと（DOM・`fetch`・`eval`・CORS）、`Ubi.state` での共有と保存、権限、公開した版を変えない決まりを書き、API はインストールした `ubichill` の README と型を正とするよう案内する。
