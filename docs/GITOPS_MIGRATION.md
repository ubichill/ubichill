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
          # values-dev.yaml をベースに使う。これで NODE_ENV=development / CORS_ORIGIN="*"
          # （better-auth は "*" を全オリジン許可として扱う）/ TRUST_PROXY / BETTER_AUTH_SECRET /
          # pluginBackends(video-player) / worlds レジストリ まで揃う。
          valueFiles: ["values-dev.yaml"]
          # per-PR で上書きが要るのは「環境ごとに変わる値」だけ。
          parameters:
            # ★ 単一階層サブドメイン必須（サブサブドメイン pr-N.dev.<domain> は TLS 不可）
            - { name: global.domain,     value: "pr-{{ .number }}.<your-domain>" }
            # values-dev は :latest。PR のイメージに差し替える
            - { name: backend.image.tag,  value: "pr-{{ .number }}" }
            - { name: frontend.image.tag, value: "pr-{{ .number }}" }
            - { name: pluginBackends[0].image.tag, value: "pr-{{ .number }}" }
            # postgres パスワードは設定不要: bitnami が生成した <release>-postgresql Secret を
            # backend / migrate init container が runtime に読む（平文 password / fail-fast は廃止済み）。
            # preview の DB は完全 ephemeral に（既定は 10Gi PVC）。PR クローズ後の孤児 PVC を防ぎ
            # フットプリントも削減。データはプレビュー終了で消えてよい。
            - { name: postgresql.primary.persistence.enabled, value: "false" }
            # 任意: 登録(sign-up)もテストするなら。values-dev は SKIP を持たず RESEND がダミーキーの
            # ため、これが無いと OTP メール送信で登録が失敗する。ログインだけなら不要。
            - { name: backend.env.SKIP_EMAIL_VERIFICATION, value: "true" }
      destination:
        server: https://kubernetes.default.svc
        namespace: "preview-pr-{{ .number }}"
      syncPolicy:
        automated: { prune: true, selfHeal: true }
        syncOptions: ["CreateNamespace=true"]
```

要件・注意:
- **`/api/version` が `environment:"production"` を返す場合**は `values-dev.yaml` が読めていない
  （＝base の `NODE_ENV:"production"` のまま）サイン。`valueFiles: ["values-dev.yaml"]` が効いていれば
  `NODE_ENV:"development"` になり development 表示になる。
- **シークレット/オリジン**: values-dev がプレビュー向けに `CORS_ORIGIN:"*"`（better-auth は `"*"` を
  全オリジン許可として扱う→ `INVALID_ORIGIN` にならない）・`BETTER_AUTH_SECRET:"dev-secret-key"`・
  `RESEND_API_KEY:"dev-resend-key"` を持つため、**本番 secret は不要**。postgres パスワードも bitnami
  生成 Secret を runtime に読むので**設定不要**。per-PR で足すのは image tag / global.domain /
  （任意）`SKIP_EMAIL_VERIFICATION=true` くらい。
- **ドメインは単一階層サブドメイン必須**（例 `pr-105.ubichill.com`）。`pr-105.dev.ubichill.com` の
  ようなサブサブドメインは不可（`*.ubichill.com` の1階層しか TLS がカバーされない）。
  DNS/TLS は Cloudflare ingress 側で解決するため、別途ワイルドカード証明書の用意は不要。
- PR クローズで generator の対象から外れ、Application ごと自動削除される。
- **DB**: PR ごとに専用 postgres が namespace 内に立つ（`postgresql.enabled=true`）。スキーマは
  backend Pod の **migrate init container** が起動時に適用（`backend.migrate.enabled=false` で旧 Job は無効）。
  DATABASE_URL は release 名から namespace-local の `-postgresql` を指すので PR 間で完全隔離。
  **persistence は false に上書き**（ephemeral）して PR クローズ時の孤児 PVC を防ぐこと。
- `<your-domain>` と `github-token`（repo read 権限）を GitOps 側で設定する。

## 3. 参考
- CI 定義: [.github/workflows/ci.yml](../.github/workflows/ci.yml)
- `preview` ラベルは GitHub のラベル管理で作成しておくこと。
