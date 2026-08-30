---
"@ubichill/sdk": patch
---

Worker（Component）ごとに `requestAnimationFrame` を持っていた tick を、ワールド全体で 1 本の
ループに統一した。Component の数だけループが走る状態と、同じフレーム内で
どの Worker が先に進むか保証がない状態を解消する。

フレームは「先にワールドを進め、その結果を持って各 Worker を進める」構成になり、
Host が確定させた事実を同じフレームの tick で mod へ渡せるようになった。
その最初の適用として、`core:collider` の接触を Host が判定し、関係する Entity 上の mod へ
`collision:enter` / `collision:exit` を配る。mod は `events.on('collision:enter', ...)` で
受け取れる（emit と同じ経路なので、専用のプロトコルは増えていない）。

ループを 1 本に束ねたことで「mod 1 つの例外でワールド全体の時間が止まる」危険が生まれるため、
各購読者の例外は隔離し、1 つが投げても残りは必ず実行する。
