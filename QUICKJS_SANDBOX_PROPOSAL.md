# QuickJS + WASM サンドボックス実装提案

## 概要

現在の `Function` コンストラクタベースのサンドボックスから、QuickJS + WASM ベースのより安全なサンドボックスへ移行する提案です。

## 現在の問題点

1. **Function コンストラクタのリスク**: `new Function()` は eval と同等のリスクがあります
2. **グローバル汚染**: プロトタイプチェーンやグローバルオブジェクトへのアクセスを完全には防げません
3. **リソース制限の甘さ**: メモリや CPU 時間の制限が緩いです
4. **同一オリジンの制約**: Web Worker は同一オリジンで動作するため、隔離が不完全です

## QuickJS + WASM の利点

### 1. 完全な隔離

```
┌─────────────────────────────────────────┐
│ Host (Browser Main Thread)              │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ Web Worker                         │ │
│  │                                    │ │
│  │  ┌──────────────────────────────┐ │ │
│  │  │ WASM (QuickJS Engine)        │ │ │
│  │  │                              │ │ │
│  │  │  Plugin Code が実行される   │ │ │
│  │  │  ↑ここで eval/Function OK   │ │ │
│  │  │  でも外には出られない       │ │ │
│  │  └──────────────────────────────┘ │ │
│  │         ↑ Message Passing のみ    │ │
│  └────────────────────────────────────┘ │
│              ↑ Ubi API のみ             │
└─────────────────────────────────────────┘
```

### 2. 厳密なリソース制限

- **メモリ**: WASM のヒープサイズを厳密に制限
- **CPU**: 実行ステップ数をカウントして中断可能
- **I/O**: 完全にブロック（Ubi API 経由のみ許可）

### 3. セキュリティの多層防御

```typescript
// Layer 1: WASM による隔離
// - プラグインコードは WASM 内でのみ実行
// - ホスト環境へのアクセス不可

// Layer 2: QuickJS のサンドボックス機能
// - グローバルオブジェクトのカスタマイズ
// - 危険な機能の無効化

// Layer 3: Ubi API のホワイトリスト
// - 許可された操作のみ実行可能
// - すべての操作をログ記録
```

## 実装プラン

### Phase 1: QuickJS-WASM の統合

```bash
npm install quickjs-emscripten
```

```typescript
// packages/sdk/src/plugin/quickjs.worker.ts
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten';

const QuickJS = await newQuickJSWASMModuleFromVariant(
    newVariant({
        wasmSourceUrl: '/quickjs.wasm',
        wasmMemoryMB: 100, // 最大100MBに制限
    })
);

const vm = QuickJS.newContext();

// Ubi API を注入
const ubiHandle = vm.newObject();
vm.setProp(vm.global, 'Ubi', ubiHandle);

// onTick などの API を追加
const onTickHandle = vm.newFunction('onTick', (callbackHandle) => {
    // コールバックを保存して、TICK イベント時に実行
});
vm.setProp(ubiHandle, 'onTick', onTickHandle);

// プラグインコードを評価
vm.evalCode(pluginCode);
```

### Phase 2: リソース制限の実装

```typescript
// CPU 時間制限
vm.runtime.setInterruptHandler(() => {
    const elapsed = Date.now() - startTime;
    if (elapsed > maxExecutionTime) {
        return true; // 実行を中断
    }
    return false;
});

// メモリ制限（WASM レベルで制限済み）
vm.runtime.setMemoryLimit(100 * 1024 * 1024); // 100MB
```

### Phase 3: Ubi API の移植

```typescript
class QuickJSUbiSDK {
    constructor(private vm: QuickJSContext) {}

    // onTick の実装
    createOnTick() {
        return this.vm.newFunction('onTick', (callbackHandle) => {
            this.tickCallbacks.push({
                handle: callbackHandle,
                call: (deltaTime: number) => {
                    const dtHandle = this.vm.newNumber(deltaTime);
                    this.vm.callFunction(callbackHandle, this.vm.undefined, dtHandle);
                    dtHandle.dispose();
                },
            });
        });
    }

    // scene.updateCursorPosition の実装
    createUpdateCursorPosition() {
        return this.vm.newFunction('updateCursorPosition', (xHandle, yHandle) => {
            const x = this.vm.getNumber(xHandle);
            const y = this.vm.getNumber(yHandle);

            // Host へメッセージを送信
            self.postMessage({
                type: 'SCENE_UPDATE_CURSOR',
                payload: { x, y },
            });
        });
    }
}
```

### Phase 4: 移行戦略

1. **並行運用**: 既存の Function ベースと QuickJS ベースを両方サポート
2. **段階的移行**: 新規プラグインから QuickJS を使用
3. **互換性レイヤー**: 既存プラグインコードを自動変換

```typescript
// usePluginWorker に engine オプションを追加
usePluginWorker({
    pluginCode,
    engine: 'quickjs', // 'function' | 'quickjs'
    onCommand,
});
```

## セキュリティ上の改善点

### Before (現在)

```typescript
// ❌ Function コンストラクタは危険
new Function('Ubi', pluginCode)(Ubi);

// ❌ プロトタイプ汚染のリスク
Object.freeze(Object.prototype); // 不完全
```

### After (QuickJS)

```typescript
// ✅ WASM 内で完全に隔離
vm.evalCode(pluginCode);

// ✅ グローバルオブジェクトを完全に制御
const cleanGlobal = vm.newObject();
vm.setProp(vm.global, 'Ubi', ubiHandle);
// 他のグローバルは一切存在しない
```

## パフォーマンス考慮

- **初期化コスト**: QuickJS の初期化は少し遅いが、初回のみ
- **実行速度**: QuickJS は V8 より遅いが、プラグインの規模では十分
- **メモリ**: WASM のオーバーヘッドはあるが、制限を厳密に設定できる

## 代替案: QuickJS 以外の選択肢

### 1. Duktape

- より軽量
- WASM 版がある
- ES5 のみサポート（ES6 は部分的）

### 2. Hermes

- React Native で使われている
- モバイル向けに最適化
- WASM 版は実験的

### 3. Boa

- Rust 製の JavaScript エンジン
- WASM への変換が可能
- まだ開発中

## 推奨: QuickJS

理由:
- ✅ ES2020 サポート
- ✅ 成熟したプロジェクト
- ✅ WASM 版が安定している
- ✅ quickjs-emscripten が便利
- ✅ 小さいフットプリント（~1MB）

## 実装スケジュール案

### Week 1-2: 調査とプロトタイプ
- QuickJS の動作確認
- 簡単なプラグインでテスト
- パフォーマンス測定

### Week 3-4: Ubi API の移植
- すべての API を QuickJS 版に移植
- テストケースの作成
- ドキュメント更新

### Week 5-6: 統合とテスト
- 既存プラグインの動作確認
- セキュリティテスト
- パフォーマンスチューニング

### Week 7-8: 移行と監視
- プロダクションでの段階的ロールアウト
- 問題の監視と修正
- フィードバックの収集

## 参考リンク

- [QuickJS 公式サイト](https://bellard.org/quickjs/)
- [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten)
- [WASM サンドボックスのベストプラクティス](https://webassembly.org/docs/security/)

## まとめ

QuickJS + WASM への移行により:
- ✅ セキュリティが大幅に向上
- ✅ リソース制限が厳密になる
- ✅ プラグイン開発者の自由度は維持（eval/Function が使える）
- ✅ 将来的な拡張性が向上

移行コストはありますが、長期的には必須の改善です。
