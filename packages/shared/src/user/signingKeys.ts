/**
 * 作者アカウントの公開環境（署名鍵）一覧の純粋な知識。
 *
 * 1 アカウントは公開環境（ブラウザ・CLI・CI）ごとに署名鍵を持つ。作者のサーバーはその一覧を公開し、
 * 取り消した鍵も `revokedAt` 付きで残す（消すと「取り消し」と「取得失敗」を区別できない）。
 * 取り消した鍵の署名は、いつ署名されたものでも作者を付けない（署名に信頼できる時刻が無いため）。
 */
import { z } from 'zod';
import { Ed25519PublicKeySchema } from '../schemas/worldIdentity.schema';
import { AuthorAccountSchema, parseAuthorAccount } from './handle';

/** WebFinger（JRD）の links で公開環境の鍵一覧へ案内する rel。 */
export const SIGNING_KEYS_WEBFINGER_REL = 'https://ubichill.com/ns/signing-keys';

export const PUBLISHING_ENVIRONMENT_KINDS = ['browser', 'cli', 'ci', 'legacy'] as const;
export type PublishingEnvironmentKind = (typeof PUBLISHING_ENVIRONMENT_KINDS)[number];

export const PUBLISHING_ENVIRONMENT_NAME_MAX_LENGTH = 80;

/**
 * 公開環境を取り消す理由。
 * - lost: 紛失・ブラウザのデータを消した（鍵は自分以外に渡っていない）
 * - compromised: 漏えい・心当たりのない環境（攻撃者がその鍵で署名した可能性がある）
 */
export const REVOKE_REASONS = ['lost', 'compromised'] as const;
export const RevokeReasonSchema = z.enum(REVOKE_REASONS);
export type RevokeReason = z.infer<typeof RevokeReasonSchema>;

export const PublishingEnvironmentNameSchema = z
    .string()
    .trim()
    .min(1)
    .max(PUBLISHING_ENVIRONMENT_NAME_MAX_LENGTH)
    .refine((v) => !/\p{Cc}/u.test(v), '制御文字は使えません');

export const SigningKeyEntrySchema = z.object({
    publicKey: Ed25519PublicKeySchema,
    addedAt: z.string().datetime().optional(),
    revokedAt: z.string().datetime().optional(),
});
export type SigningKeyEntry = z.infer<typeof SigningKeyEntrySchema>;

export const SigningKeyListSchema = z.object({
    account: AuthorAccountSchema,
    issuedAt: z.string().datetime(),
    keys: z.array(SigningKeyEntrySchema).max(1000),
});
export type SigningKeyList = z.infer<typeof SigningKeyListSchema>;

/** 署名鍵のアルゴリズム（今は ed25519 だけ）。 */
export const SIGNING_KEY_ALGORITHM = 'ed25519';

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const toBase64UrlChars = (text: string): string => text.replace(/\+/g, '-').replace(/\//g, '_');

/**
 * ed25519 公開鍵の書き方を 1 つに揃える。保存・照合の前に通す。読めなければ undefined。
 * `ed25519:` の接頭辞の有無、base64 / base64url、パディングの有無を受け、接頭辞無し・パディング無しの base64url を返す。
 *
 * 43 文字目の下位 2 bit は 32 byte に入らない余りで、復号する側（node・WebCrypto・Postgres の decode）は無視する。
 * {@link Ed25519PublicKeySchema} は文字の形しか見ないので、0 に揃えないと同じ鍵が 4 通りの文字列になり、一意の確認をすり抜ける。
 * DB のマイグレーション（0020_author_keys）が SQL で同じ規則を再現している。
 */
export function normalizeEd25519PublicKey(value: string): string | undefined {
    const body = value.startsWith('ed25519:') ? value.slice('ed25519:'.length) : value;
    const match = /^([A-Za-z0-9+/_-]{42})([A-Za-z0-9+/_-])=?$/.exec(body);
    if (!match) return undefined;
    const last = BASE64URL_ALPHABET.indexOf(toBase64UrlChars(match[2]));
    return `${toBase64UrlChars(match[1])}${BASE64URL_ALPHABET[last - (last % 4)]}`;
}

export type SigningKeyStatus = 'active' | 'revoked' | 'unknown';

/** 同じ鍵が複数あれば、どれか 1 つでも取り消されていれば取り消し扱い（取り消しは覆らない）。 */
export function signingKeyStatus(keys: readonly SigningKeyEntry[], publicKey: string): SigningKeyStatus {
    const matches = keys.filter((k) => k.publicKey === publicKey);
    if (matches.length === 0) return 'unknown';
    return matches.some((k) => k.revokedAt) ? 'revoked' : 'active';
}

export function activeSigningKeys(keys: readonly SigningKeyEntry[]): string[] {
    return [...new Set(keys.map((k) => k.publicKey))].filter((pk) => signingKeyStatus(keys, pk) === 'active');
}

/** 鍵一覧の文書を検証する。問い合わせたアカウント以外の一覧（すり替え）は採用しない。 */
export function parseSigningKeyList(raw: unknown, account: string): SigningKeyList | undefined {
    const parsed = SigningKeyListSchema.safeParse(raw);
    if (!parsed.success) return undefined;
    const expected = parseAuthorAccount(account);
    const actual = parseAuthorAccount(parsed.data.account);
    if (!expected || !actual || expected.handle !== actual.handle || expected.domain !== actual.domain) {
        return undefined;
    }
    return parsed.data;
}
