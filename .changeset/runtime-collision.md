---
"@ubichill/sdk": patch
---

Host 組み込み Component の「実行時の振る舞い」を持つ `@ubichill/runtime` を新設した。
Collider の型と幾何計算をここへ移し、接触の検出 (`detectContacts`) と前フレームとの差分
(`diffContacts` / `createCollisionTracker`) を純関数として追加した。DOM もネットワークも時計も
持たないので、ブラウザでもサーバーでも同じコードが動く。

これに伴い `@ubichill/core-components` は「データ形式 (Zod スキーマ)」だけを持つようになり、
SDK が Component の実装パッケージに依存する形を解消した。SDK の公開 API (`ColliderData` /
`overlaps` / `resolveColliderGeometry` / `matchesCollisionLayers` / `CORE_COMPONENT_TYPES`) は
名前も型も変わらないため、mod 側の変更は不要。
