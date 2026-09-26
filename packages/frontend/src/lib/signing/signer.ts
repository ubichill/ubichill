import type { WorldSigningKey } from '@ubichill/shared';
import type { MyAccount } from '@/lib/account/me';

/** 署名に使う鍵と、署名に載せる作者アカウント。 */
export interface WorldSigner {
    key: WorldSigningKey;
    /** 鍵がアカウントに登録済みのときだけ付ける（未登録の鍵で名乗っても作者表示されないため）。 */
    author?: string;
}

/**
 * このブラウザの鍵とアカウントから署名者を決める。鍵が無ければ null（署名なし）。
 * 鍵がアカウントの登録鍵と一致しないときは作者を名乗らず、鍵だけで署名する。
 */
export function signerFor(
    key: WorldSigningKey | null,
    account: Pick<MyAccount, 'author' | 'signingPublicKey'> | null,
): WorldSigner | null {
    if (!key) return null;
    const registered = account?.author && account.signingPublicKey === key.publicKey;
    return registered && account.author ? { key, author: account.author } : { key };
}
