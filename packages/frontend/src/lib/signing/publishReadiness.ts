import type { WorldSigningKey } from '@ubichill/shared';
import type { MyAccount } from '@/lib/account/me';
import { signerFor, type WorldSigner } from './signer';

/**
 * 保存しようとしているワールドを公開（作者署名）できるか。
 * - unpinned: lock に固定できない mod がある。署名は無効になるので鍵があっても公開できない（先に判定）。
 * - needs-key: このブラウザに鍵が無い。公開するにはその場で鍵を用意する必要がある。
 * - ready: そのまま署名して公開できる。
 */
export type PublishReadiness =
    | { kind: 'ready'; signer: WorldSigner }
    | { kind: 'needs-key' }
    | { kind: 'unpinned'; mods: string[] };

export function publishReadiness(
    key: WorldSigningKey | null,
    account: Pick<MyAccount, 'author' | 'signingPublicKey'> | null,
    unpinned: readonly string[],
): PublishReadiness {
    if (unpinned.length > 0) return { kind: 'unpinned', mods: [...unpinned] };
    const signer = signerFor(key, account);
    return signer ? { kind: 'ready', signer } : { kind: 'needs-key' };
}
