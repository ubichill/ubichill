/**
 * signing — 作者署名（鍵はブラウザだけが持つ。サーバーは検証・保存・配信のみ）。
 *
 * - keyStore        : 鍵の生成・取り込み・削除（IndexedDB、取り出し不可）
 * - publisher       : このブラウザを公開環境にして作者として署名する（ログインできる = 公開できる）
 * - signHostedWorld : 保存済みワールドの配信物に署名して送る
 * - saveHostedWorld : 保存と署名（更新は内容と署名を原子的に送る）
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
export { createHostedWorld, saveHostedDraft, updateHostedWorld, type WorldSaveBody } from './saveHostedWorld';
export type { WorldSigner } from './signer';
export { browserFetch, signHostedWorld } from './signHostedWorld';
export { useSigningPublicKey } from './useSigningKey';
