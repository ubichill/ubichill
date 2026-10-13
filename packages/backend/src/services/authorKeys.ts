/**
 * このサーバーの作者アカウント（domain は PUBLIC_BASE_URL のホスト）。作者の確認の規則は
 * @ubichill/shared の authorKeyDirectory（ブラウザの Host と同じ規則）、DB・safeFetch を注入した実体は authorKeyStore.ts。
 */
import { ENV_KEYS, formatAuthorAccount, SERVER_CONFIG } from '@ubichill/shared';

/** このサーバーが発行する作者アカウントの domain（ホスト名、開発時はポート付き）。 */
export function selfDomain(): string {
    const base = process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL;
    return new URL(base).host.toLowerCase();
}

export function selfAccount(handle: string): string {
    return formatAuthorAccount({ handle, domain: selfDomain() });
}
