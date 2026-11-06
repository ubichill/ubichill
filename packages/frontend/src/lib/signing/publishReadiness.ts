import type { MyAccount } from '@/lib/account/me';

/**
 * 保存しようとしているワールドを公開できるか。公開には作者アカウントでの署名が要る。
 * 鍵の用意と公開環境の登録は公開時に自動で行うので、利用者に求めるものは無い。
 * - unpinned: lock に固定できない mod がある。署名は無効になるので公開できない（先に判定）。
 * - no-account: アカウント情報を取得できない（公開できない）。
 * - ready: そのまま公開できる。
 */
export type PublishReadiness =
    | { kind: 'ready'; account: MyAccount }
    | { kind: 'unpinned'; mods: string[] }
    | { kind: 'no-account' };

export function publishReadiness(account: MyAccount | null, unpinned: readonly string[]): PublishReadiness {
    if (unpinned.length > 0) return { kind: 'unpinned', mods: [...unpinned] };
    return account ? { kind: 'ready', account } : { kind: 'no-account' };
}
