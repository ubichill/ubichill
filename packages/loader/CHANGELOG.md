# @ubichill/loader

## 1.1.0

### Minor Changes

- 988f2c8: `ubichill install <world.yaml> --check` を追加した。`worlds/*.lock.json`（mod 完全性ロック）を
  書き換えず、現在の mod ビルドと一致しているかだけを検証し、不一致なら非ゼロ終了する。

  mod のソースを再ビルドしてハッシュが変わっても `worlds/*.lock.json` は自動更新されず、これまでは
  `ubichill install` の実行を忘れると気づけないまま陳腐化していた（ローカル開発では console.warn の
  み・ビルド後に古いハッシュのファイルが消えると SPA fallback の HTML を worker として読み込もうと
  して失敗する、という分かりにくい壊れ方をする）。

  `worlds/*.lock.json` は `pnpm-lock.yaml` と同じ「コミットされる、レビュー可能な固定ピン」という
  位置づけ（外部/URL 由来のワールドを読み込む側は今も不一致を fail-closed 拒否する。参照:
  `packages/loader/src/acquireMod.ts` の `requiresLock`）。そこで `pnpm build:workers` の最終
  ステップとして `worlds/*.yaml` 全件の lock を自動再生成するようにし（`pnpm gen:world-locks` /
  `scripts/world-locks.mjs`）、「mod を直したのに手動コマンドを忘れて陳腐化する」というミスの
  クラスを無くした。CI では `pnpm build:workers`（regen 込み）の直後に `git diff --exit-code --
worlds/` を実行し、再生成後の内容とコミット済みの内容がズレていれば（＝再生成した lock を
  コミットし忘れていれば）落とす（frozen-lockfile チェックと同じパターン）。
  `pnpm verify:world-locks`（`scripts/world-locks.mjs --check`）はローカルで手早く陳腐化だけ
  確認したいときのユーティリティとして残す。あわせて、開発時の console.warn 2 箇所に
  `ubichill install <world.yaml>` を促す具体的なヒントを追加した。

### Patch Changes

- 7c89fcb: 1 Entity に複数 Component を配置できるようにし、Component 単位で `transform` を上書き可能にした。`dataFields` に `entityRef`/`entityRefArray` 型を追加し、mod が Editor 上で他 Entity を明示的にターゲティングできるようにした。

  - `entityRef`/`entityRefArray` で明示配線した Entity は `watchScope` 外でも読み書きを許可する(`declaredTargets`)。
  - Component の見た目（jsx/canvas/ロジック）は manifest 宣言ではなく `canvasTargets` / `ui:render` capability から自動判定するようにした（`renderKind` 宣言は不要）。
  - ワールドの `dependencies[].source` から `type` ディスクリミネータを廃止し、`url` の有無で「外部 URL / ローカル（public mods）」を判定するようにした（旧 `type` は無視され後方互換）。
  - `ubichill build` が出力する `index.json` に外部レジストリの既存バージョン履歴をマージするようにし、mod 開発者がバージョン管理を意識しなくても複数バージョン公開が維持されるようにした。

  あわせて、`Ubi.entity().update()` の自己更新が `watchScope` チェックで誤って拒否される重大なリグレッションを修正した。`onUpdateEntity`/`onDestroyEntity` が受け取る id は componentInstanceId であり GameObject id とは別の識別子空間だったが、旧実装はこれを混同しており全 mod の自己更新が壊れていた。

- Updated dependencies [988f2c8]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
- Updated dependencies [7c89fcb]
  - @ubichill/shared@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [13aee7d]
- Updated dependencies [13aee7d]
  - @ubichill/shared@1.0.1
