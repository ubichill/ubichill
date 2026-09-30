import type { WorldSigningKey } from '@ubichill/shared';
import type { MyAccount } from '@/lib/account/me';
import type { WorldSigner } from './signer';

/** revoked: 取り消し済みの鍵 / taken: 別のアカウントが登録している鍵（鍵ファイルの使い回しなど） */
export type KeyRegistrationResult = 'registered' | 'revoked' | 'taken';

export interface PublisherDeps {
    loadKey: (userId: string) => Promise<WorldSigningKey | null>;
    createKey: (userId: string) => Promise<WorldSigningKey>;
    removeKey: (userId: string) => Promise<void>;
    register: (userId: string, key: WorldSigningKey) => Promise<KeyRegistrationResult>;
}

/**
 * このブラウザを公開環境にして、作者アカウントで署名できる署名者を返す（ログインできる = 公開できる）。
 * 鍵が無ければ作り、アカウントに未登録なら登録する。このブラウザの鍵が使えないとき（取り消し済み・別のアカウントが
 * 登録済み）は捨てて作り直す（取り消した鍵は二度と有効にならず、他人の鍵で名乗ることもできない）。ID 未設定のアカウントでは作者を名乗れないので呼ばないこと。
 */
export async function ensureAuthorSigner(
    account: Pick<MyAccount, 'id' | 'author' | 'signingKeys'>,
    deps: PublisherDeps,
): Promise<WorldSigner & { author: string }> {
    const author = account.author;
    if (!author) throw new Error('作者アカウントの ID が未設定です');
    const key = (await deps.loadKey(account.id)) ?? (await deps.createKey(account.id));
    if (account.signingKeys.includes(key.publicKey)) return { key, author };
    if ((await deps.register(account.id, key)) === 'registered') return { key, author };

    await deps.removeKey(account.id);
    const fresh = await deps.createKey(account.id);
    if ((await deps.register(account.id, fresh)) !== 'registered') {
        throw new Error('このブラウザを公開環境として登録できませんでした');
    }
    return { key: fresh, author };
}
