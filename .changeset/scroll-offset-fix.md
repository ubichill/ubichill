---
"@ubichill/ui-renderer": patch
---

ワールドをスクロールした状態で描くと、クリックした位置からスクロール量だけずれた場所に線が
描かれるのを修正した。

入力座標をワールド座標へ直すためのスクロール量供給元(`data-scroll-world`)の登録が、マウント時の
一度だけだった。Worker は `myUserId`(接続後に確定) や `enabled`(権限承認後) の変化で作り直され、
その際に新しい instanceKey で登録が null に戻るため、実際のセッションではほぼ必ず登録が失われ、
スクロール量が 0 として扱われていた。`workerRevision` の変化で再登録するようにした(`@ubichill/react` の WorkerModHost。同パッケージは
changeset の ignore 対象なのでバージョンは上げない)。

回帰テストとして、InputCollector の座標変換(x/y にスクロール量が乗り viewportX/Y は素の座標)と、
SharedInputPool の Worker 再生成時の挙動を固定した。
