/**
 * ユーザー検索の検索語の解釈。画面と API で同じ規則を使う。
 *
 * `@bob@other.example` のようにサーバーまで書いたものはアカウントの指定として扱う。
 * このサーバーのアカウントなら ID の完全一致で引き、ほかのサーバーのアカウントは
 * 連合のフレンド（#200）でそのサーバーに問い合わせて解決するので、ここでは種類だけ分ける。
 */
import type { UserWithFriendship } from './friends';
import { displayNameKey, formatAuthorAccount, parseAuthorAccount } from './handle';

export const USER_SEARCH_MAX_LENGTH = 50;

/** ID の前方一致に使える形（英小文字・数字・_）。3 文字未満でも途中まで打った ID として探す。 */
const HANDLE_PREFIX_PATTERN = /^[a-z0-9_]{1,30}$/;

export type UserSearchQuery =
    | { kind: 'empty' }
    | { kind: 'tooLong' }
    /** このサーバーのアカウント（`@handle@自分のドメイン`）。ID の完全一致で引く。 */
    | { kind: 'local'; handle: string }
    /** ほかのサーバーのアカウント（`handle@domain`）。 */
    | { kind: 'remote'; account: string }
    /** ID の前方一致（ID として成り立つ時だけ）と、表示名の一意キーの部分一致。 */
    | { kind: 'text'; handlePrefix: string | null; nameKey: string };

export function parseUserSearchQuery(input: string, localDomain: string): UserSearchQuery {
    const trimmed = input.trim();
    if (!trimmed) return { kind: 'empty' };
    if (Array.from(trimmed).length > USER_SEARCH_MAX_LENGTH) return { kind: 'tooLong' };

    // ID は英小文字だけなので、`@Bob@Other.example` と打っても同じアカウントとして扱う
    const account = trimmed.replace(/^@/, '').includes('@') ? parseAuthorAccount(trimmed.toLowerCase()) : null;
    if (account) {
        return account.domain === localDomain.toLowerCase()
            ? { kind: 'local', handle: account.handle }
            : { kind: 'remote', account: formatAuthorAccount(account) };
    }

    const text = trimmed.replace(/^@/, '');
    const nameKey = displayNameKey(text);
    if (!nameKey) return { kind: 'empty' };
    // 一意キーは NFKC と小文字化を済ませているので、全角で打った ID もそのまま前方一致に使える
    return { kind: 'text', handlePrefix: HANDLE_PREFIX_PATTERN.test(nameKey) ? nameKey : null, nameKey };
}

/** `GET /api/v1/social/users` の応答。 */
export interface UserSearchResponse {
    users: UserWithFriendship[];
    /**
     * ほかのサーバーのアカウントが指定された（`handle@domain`）。このサーバーの検索では見つからないので、
     * 画面は連合のフレンド（#200）に対応するまで、その旨を出す。
     */
    remoteAccount?: string;
}
