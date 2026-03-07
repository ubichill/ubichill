// ============================================
// guest.ts — UbiSDK のシングルトンエクスポート
//
// Worker 外（テスト・ES モジュール利用）で SDK を直接 import する場合に使います。
// Sandbox 内では sandbox.worker.ts が `Ubi` を注入するため、このファイルは不要です。
//
// @example
// ```ts
// import { Ubi } from '@ubichill/sdk';
//
// Ubi.onTick((dt) => { ... });
// await Ubi.scene.updateEntity('id', { transform: { x: 100 } });
// Ubi.messaging.send('MY_EVENT', { foo: 'bar' });
// ```
// ============================================

export { UbiBehaviour } from './component';
export { UbiSDK } from './UbiSDK';

import { UbiSDK } from './UbiSDK';

/** プラグイン開発者向けシングルトン（Worker 外での利用） */
export const ubichill = new UbiSDK();

/** `ubichill` の推奨エイリアス */
export const Ubi = ubichill;
