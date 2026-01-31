# Ubichill Platform Specification (v1alpha1)

> **Room-as-Code**: 宣言的なYAML定義とGitベースのバージョン管理で、ルーム・パッケージ・アバターを管理するエコシステム

---

## 目次

1. [概要](#1-概要-architecture-overview)
2. [CRD仕様 (静的定義)](#2-crd-specifications-static-definitions)
3. [API仕様 (動的ランタイム)](#3-api-specifications-dynamic-runtime)
4. [処理フロー](#4-処理フロー-workflow)
5. [改善案・設計上の考慮事項](#5-改善案設計上の考慮事項)
6. [懸念点とリスク](#6-懸念点とリスク)
7. [フェーズ別実装ロードマップ](#7-フェーズ別実装ロードマップ)
8. [用語集](#8-用語集)

---

## 1. 概要 (Architecture Overview)

本プラットフォームは、**静的な定義ファイル（YAML）** と **動的な実行状態（JSON）** を明確に分離します。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Definition Layer (Git)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Package.yaml │  │  Room.yaml   │  │ Avatar.yaml  │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼─────────────────┼─────────────────┼──────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Registry Service                             │
│  • YAMLパース & バリデーション                                   │
│  • 依存関係解決 (Dependency Resolution)                          │
│  • アセットURL解決                                               │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Runtime Layer (API)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Instance   │  │  WorldState  │  │    Users     │          │
│  │   (REST)     │  │  (Socket.io) │  │  (Socket.io) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

| レイヤー | 役割 | 管理方法 |
|----------|------|----------|
| **Definition Layer** | クリエイターが定義する「設計図」 | YAML/Git (Kubernetes CRDライク) |
| **Registry Service** | 定義の解決・キャッシュ | バックエンドサービス |
| **Runtime Layer** | システムが管理する「実体」 | JSON/REST API + WebSocket |

---

## 2. CRD Specifications (Static Definitions)

クリエイターが作成し、GitHub等で管理するファイル群です。

### 2.1 Package Definition (`package.yaml`)

新しいアイテム（Kind）や機能を定義するためのマニフェストです。

```yaml
apiVersion: ubichill.com/v1alpha1
kind: Package
metadata:
  name: sushi-set              # パッケージID (ユニーク、kebab-case)
  version: "1.0.0"             # SemVer
  author:
    name: "nasimonan"
    url: "https://github.com/nasimonan"
spec:
  displayName: "お寿司セット"
  description: "おいしいお寿司の画像と、食べると音がなる機能。"
  thumbnail: "./assets/thumb.png"  # 相対パス
  license: "MIT"                   # ライセンス情報

  # このパッケージが提供するKindのリスト
  kinds:
    - id: "tuna"                   # Kind ID (パッケージ内でユニーク)
      displayName: "マグロ"
      baseType: "ubichill-toy"     # システム標準機能を継承
      
      # フロントエンドに渡される初期パラメータ
      defaults:
        width: 100
        height: 60
        src: "./assets/tuna.png"
        animation: "bounce"
        sound: "./assets/eat.mp3"
        physics:
          restitution: 0.8
          
    - id: "salmon"
      displayName: "サーモン"
      baseType: "ubichill-toy"
      defaults:
        width: 100
        height: 60
        src: "./assets/salmon.png"
```

#### 標準 `baseType` 一覧

| baseType | 説明 | 必須プロパティ |
|----------|------|----------------|
| `ubichill-pen` | 描画ツール | `color`, `strokeWidth` |
| `ubichill-toy` | 画像オブジェクト | `src`, `width`, `height` |
| `ubichill-text` | テキストオブジェクト | `content`, `fontSize` |
| `ubichill-embed` | 埋め込み (YouTube等) | `embedUrl` |

---

### 2.2 Room Definition (`room.yaml`)

ワールドの構成を定義します。パッケージへの依存関係と初期配置を持ちます。

```yaml
apiVersion: ubichill.com/v1alpha1
kind: Room
metadata:
  name: hackathon-venue        # Room ID (ユニーク、kebab-case)
  version: "2.1.0"
  author:
    name: "Youkan"
spec:
  displayName: "技育ハッカソン会場"
  description: "開発合宿用の作業部屋。ホワイトボード完備。"
  thumbnail: "https://assets.ubichill.com/rooms/hackathon.png"

  # キャパシティ設定
  capacity:
    default: 10
    max: 20

  # 環境設定
  environment:
    backgroundColor: "#F0F8FF"
    backgroundImage: "https://assets.ubichill.com/rooms/grid.png"
    bgm: null
    worldSize:
      width: 2000
      height: 1500

  # 依存パッケージ
  dependencies:
    # 外部リポジトリからの読み込み（リポジトリ内パス指定可能）
    - name: "sushi-set"
      source:
        type: "git"
        url: "https://github.com/nasimonan/ubichill-sushi-set"
        ref: "v1.0.0"           # タグ/ブランチ/コミットハッシュ
        path: "packages/sushi"  # リポジトリ内のサブディレクトリ（省略時はルート）
    
    # 同一リポジトリ内のパッケージを参照
    - name: "whiteboard-tools"
      source:
        type: "local"           # ローカル参照
        path: "./packages/whiteboard-tools"  # 相対パス
    
    # 公式リポジトリからの読み込み
    - name: "official-pen"
      source:
        type: "git"
        url: "https://github.com/ubichill/official-tools"
        ref: "main"
        path: "pen"             # リポジトリ内の特定ディレクトリ

  # 初期配置エンティティ
  initialEntities:
    - kind: "sushi-set:tuna"
      transform: { x: 200, y: 300, z: 0, w: 100, h: 60, rotation: 0 }
      
    - kind: "whiteboard-tools:marker-red"
      transform: { x: 500, y: 300, z: 1, w: 30, h: 30, rotation: 0 }
      data:
        strokeWidth: 12        # デフォルト値を上書き

  # ルーム固有の権限設定 (オプション)
  permissions:
    allowGuestCreate: false    # ゲストによるエンティティ作成を許可するか
    allowGuestDelete: false
```

---

### 2.3 Avatar Definition (`avatar.yaml`)

ユーザーの見た目（カーソル）を定義します。

```yaml
apiVersion: ubichill.com/v1alpha1
kind: Avatar
metadata:
  name: cat-paw-style
  version: "1.0.0"
  author:
    name: "Designer A"
spec:
  displayName: "猫の手カーソル"
  description: "かわいい猫の手でクリック！"
  
  visuals:
    cursorImage: "./assets/paw.png"
    cursorSize: { width: 32, height: 32 }
    cursorOffset: { x: 16, y: 4 }   # ホットスポット
    
    # カーソルの軌跡エフェクト
    trail:
      enabled: true
      color: "#FFB6C1"
      length: 15
      decay: 0.9
      
    # クリック時のエフェクト
    clickEffect:
      type: "ripple"
      color: "#FFB6C1"
      duration: 300
```

---

## 3. API Specifications (Dynamic Runtime)

Webフロントエンドが叩く REST API の仕様です。

### 3.1 Data Models (JSON Schema)

#### `ResolvedRoom` Object

パースされたRoom定義（キャッシュされるもの）。

```typescript
interface ResolvedRoom {
  id: string;                    // "hackathon-venue"
  version: string;               // "2.1.0"
  displayName: string;
  description: string;
  thumbnail: string;             // 解決済みURL
  
  environment: {
    backgroundColor: string;
    backgroundImage: string | null;
    bgm: string | null;
    worldSize: { width: number; height: number };
  };
  
  capacity: {
    default: number;
    max: number;
  };
  
  // 解決済みのKindリスト
  availableKinds: ResolvedKind[];
  
  // 初期配置（Roomから継承）
  initialEntities: InitialEntityDef[];
}

interface ResolvedKind {
  id: string;                    // "sushi-set:tuna"
  displayName: string;
  baseType: string;
  icon: string;                  // 解決済みURL
  defaults: Record<string, unknown>;
}
```

#### `Instance` Object

現在稼働している「部屋の実体」。

```typescript
interface Instance {
  id: string;                    // "inst-uuid-1234"
  status: "active" | "full" | "closing";
  leaderId: string;              // 作成者のユーザーID
  createdAt: string;             // ISO 8601
  expiresAt: string | null;      // 有効期限（nullなら無期限）

  // 部屋のメタ情報
  room: {
    id: string;
    version: string;
    displayName: string;
    thumbnail: string;
  };

  // アクセス制御
  access: {
    type: "public" | "friend_plus" | "friend_only" | "invite_only";
    tags: string[];
    password: boolean;           // パスワード保護されているか
  };

  // リアルタイム状況
  stats: {
    currentUsers: number;
    maxUsers: number;
  };

  // 接続情報
  connection: {
    url: string;                 // "wss://api.ubichill.com"
    namespace: string;           // "/rooms/inst-uuid-1234"
  };
}
```

---

### 3.2 REST Endpoints

#### Room Templates

| Method | Endpoint | 説明 |
|--------|----------|------|
| `GET` | `/api/v1/rooms` | ルームテンプレート一覧 |
| `GET` | `/api/v1/rooms/:roomId` | ルームテンプレート詳細 |
| `POST` | `/api/v1/rooms/refresh` | テンプレートキャッシュを更新 |

#### Instances

| Method | Endpoint | 説明 |
|--------|----------|------|
| `GET` | `/api/v1/instances` | インスタンス一覧（ロビー） |
| `POST` | `/api/v1/instances` | インスタンス作成 |
| `GET` | `/api/v1/instances/:instanceId` | インスタンス詳細 |
| `DELETE` | `/api/v1/instances/:instanceId` | インスタンス終了 |

#### インスタンス作成リクエスト例

```typescript
// POST /api/v1/instances
{
  roomId: "hackathon-venue",
  access: {
    type: "friend_plus",
    tags: ["作業中", "初心者歓迎"],
    password: "optional-password"  // オプション
  },
  settings: {
    maxUsers: 15                   // ルーム上限以下で指定可能
  }
}
```

---

### 3.3 WebSocket Events (拡張)

既存のUEPイベントに加え、以下を追加します。

#### Server → Client

```typescript
interface ExtendedServerToClientEvents extends ServerToClientEvents {
  // ワールドスナップショット（拡張版）
  'world:snapshot': (payload: {
    entities: WorldEntity[];
    availableKinds: ResolvedKind[];   // ツールバー用
    environment: RoomEnvironment;      // 背景等
  }) => void;
  
  // インスタンス状態変更
  'instance:updated': (stats: { currentUsers: number }) => void;
  
  // ルーム終了通知
  'instance:closing': (reason: string) => void;
}
```

---

## 4. 処理フロー (Workflow)

### 4.1 Registration Flow (起動時/Webhook)

```
┌─────────┐     ┌───────────────┐     ┌──────────────┐
│  GitHub │────▶│ Registry Svc  │────▶│    Cache     │
│ Webhook │     │ (Fetch YAML)  │     │ (Redis/Mem)  │
└─────────┘     └───────────────┘     └──────────────┘
                       │
                       ▼
              ┌────────────────┐
              │ Validate &     │
              │ Resolve Assets │
              └────────────────┘
```

1. **トリガー**: GitHub Webhookまたは手動更新
2. **Fetch**: 登録済みリポジトリから YAML をクロール
3. **Resolve**: 
   - `dependencies` の Package YAML を再帰的にFetch
   - 相対パスを絶対URLに変換
   - バリデーション実行
4. **Cache**: 「ReadyなRoom定義」としてメモリ/Redisにキャッシュ

### 4.2 Instantiation Flow (ルーム作成時)

```
┌─────────┐     ┌───────────────┐     ┌──────────────┐
│  Client │────▶│  POST /inst   │────▶│   Instance   │
│   UI    │     │               │     │   Manager    │
└─────────┘     └───────────────┘     └──────────────┘
                                              │
                 ┌────────────────────────────┘
                 ▼
       ┌──────────────────┐
       │  Load from Cache │──▶ initialEntities を WorldState に展開
       └──────────────────┘
```

### 4.3 Join Flow (接続時)

```typescript
// クライアント接続時のペイロード
socket.emit('room:join', { 
  roomId: instanceId,    // Instance ID
  user: { name, ... }
});

// サーバーからのレスポンス
socket.on('world:snapshot', (payload) => {
  // payload.entities: 配置済みオブジェクト
  // payload.availableKinds: ツールバーに表示するボタン
  // payload.environment: 背景色、BGM等
});
```

---

## 5. 改善案・設計上の考慮事項

### 5.1 バージョニングとセマンティックバージョニング

**現状の問題**:
Room定義の`version`はあるが、依存解決時の互換性チェックがない。

**改善案**:
```yaml
dependencies:
  - name: "sushi-set"
    source:
      url: "..."
      ref: "^1.0.0"   # SemVer Range をサポート
```

### 5.2 Schema Validation & Security Verification

**目的**: Zod スキーマで厳密なバリデーションを行い、**悪意あるパッケージを検出・拒否**する。

#### 5.2.1 基本スキーマ定義

```typescript
// packages/shared/src/schemas/package.schema.ts
import { z } from 'zod';

// サイズ制限定数
export const PACKAGE_LIMITS = {
  MAX_YAML_SIZE: 100 * 1024,       // 100KB
  MAX_TOTAL_ASSETS_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_KINDS_PER_PACKAGE: 50,
  MAX_STRING_LENGTH: 1000,
  MAX_DEPENDENCY_DEPTH: 3,
} as const;

// 安全な文字列（スクリプト注入防止）
const SafeString = z.string()
  .max(PACKAGE_LIMITS.MAX_STRING_LENGTH)
  .refine((s) => !/<script/i.test(s), 'Script tags not allowed');

// 安全なURL（ホワイトリスト検証）
const SafeAssetUrl = z.string().refine((url) => {
  const allowedPatterns = [
    /^\.\//,                                    // 相対パス
    /^https:\/\/github\.com\//,                 // GitHub
    /^https:\/\/raw\.githubusercontent\.com\//,  // GitHub Raw
    /^https:\/\/assets\.ubichill\.com\//,        // 公式アセット
  ];
  return allowedPatterns.some(p => p.test(url));
}, 'Asset URL not in allowlist');

// Kind定義スキーマ
const KindSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'Kind ID must be kebab-case'),
  displayName: SafeString,
  baseType: z.enum(['ubichill-pen', 'ubichill-toy', 'ubichill-text', 'ubichill-embed']),
  defaults: z.record(z.unknown()).optional(),
});

// パッケージソース定義
const PackageSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('git'),
    url: z.string().url().startsWith('https://github.com/'),
    ref: z.string().max(100),
    path: z.string().max(200).optional(),  // リポジトリ内パス
  }),
  z.object({
    type: z.literal('local'),
    path: z.string().max(200).startsWith('./'),
  }),
]);

// パッケージ全体スキーマ
export const PackageSchema = z.object({
  apiVersion: z.literal('ubichill.com/v1alpha1'),
  kind: z.literal('Package'),
  metadata: z.object({
    name: z.string().regex(/^[a-z0-9-]+$/).max(50),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),  // SemVer
    author: z.object({
      name: SafeString,
      url: z.string().url().optional(),
    }),
  }),
  spec: z.object({
    displayName: SafeString,
    description: SafeString.optional(),
    thumbnail: SafeAssetUrl.optional(),
    license: z.string().max(50).optional(),
    kinds: z.array(KindSchema).max(PACKAGE_LIMITS.MAX_KINDS_PER_PACKAGE),
  }),
});

export type Package = z.infer<typeof PackageSchema>;
```

#### 5.2.2 検証フロー

```typescript
// packages/backend/src/services/packageValidator.ts
import yaml from 'yaml';
import { PackageSchema, PACKAGE_LIMITS } from '@ubichill/shared';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validatePackage(
  yamlContent: string,
  source: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. サイズチェック（YAML Bomb対策）
  if (yamlContent.length > PACKAGE_LIMITS.MAX_YAML_SIZE) {
    return { valid: false, errors: ['YAML exceeds size limit'], warnings };
  }

  // 2. YAMLパース（safeLoad相当）
  let parsed: unknown;
  try {
    parsed = yaml.parse(yamlContent, { maxAliasCount: 100 }); // Alias制限
  } catch (e) {
    return { valid: false, errors: [`YAML parse error: ${e}`], warnings };
  }

  // 3. Zodスキーマ検証
  const result = PackageSchema.safeParse(parsed);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      warnings,
    };
  }

  // 4. 追加のセキュリティチェック
  const pkg = result.data;
  
  // 循環参照チェック（将来的に依存関係グラフで検証）
  // ...

  return { valid: true, errors, warnings };
}
```

#### 5.2.3 セキュリティチェック項目

| チェック項目 | 目的 | 実装 |
|-------------|------|------|
| YAMLサイズ | YAML Bomb防止 | `MAX_YAML_SIZE: 100KB` |
| Alias上限 | 再帰爆発防止 | `maxAliasCount: 100` |
| URLホワイトリスト | XSS/フィッシング防止 | 正規表現マッチング |
| Script検出 | HTMLインジェクション防止 | 文字列検査 |
| 文字列長制限 | バッファオーバーフロー防止 | `MAX_STRING_LENGTH` |

### 5.3 アセット配信の最適化

**問題**: GitHubからの直接配信はレートリミットとパフォーマンスに問題がある。

**改善案**: CDN + アセットプロキシ

```
┌─────────┐     ┌───────────────┐     ┌──────────────┐
│  GitHub │────▶│ Asset Proxy   │────▶│     CDN      │
│   Raw   │     │ (Cache + Opt) │     │ (CloudFlare) │
└─────────┘     └───────────────┘     └──────────────┘
```

### 5.4 Namespace によるKind IDの衝突回避

**現状**: `sushi-set:tuna` のようにパッケージ名でプレフィックスする設計。

**改善案**: 公式パッケージ用の予約namespace

```yaml
# 公式パッケージ
kinds:
  - id: "@ubichill/pen"    # 予約プレフィックス

# コミュニティパッケージ  
kinds:
  - id: "nasimonan/sushi:tuna"
```

### 5.5 Hot Reload / Live Update

**将来の拡張**: 実行中のインスタンスに対してKind定義を更新

```typescript
// WebSocket Event
'kinds:updated': (updatedKinds: ResolvedKind[]) => void;
```

### 5.6 パッケージキャッシュ戦略 (LRU + Size Limit)

**目的**: GitHubへのリクエストを最小化し、高速なパッケージ読み込みを実現する。

#### 5.6.1 キャッシュ設計

```typescript
// packages/backend/src/services/packageCache.ts
import { LRUCache } from 'lru-cache';

export interface CachedPackage {
  id: string;                    // "author/package-name@v1.0.0"
  resolvedAt: number;            // タイムスタンプ
  expiresAt: number;             // TTL期限
  size: number;                  // バイトサイズ
  data: ResolvedPackage;         // 解決済みパッケージデータ
  assets: Map<string, Buffer>;   // アセットキャッシュ
}

export const CACHE_CONFIG = {
  // メモリ制限
  MAX_TOTAL_SIZE: 100 * 1024 * 1024,  // 100MB
  MAX_ITEMS: 500,                      // 最大500パッケージ
  
  // TTL設定
  DEFAULT_TTL: 60 * 60 * 1000,         // 1時間
  IMMUTABLE_TTL: 24 * 60 * 60 * 1000,  // タグ指定の場合は24時間
  
  // 単一パッケージ制限
  MAX_PACKAGE_SIZE: 5 * 1024 * 1024,   // 5MB/パッケージ
} as const;

// LRUキャッシュ初期化
export const packageCache = new LRUCache<string, CachedPackage>({
  max: CACHE_CONFIG.MAX_ITEMS,
  maxSize: CACHE_CONFIG.MAX_TOTAL_SIZE,
  
  // サイズ計算関数
  sizeCalculation: (value) => value.size,
  
  // TTL（time-to-live）
  ttl: CACHE_CONFIG.DEFAULT_TTL,
  
  // 削除時のクリーンアップ
  dispose: (value, key) => {
    console.log(`[Cache] Evicting: ${key} (${value.size} bytes)`);
  },
  
  // アクセス時にTTLを更新しない（純粋なLRU）
  updateAgeOnGet: false,
  updateAgeOnHas: false,
});
```

#### 5.6.2 キャッシュ戦略

```
┌─────────────────────────────────────────────────────────────┐
│                    Package Request                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Cache Lookup   │
                    │  (LRU Cache)    │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
        HIT (valid TTL)              MISS or EXPIRED
              │                             │
              ▼                             ▼
     ┌─────────────┐              ┌─────────────────┐
     │   Return    │              │   Fetch from    │
     │   Cached    │              │   GitHub/Local  │
     └─────────────┘              └────────┬────────┘
                                           │
                                           ▼
                                  ┌─────────────────┐
                                  │   Validate &    │
                                  │   Size Check    │
                                  └────────┬────────┘
                                           │
                              ┌────────────┴────────────┐
                              │                         │
                        Size OK                   Size EXCEEDED
                              │                         │
                              ▼                         ▼
                     ┌─────────────┐           ┌─────────────┐
                     │   Store in  │           │   Reject    │
                     │   Cache     │           │   Package   │
                     └─────────────┘           └─────────────┘
```

#### 5.6.3 キャッシュキー設計

```typescript
// キャッシュキーの生成
function getCacheKey(source: PackageSource): string {
  if (source.type === 'git') {
    // 不変参照（タグ/コミット）は長期キャッシュ
    const isImmutable = /^v?\d+\.\d+\.\d+$/.test(source.ref) || 
                        /^[a-f0-9]{40}$/.test(source.ref);
    const path = source.path || '';
    return `git:${source.url}:${source.ref}:${path}:${isImmutable ? 'immutable' : 'mutable'}`;
  } else {
    // ローカルパスは常に再読み込み（開発用）
    return `local:${source.path}:${Date.now()}`;
  }
}

// TTLの決定
function getTTL(cacheKey: string): number {
  if (cacheKey.includes(':immutable')) {
    return CACHE_CONFIG.IMMUTABLE_TTL;  // タグ: 24時間
  }
  return CACHE_CONFIG.DEFAULT_TTL;       // ブランチ: 1時間
}
```

#### 5.6.4 サイズ制限の適用

| 制限項目 | 値 | 目的 |
|----------|-----|------|
| `MAX_YAML_SIZE` | 100KB | YAML Bomb防止 |
| `MAX_PACKAGE_SIZE` | 5MB | 単一パッケージの肥大化防止 |
| `MAX_TOTAL_ASSETS_SIZE` | 10MB | アセット総量制限 |
| `MAX_TOTAL_CACHE_SIZE` | 100MB | メモリ使用量制限 |
| `MAX_CACHE_ITEMS` | 500 | エントリ数制限 |

#### 5.6.5 キャッシュ統計API

```typescript
// GET /api/v1/admin/cache/stats
interface CacheStats {
  totalItems: number;
  totalSize: number;           // bytes
  hitRate: number;             // 0-1
  evictionCount: number;
  oldestEntry: string | null;  // ISO timestamp
}

// POST /api/v1/admin/cache/clear
// POST /api/v1/admin/cache/warm?packageId=xxx  // プリウォーム
```

---

## 6. 懸念点とリスク

### 6.1 🔴 セキュリティ

| リスク | 影響 | 対策 |
|--------|------|------|
| 悪意あるYAML (YAML Bomb) | DoS | `yaml.safeLoad()` + サイズ制限 |
| 任意URLのアセット読み込み | XSS, フィッシング | ホワイトリストまたはプロキシ経由 |
| パッケージへの悪意あるコード注入 | RCE | サンドボックス実行（将来的にカスタムJS対応時） |

**推奨対策**:
```yaml
# 許可されたアセットソースのホワイトリスト
assetSources:
  - "https://github.com/*"
  - "https://assets.ubichill.com/*"
  - "https://cdn.jsdelivr.net/*"
```

### 6.2 🟡 パフォーマンス

| 懸念 | 詳細 | 対策 |
|------|------|------|
| 大量のエンティティ | initialEntitiesが1000個以上 | ページング/遅延読み込み |
| 依存関係の深いネスト | A→B→C→D... | 最大深度制限 (例: 3階層) |
| GitHubレートリミット | 頻繁なFetch | Redis キャッシュ (TTL: 1時間) |

### 6.3 🟡 運用面

| 懸念 | 詳細 | 対策 |
|------|------|------|
| 破壊的変更 | v2での互換性 | apiVersion で明示的にハンドリング |
| パッケージの削除 | 参照先が消える | ミラーリングまたは警告通知 |
| 作者の放棄 | メンテナンスされないパッケージ | 公式フォーク / アーカイブ機能 |

### 6.4 🟡 ユーザー体験

| 懸念 | 詳細 | 対策 |
|------|------|------|
| 初回ロード時間 | 依存解決に時間がかかる | プリフェッチ + ローディングUI |
| 部分的失敗 | 1つのパッケージ取得失敗 | Graceful degradation + 警告表示 |

---

## 7. フェーズ別実装ロードマップ

### Phase 1: Foundation (MVP)

- [ ] Room YAMLスキーマ定義
- [ ] 静的Room定義の読み込み（ローカルファイル）
- [ ] インスタンス管理API (`/api/v1/instances`)
- [ ] `world:snapshot` の拡張 (`availableKinds`)

### Phase 2: Package System

- [ ] Package YAMLスキーマ定義
- [ ] GitHubからのFetch機能
- [ ] 依存関係解決
- [ ] Registry Service実装

### Phase 3: Avatar & Customization

- [ ] Avatar YAMLスキーマ定義
- [ ] カスタムカーソル実装
- [ ] ユーザープロファイルとの連携

### Phase 4: Ecosystem

- [ ] パッケージマーケットプレイス
- [ ] バージョン管理 / 自動更新
- [ ] Webhook連携

---

## 8. 用語集

| 用語 | 説明 |
|------|------|
| **CRD** | Custom Resource Definition。Kubernetes由来の宣言的リソース定義形式 |
| **Kind** | エンティティの種類。`pen`, `tuna` など |
| **Package** | 複数のKindをまとめたプラグイン単位 |
| **Room** | ワールドの設計図。環境設定と初期配置を含む |
| **Instance** | Roomから生成された実行中の「部屋」 |
| **baseType** | Kind が継承するシステム標準機能 |
| **Registry** | YAMLをパース・キャッシュするサービス |

---

## 関連ドキュメント

- [Ubichill Entity Protocol (UEP)](./UEP.md) - リアルタイム同期プロトコル
