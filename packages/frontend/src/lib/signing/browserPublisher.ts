import { type MyAccount, registerSigningKey } from '@/lib/account/me';
import { createSigningKey, loadSigningKey, removeSigningKey } from './keyStore';
import { ensureAuthorSigner, type PublisherDeps } from './publisher';

const browserPublisherDeps: PublisherDeps = {
    loadKey: loadSigningKey,
    createKey: createSigningKey,
    removeKey: removeSigningKey,
    register: registerSigningKey,
};

/** このブラウザで作者アカウントとして署名する署名者（鍵の用意と公開環境の登録を自動で行う）。 */
export function authorSignerFor(account: Pick<MyAccount, 'id' | 'author' | 'signingKeys'>) {
    return ensureAuthorSigner(account, browserPublisherDeps);
}
