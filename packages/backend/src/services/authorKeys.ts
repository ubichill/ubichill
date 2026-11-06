/**
 * このサーバーの作者アカウント（domain は PUBLIC_BASE_URL のホスト）。作者の確認の規則は
 * @ubichill/shared の authorKeyDirectory（ブラウザの Host と同じ規則）、DB・safeFetch を注入した実体は authorKeyStore.ts。
 */
import { ENV_KEYS, formatAuthorAccount, SERVER_CONFIG, type SigningKeyEntry } from '@ubichill/shared';

/** このサーバーが発行する作者アカウントの domain（ホスト名、開発時はポート付き）。 */
export function selfDomain(): string {
    const base = process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL;
    return new URL(base).host.toLowerCase();
}

export function selfAccount(handle: string): string {
    return formatAuthorAccount({ handle, domain: selfDomain() });
}

/** 保存済みの他サーバーの鍵 1 件（db の RemoteAuthorKeyRecord と同じ形）。 */
export interface StoredRemoteKey {
    publicKey: string;
    createdAt: Date;
    revokedAt: Date | null;
    /** 同じ鍵が自サーバーの公開環境にある。 */
    claimsLocalKey: boolean;
}

/**
 * 他サーバーの作者の保存済みの鍵を、作者の確認（shared の authorKeyDirectory）に渡す形にする。
 * 自サーバーの公開環境と同じ鍵を名乗る鍵は、なりすましの試みとして取り消し扱いにする（署名の確認で使わない。
 * 一覧から外すと「知らない鍵」になり、確認のたびに作者のサーバーへ取り直しに行くので、外さずに取り消しにする）。
 */
export function remoteKeyEntriesOf(keys: readonly StoredRemoteKey[], fetchedAt: Date): SigningKeyEntry[] {
    return keys.map((key) => {
        const revokedAt = key.revokedAt ?? (key.claimsLocalKey ? fetchedAt : null);
        return {
            publicKey: key.publicKey,
            addedAt: key.createdAt.toISOString(),
            ...(revokedAt ? { revokedAt: revokedAt.toISOString() } : {}),
        };
    });
}

/** 他サーバーが自サーバーの公開環境の鍵を名乗ってきたときの警告（無ければ undefined）。 */
export function claimedLocalKeysWarning(account: string, publicKeys: readonly string[]): string | undefined {
    if (publicKeys.length === 0) return undefined;
    return `⚠️ 他サーバーの作者 ${account} が、このサーバーの公開環境の鍵を名乗っています（署名の確認では使いません）: ${publicKeys.join(', ')}`;
}
