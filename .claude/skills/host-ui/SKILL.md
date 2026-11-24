---
name: host-ui
description: ubichill の Host の画面（packages/frontend の HUD・ランチパッド・設定・コントロールパネル・ワールドのエディタなど）を作る・変える・見た目を確かめるときに使う。コードからは分からない画面の好みと、DB なしで画面を撮る手順。
---

# Host の画面

PandaCSS・`tokens.colors`・`css()` と `cva()`・SVG のアイコン・`className` は CLAUDE.md の規則。ここに書くのは、コードを読んでも分からない好みと、確かめ方。

## 好み

- **言わなくても分かる文字を入れない。** マイページのボタンに「マイページ」、「通知」タブの中に「通知」の見出し、ボタンの横の補足、長い説明文。アイコン・位置・タブ名で伝わるなら書かない。文字を消したアイコンボタンには `aria-label` を付ける。
- **ホバーで浮かせない。** 反応は色が変わる程度にとどめる。
- **押したらその場で反映する。** 「選ぶ → 差分を見る → 確定」を挟まない。安全の確認（署名・hash・権限の増加）は反映の前に裏で行い、確認が要るとき（権限が増える・置いた物が壊れる）だけダイアログを出す。
- **まとめて操作するものはチェックボックスにする。** 一覧の上に帯（「N 件を追加」）を出す。浮かせない。
- **出どころが違う一覧はタブで切り替える。** このサーバー・連合・自分で足したもの、のような一覧は別の画面に分けない。
- **表示名は型名の読みにそろえる。** `core:portal` は「ポータル」で、「入口」と意訳しない。スポーン・イメージ・テキストも同じ。エディタの表示と YAML が同じものだと分かるようにするため。部品の名前ではない data の項目の説明（「文字の色」など）は普通の日本語でよい。
- **動線を考える。** 言われたとおりに並べて終わらせない。ユーザーが次に何をしたいかで、置き場所と順番を決める。

画面を作り終えたら、上の順で見直して削る。

## DB なしで画面を撮る

`pnpm dev` 全体（Docker・DB・Go）を起こさずに、HUD などの見た目を確かめる手順。

1. 一時ページを置く。`packages/frontend/zz-preview-<名前>.html` と `packages/frontend/src/zz-preview-<名前>.tsx`。tsx は `src` の中に置く（Panda が `./src/**` しか拾わないため）。どちらも `.gitignore` 済みで、終わったら消す。
2. tsx で `window.fetch` を差し替え、URL の正規表現で偽の JSON を返す（`/api/auth/get-session`・`/api/v1/...`）。用意していないものは 404 にする。
3. Provider は本物と同じ順で包む。順番は `src/main.tsx`（`SocketProvider` → `WorldProvider`）と `src/router.tsx`（`SessionProvider` → `NotificationsProvider` → `ConfirmProvider`）を見る。`BrowserRouter` は `MemoryRouter` に替える。Socket が無いと `HudOverlay` が落ちる。
4. Vite は別のポートで、自分で起こす。例：`mise exec -- pnpm --filter @ubichill/frontend exec vite --port 5391 --strictPort`。
5. Playwright で 1440・1000・390 の幅で撮る。左右のタブや、中の切り替えの崩れが分かる。スクリプトはリポジトリの外（`/tmp/<作業名>/`）に置き、`node_modules/.pnpm/playwright@<版>/node_modules/playwright/index.mjs` を絶対パスで import する。

## サーバーを止めるとき

- 3000・3001・3002 は `pnpm dev` が使う。確認用のサーバーは別のポートで起こす。起こす前に `lsof -nP -iTCP:<port> -sTCP:LISTEN` で空いているか見る。
- 止めるのは自分が起こした PID だけ。`kill $(lsof -ti tcp:3001)` のようにポートで止めない。人の `pnpm dev` を止めると、`scripts/dev.mjs` の終了処理が `docker compose down` を走らせ、DB のコンテナが消える。
