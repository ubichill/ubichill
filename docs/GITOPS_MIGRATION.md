# GitOps 申し送り: dev 廃止 / PR ごとプレビュー環境

アプリ本体側（このリポジトリ）で **dev 環境の自動反映を廃止**し、**PR ごとに immutable
イメージ**を publish する方式へ移行した。実デプロイは GitOps リポジトリ（ArgoCD）側で
**ApplicationSet の PR generator** が担う。

## 1. アプリ repo 側の挙動（実装済み）

イメージタグ（backend / frontend / video-player-backend）:

| きっかけ | タグ |
|---|---|
| `main` への push（マージ） | `:latest` / `:sha-<sha>` / `:<version>` |
| PR に **`preview` ラベル**を付与 | `:pr-<番号>`（PR の最新）/ `:sha-<sha>`（不変） |

- **`preview` ラベルの付いた PR だけ**イメージをビルドする（[.github/workflows/ci.yml](../.github/workflows/ci.yml)）。
  ラベル付与（`labeled` イベント）で即ビルドが走る。ラベルの無い PR は lint/typecheck のみ。
- 共有の可変 `:dev` タグと `dev` ブランチへの force-push は**廃止**（もう `refs/heads/dev` は更新されない）。
- 認証メール送信元は `MAIL_FROM` env で差し替え可能（未設定なら resend.dev サンドボックス）。

> **セキュリティ**: `preview` ラベルはメンテナだけが付ける運用にすること。付けない限り
> 外部フォークの未検証コードはビルド/デプロイされない。

## 2. GitOps 側でやること

### (a) 旧 dev の廃止
- `dev` ブランチ / `:dev` / `:dev-<sha>` を watch する Application と image-updater 設定を削除。

### (b) Production
- `image.tag` を `:latest`（再現性重視なら `:sha-<sha>` / `:<version>` ピン）に。
- `MAIL_FROM` を検証済みドメイン送信元に設定。`global.domain` は従来どおり注入。

### (c) PR プレビュー（ApplicationSet PR generator）
GitOps repo に以下を追加する（**ラベル `preview` で CI と一致**）。ArgoCD は goTemplate 記法。

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: ubichill-preview
  namespace: argocd
spec:
  goTemplate: true
  goTemplateOptions: ["missingkey=error"]
  generators:
    - pullRequest:
        github:
          owner: ubichill
          repo: ubichill
          tokenRef: { secretName: github-token, key: token }
        # ★ CI のビルドゲートと同じラベル。付いた PR だけ env を払い出す
        labels: ["preview"]
        requeueAfterSeconds: 120
  template:
    metadata:
      name: "ubichill-pr-{{ .number }}"
    spec:
      project: default
      source:
        repoURL: https://github.com/ubichill/ubichill.git
        # PR の HEAD を使うとチャート変更もプレビューできる
        targetRevision: "{{ .head_sha }}"
        path: charts/ubichill
        helm:
          releaseName: "ubichill-pr-{{ .number }}"
          valueFiles: ["values-dev.yaml"]
          parameters:
            # ★ 必ず単一階層サブドメインにする（サブサブドメイン pr-N.dev.<domain> は不可）。
            #   Cloudflare universal SSL / *.<domain> ワイルドカードは1階層しかカバーしないため。
            - { name: global.domain,     value: "pr-{{ .number }}.<your-domain>" }
            - { name: backend.image.tag,  value: "pr-{{ .number }}" }
            - { name: frontend.image.tag, value: "pr-{{ .number }}" }
            # plugin backend も PR タグへ（values-dev の pluginBackends[0]）
            - { name: pluginBackends[0].image.tag, value: "pr-{{ .number }}" }
            # メール認証を完全にスキップ → RESEND_API_KEY はそもそも不要（設定しない）
            - { name: backend.env.SKIP_EMAIL_VERIFICATION, value: "true" }
            # ここだけ必須: postgres は空だと chart が fail-fast（DB は実在）。使い捨てダミーでよい。
            - { name: postgresql.auth.password, value: "preview-only" }
            - { name: redis.auth.password,       value: "preview-only" }
            # 任意（削除可）: BETTER_AUTH_SECRET は未設定でも chart が自動生成する。
            # ただし randAlphaNum は render 毎に変わり ArgoCD が Secret を再同期→セッション
            # リセットになる。churn を避けたい場合だけ PR ごとの決定的ダミーを固定する。
            - { name: backend.secretEnv.BETTER_AUTH_SECRET, value: "preview-pr-{{ .number }}-not-a-secret" }
      destination:
        server: https://kubernetes.default.svc
        namespace: "preview-pr-{{ .number }}"
      syncPolicy:
        automated: { prune: true, selfHeal: true }
        syncOptions: ["CreateNamespace=true"]
```

要件・注意:
- **シークレット**: プレビューに**本番 secret は不要**。`SKIP_EMAIL_VERIFICATION=true` で
  メール送信をスキップするため `RESEND_API_KEY` は不要（コードが Resend を呼ぶ前に return）。
  `BETTER_AUTH_SECRET` は chart が自動生成するが churn 回避のため上記で決定的ダミーを固定。
  `postgresql.auth.password` だけは chart が fail-fast するのでダミー必須。
- **ドメインは単一階層サブドメイン必須**（例 `pr-105.youkan.uk`）。`pr-105.dev.youkan.uk` の
  ようなサブサブドメインは不可（`*.youkan.uk` の1階層しか TLS がカバーされない）。
  DNS/TLS は Cloudflare ingress 側で解決するため、別途ワイルドカード証明書の用意は不要。
- PR クローズで generator の対象から外れ、Application ごと自動削除される。
- **DB 隔離**: 上記は PR ごとに postgres を立てる（`postgresql.enabled` は values-dev 既定）。
  共有 PG に PR 別 DB 名を切る方式でも可。プレビュー終了で破棄する運用に。
- `<your-domain>` と `github-token`（repo read 権限）を GitOps 側で設定する。

## 3. 参考
- CI 定義: [.github/workflows/ci.yml](../.github/workflows/ci.yml)
- `preview` ラベルは GitHub のラベル管理で作成しておくこと。
