// ============================================
// Sandbox Worker エンジン
//
// プラグインのコードを安全に評価・実行する汎用 Worker です。
// プラグインには `Ubi` オブジェクトと `UbiBehaviour` クラスが注入されます。
//
// 【通信プロトコル】
//   Host → Guest: EVT_LIFECYCLE_INIT, EVT_LIFECYCLE_TICK, EVT_PLAYER_JOINED など
//   Guest → Host: SCENE_GET_ENTITY (RPC), SCENE_UPDATE_CURSOR (Fire & Forget) など
//   Guest → Host: CMD_READY (初期化完了通知)
// ============================================

import type { PluginGuestCommand, PluginHostEvent } from '../index';
import { UbiBehaviour } from './component';
import { UbiSDK } from './UbiSDK';

// ============================================
// 1. SDK インスタンスの初期化
// ============================================
const Ubi = new UbiSDK();

// ============================================
// 2. セキュリティ: 危険なグローバル変数を無効化
// ============================================

// IMPORTANT: Function コンストラクタを無効化する前に保存
// プラグインコード評価のために内部的に使用する
const SafeFunction = Function;

const nullifyGlobals = (): ((cmd: PluginGuestCommand) => void) => {
    const dangerousGlobals = [
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'EventSource',
        'indexedDB',
        'localStorage',
        'sessionStorage',
        'Worker',
        'SharedWorker',
        'navigator',
        'importScripts', // CRITICAL: 外部スクリプト読み込みを防止
        'eval', // CRITICAL: eval を明示的にブロック
        'Function', // CRITICAL: new Function() を防止（内部的には SafeFunction を使用）
    ];

    for (const glob of dangerousGlobals) {
        if (glob in self) {
            try {
                Object.defineProperty(self, glob, { value: undefined, writable: false, configurable: false });
            } catch (_e) {
                console.warn(`[Sandbox] グローバルの無効化に失敗しました: ${glob}`);
            }
        }
    }

    // プロトタイプチェーンのバイパスを防ぐ
    try {
        Object.freeze(Object.prototype);
        Object.freeze(Array.prototype);
        Object.freeze(String.prototype);
        Object.freeze(Number.prototype);
        Object.freeze(Boolean.prototype);
    } catch (_e) {
        console.warn('[Sandbox] プロトタイプのフリーズに失敗しました');
    }

    const originalPostMessage = self.postMessage.bind(self);
    Object.defineProperty(self, 'postMessage', {
        value: () => {
            console.warn('[Sandbox] postMessage の直接呼び出しは禁止されています。Ubi API を使用してください。');
        },
        writable: false,
        configurable: false,
    });

    return originalPostMessage;
};

const securePostMessage = nullifyGlobals();

// セキュリティ設定後に Ubi の postMessage を差し替える
Ubi._postMessage = (command: PluginGuestCommand) => {
    securePostMessage(command);
};

// ============================================
// 3. 危険なパターンの検出
// ============================================

const DANGEROUS_PATTERNS = [
    /importScripts/,
    /eval\s*\(/,
    /Function\s*\(/,
    /constructor\s*\(/,
    /__proto__/,
    /prototype\s*\[/,
] as const;

function checkDangerousPatterns(code: string): void {
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(code)) {
            throw new Error(`[Sandbox セキュリティ] 禁止されたパターンが検出されました: ${pattern.source}`);
        }
    }
}

// ============================================
// 4. メッセージリスナー
// ============================================

self.addEventListener('message', (e: MessageEvent<PluginHostEvent>) => {
    const event = e.data;

    if (event.type !== 'EVT_LIFECYCLE_INIT') {
        // TICK, PLAYER_JOINED 等を UbiSDK に転送
        Ubi._dispatchEvent(event);
        return;
    }

    // --- EVT_LIFECYCLE_INIT: プラグインコードを実行 ---
    Ubi.worldId = event.payload.worldId;
    Ubi.myUserId = event.payload.myUserId;

    const pluginId = event.payload.pluginId ?? event.payload.worldId ?? 'unknown';
    Ubi.pluginId = pluginId;

    try {
        // SECURITY NOTE: new Function() は eval() と同等のリスクがあるため、
        // 本番環境では以下の対策を推奨:
        //   1. プラグインコードの事前検証（静的解析）
        //   2. コード署名の検証
        //   3. ホワイトリスト化されたプラグインのみ許可
        //   4. CSP (Content Security Policy) の適用
        //   5. 将来的には QuickJS + WASM によるサンドボックスへ移行
        checkDangerousPatterns(event.payload.code);

        // プラグインコードを `Ubi`, `UbiBehaviour` を引数に持つ関数として評価
        const pluginFn = new SafeFunction(
            'Ubi',
            'UbiBehaviour',
            `"use strict";
try {
    ${event.payload.code}
} catch (err) {
    console.error("[Sandbox プラグイン実行エラー (ID: ${pluginId})]", err);
    throw err;
}`,
        );

        pluginFn(Ubi, UbiBehaviour);

        // ★ ACK: 初期化完了を Host に通知
        // Host はこれを受信してイベントキューをフラッシュする
        securePostMessage({ type: 'CMD_READY' });

        console.log(`[Sandbox] プラグインが正常に初期化されました (ID: ${pluginId})`);
    } catch (error) {
        console.error('[Sandbox] プラグインコードの初期化に失敗しました:', error);
        // 失敗時は CMD_READY を送らないので、Host のキューはフラッシュされない
    }
});
