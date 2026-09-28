import { type MyAccount, registerSigningKey } from '@/lib/account/me';
import { createSigningKey, importSigningKeyBackup, loadSigningKey } from './keyStore';

export const KEY_BACKUP_FILENAME = 'ubichill-signing.key';

/** 秘密鍵のバックアップをファイルとして渡す（サーバーには送らない）。 */
export function downloadKeyBackup(pkcs8: string): void {
    const url = URL.createObjectURL(new Blob([`${pkcs8}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = KEY_BACKUP_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
}

export const REPLACE_KEY_MESSAGE =
    'アカウントには別の鍵が登録されています。このブラウザの鍵に置き換えると、以前の鍵で署名したワールドは作者表示が外れます（署名し直すと戻ります）。置き換えますか？';

/**
 * このブラウザの鍵をアカウントに登録する。別の鍵が登録済みなら置き換えの確認を取る。
 * 登録した（または登録済みだった）ら更新後のアカウントを、しなかったら null を返す。
 */
export async function registerLocalKey(
    account: MyAccount,
    confirmReplace: (message: string) => Promise<boolean>,
): Promise<MyAccount | null> {
    const key = await loadSigningKey();
    if (!key) return null;
    if (account.signingPublicKey === key.publicKey) return account;
    if (account.signingPublicKey && !(await confirmReplace(REPLACE_KEY_MESSAGE))) return null;
    await registerSigningKey(account.id, key);
    return { ...account, signingPublicKey: key.publicKey };
}

/** 新しい鍵を作り、バックアップを渡し、アカウントに登録する。 */
export async function createKeyWithBackup(
    account: MyAccount | null,
    confirmReplace: (message: string) => Promise<boolean>,
): Promise<MyAccount | null> {
    const { backup } = await createSigningKey();
    downloadKeyBackup(backup);
    return account ? registerLocalKey(account, confirmReplace) : null;
}

/** バックアップ（または `ubichill keygen` の鍵ファイル）を取り込み、アカウントに登録する。 */
export async function importKeyFile(
    file: File,
    account: MyAccount | null,
    confirmReplace: (message: string) => Promise<boolean>,
): Promise<MyAccount | null> {
    await importSigningKeyBackup(await file.text());
    return account ? registerLocalKey(account, confirmReplace) : null;
}
