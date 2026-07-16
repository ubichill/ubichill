import { UbiSDK } from '@ubichill/sdk';
import {
    CommandType,
    checkProtocolCompatibility,
    HostEventType,
    type ModGuestCommand,
    type ModHostEvent,
    PROTOCOL_VERSION,
} from '@ubichill/shared';

// IMPORTANT: Function コンストラクタを無効化する前に保存
const SafeFunction = Function;

const nullifyGlobals = (): ((cmd: ModGuestCommand) => void) => {
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

// UbiSDK を securePostMessage で初期化（グローバル無効化後に生成することで安全な送信経路を確保）
const Ubi = new UbiSDK(securePostMessage);

// \bFunction\s*\( — 単語境界を使うことで ZodFunction( / ProxyFunction( 等の誤検知を防ぐ
const DANGEROUS_PATTERNS = [/importScripts/, /eval\s*\(/, /\bFunction\s*\(/, /__proto__/, /prototype\s*\[/] as const;

function checkDangerousPatterns(code: string): void {
    for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(code)) {
            throw new Error(`[Sandbox セキュリティ] 禁止されたパターンが検出されました: ${pattern.source}`);
        }
    }
}

self.addEventListener('message', (e: MessageEvent<ModHostEvent>) => {
    const event = e.data;

    if (event.type !== HostEventType.EVT_LIFECYCLE_INIT) {
        Ubi._dispatchEvent(event);
        return;
    }

    Ubi.worldId = event.payload.worldId;
    Ubi.myUserId = event.payload.myUserId;
    Ubi.componentInstanceId = event.payload.componentInstanceId;
    Ubi.entityId = event.payload.entityId;
    Ubi.componentType = event.payload.componentType;
    Ubi.modBase = event.payload.modBase ?? '';
    Ubi.watchEntityTypes = event.payload.watchEntityTypes ?? [];
    // state.define がmodコード実行前にこのスナップショットを同期反映する
    Ubi._setInitialEntities(event.payload.initialEntities ?? []);

    const modId = event.payload.modId ?? event.payload.worldId ?? 'unknown';
    Ubi.modId = modId;

    // Host が古すぎて mod が使う機能を欠く恐れがあれば、mod 開発者にログで知らせる。
    const compat = checkProtocolCompatibility(event.payload.protocolVersion ?? 0, PROTOCOL_VERSION);
    if (compat.level !== 'ok' && compat.message) {
        Ubi.log(compat.message, compat.level === 'incompatible' ? 'error' : 'warn');
    }

    try {
        // SECURITY NOTE: 本番環境では静的解析・コード署名・CSP・将来的に QuickJS+WASM への移行を推奨
        checkDangerousPatterns(event.payload.code);

        // modの console.log 等を Ubi.log へリダイレクト（グローバル console をシャドウ）
        const _modConsole = {
            log: (...args: unknown[]) => Ubi.log(args.map(String).join(' '), 'info'),
            info: (...args: unknown[]) => Ubi.log(args.map(String).join(' '), 'info'),
            warn: (...args: unknown[]) => Ubi.log(args.map(String).join(' '), 'warn'),
            error: (...args: unknown[]) => Ubi.log(args.map(String).join(' '), 'error'),
            debug: (...args: unknown[]) => Ubi.log(args.map(String).join(' '), 'debug'),
        };

        const modFn = new SafeFunction(
            'Ubi',
            'console',
            `"use strict";
            try {
                ${event.payload.code}
            } catch (err) {
                console.error("[Sandbox:${modId}] mod実行エラー", err);
                throw err;
            }`,
        );

        modFn(Ubi, _modConsole);

        // ACK: 初期化完了を Host に通知 → Host がキューをフラッシュする
        securePostMessage({ type: CommandType.CMD_READY, payload: { protocolVersion: PROTOCOL_VERSION } });

        console.log(`[Sandbox:${modId}] 初期化完了`);
    } catch (error) {
        console.error(`[Sandbox:${modId}] 初期化失敗:`, error);
        // Host にも失敗を通知 → markReady (ロード完了扱い) でローディング表示が止まらないように。
        // 失敗した mod は機能しないが、他のエンティティの描画は阻害しない方針 (graceful degradation)。
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        securePostMessage({ type: CommandType.CMD_INIT_FAILED, payload: { error: message } });
    }
});
