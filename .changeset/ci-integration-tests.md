---
"@ubichill/backend": patch
"@ubichill/db": patch
---

DB・Redis の統合テストを CI で走らせるため、テストの前提（コミットされなくなった署名ファイル・手元の `.env`・短すぎる制限時間）を直す。動作は変わらない。
