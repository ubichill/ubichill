import { UbiSDK } from '@ubichill/sdk';
import {
    CommandType,
    checkProtocolCompatibility,
    HostEventType,
    MOD_EXPORTS_GLOBAL_NAME,
    type ModGuestCommand,
    type ModHostEvent,
    PROTOCOL_VERSION,
} from '@ubichill/shared';
import { currentFunctionPrototypes, findLockdownLeaks, lockdownGlobalScope } from './lockdown';

// 封鎖より前に退避する。mod コードの評価はこの参照だけが行う。
const SafeFunction = Function;
const securePostMessage = self.postMessage.bind(self) as (cmd: ModGuestCommand) => void;
const functionPrototypes = currentFunctionPrototypes();

const lockdownError = ((): string | null => {
    try {
        lockdownGlobalScope(self, {
            postMessageStub: () => {
                console.warn('[Sandbox] postMessage の直接呼び出しは禁止されています。Ubi API を使用してください。');
            },
            functionPrototypes,
        });
        Object.freeze(Object.prototype);
        Object.freeze(Array.prototype);
        Object.freeze(String.prototype);
        Object.freeze(Number.prototype);
        Object.freeze(Boolean.prototype);
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    const leaks = findLockdownLeaks(self, functionPrototypes);
    return leaks.length > 0 ? `封鎖できなかった入口: ${leaks.join(', ')}` : null;
})();

const Ubi = new UbiSDK(securePostMessage);

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
    Ubi.hasCoarsePointer = event.payload.hasCoarsePointer ?? false;
    Ubi._setHostProtocolVersion(event.payload.protocolVersion ?? 0);
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
        // 封鎖に失敗した環境では mod を実行しない（fail closed）。
        if (lockdownError) throw new Error(`[Sandbox] グローバルの封鎖に失敗しました: ${lockdownError}`);

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
                if (typeof ${MOD_EXPORTS_GLOBAL_NAME} !== "undefined" && ${MOD_EXPORTS_GLOBAL_NAME} && typeof ${MOD_EXPORTS_GLOBAL_NAME}.default === "function") {
                    Ubi.ui.render(${MOD_EXPORTS_GLOBAL_NAME}.default, "default");
                }
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
