import type { WorldSigningKey } from '@ubichill/shared';
import type { MyAccount } from '@/lib/account/me';
import { signerFor, type WorldSigner } from './signer';

/**
 * 保存しようとしているワールドを公開できるか。公開には作者アカウント（ID + 登録済みの鍵）での署名が要る。
 * - unpinned: lock に固定できない mod がある。署名は無効になるので公開できない（先に判定）。
 * - no-account: アカウント情報を取得できない（公開できない）。
 * - needs-setup: ID の設定・鍵の用意・鍵の登録のいずれかが足りない。公開ダイアログでその場で済ませる。
 * - ready: そのまま作者アカウント付きで署名して公開できる。
 */
export type PublishReadiness =
    | { kind: 'ready'; signer: WorldSigner }
    | { kind: 'unpinned'; mods: string[] }
    | { kind: 'no-account' }
    | { kind: 'needs-setup'; missingHandle: boolean; missingKey: boolean; keyUnregistered: boolean };

export function publishReadiness(
    key: WorldSigningKey | null,
    account: Pick<MyAccount, 'handle' | 'author' | 'signingPublicKey'> | null,
    unpinned: readonly string[],
): PublishReadiness {
    if (unpinned.length > 0) return { kind: 'unpinned', mods: [...unpinned] };
    if (!account) return { kind: 'no-account' };
    const signer = signerFor(key, account);
    if (signer?.author) return { kind: 'ready', signer };
    return {
        kind: 'needs-setup',
        missingHandle: !account.handle,
        missingKey: !key,
        keyUnregistered: !!key && account.signingPublicKey !== key.publicKey,
    };
}
