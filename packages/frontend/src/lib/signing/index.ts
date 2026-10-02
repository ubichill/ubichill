/**
 * signing — 作者署名（鍵はブラウザだけが持つ。サーバーは検証・保存・配信のみ）。
 *
 * - keyStore        : 鍵の生成・取り込み・削除（IndexedDB、取り出し不可）
 * - publisher       : このブラウザを公開環境にして作者として署名する（ログインできる = 公開できる）
 * - saveHostedWorld : 定義・lock・署名の組を送って保存する（新規・更新・下書きは同じ呼び出し）
 * - signHostedWorld : 公開中の版に署名し直す
 * - entryGate       : 未署名ワールドへの入室確認
 * - useSigningKey   : React フック
 */

export { authorSignerFor } from './browserPublisher';
export {
    acceptEntry,
    type EntryAcceptanceStore,
    hasAcceptedEntry,
    unverifiedEntryKey,
    unverifiedEntryMessage,
} from './entryGate';
export { createSigningKey, importSigningKeyFile, loadSigningKey, removeSigningKey } from './keyStore';
export { type PublishReadiness, publishReadiness } from './publishReadiness';
export { browserFetch, type SavedWorld, saveWorldBundle, type WorldSaveBody } from './saveHostedWorld';
export type { WorldSigner } from './signer';
export { signHostedWorld } from './signHostedWorld';
export { useSigningPublicKey } from './useSigningKey';
