import type { MyAccount } from '@/lib/account/me';

/**
 * 保存しようとしているワールドを公開できるか。公開には作者アカウントでの署名が要る。
 * 鍵の用意と公開環境の登録は公開時に自動で行うので、利用者に求めるのは ID だけ。
 * - unpinned: lock に固定できない mod がある。署名は無効になるので公開できない（先に判定）。
 * - no-account: アカウント情報を取得できない（公開できない）。
 * - needs-handle: ID が未設定。公開ダイアログでその場で決めてもらう。
 * - ready: そのまま公開できる。
 */
export type PublishReadiness =
    | { kind: 'ready'; account: MyAccount }
    | { kind: 'unpinned'; mods: string[] }
    | { kind: 'no-account' }
    | { kind: 'needs-handle'; account: MyAccount };

export function publishReadiness(account: MyAccount | null, unpinned: readonly string[]): PublishReadiness {
    if (unpinned.length > 0) return { kind: 'unpinned', mods: [...unpinned] };
    if (!account) return { kind: 'no-account' };
    return account.author ? { kind: 'ready', account } : { kind: 'needs-handle', account };
}
