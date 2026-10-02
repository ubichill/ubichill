/**
 * CLI・CI の認可（`ubichill login` / `ubichill ci create`）の、サーバーと CLI で共有する純粋な知識。
 * 手順は docs/design/author-publishing.md §9。
 */
import { z } from 'zod';
import { Ed25519PublicKeySchema } from '../schemas/worldIdentity.schema';
import { PublishingEnvironmentNameSchema } from './signingKeys';

/** 認可要求の有効期間（承認・引き換えまで）。 */
export const CLI_AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;
/** デバイス認可で CLI がポーリングする間隔。 */
export const CLI_AUTH_POLL_INTERVAL_MS = 3000;
/** API トークンの接頭辞（ログ・Secret スキャンで見分けやすくするため）。 */
export const API_TOKEN_PREFIX = 'ubi_';

export const CLI_AUTH_KINDS = ['cli', 'ci'] as const;
export type CliAuthKind = (typeof CLI_AUTH_KINDS)[number];

export const CliAuthRequestInputSchema = z.object({
    kind: z.enum(CLI_AUTH_KINDS),
    name: PublishingEnvironmentNameSchema,
    publicKey: Ed25519PublicKeySchema,
    /** ループバック（RFC 8252）のときだけ。無ければデバイス認可（RFC 8628）。 */
    redirectUri: z.string().max(200).optional(),
    /** ループバックの PKCE（S256、base64url）。redirectUri と組で必須。 */
    codeChallenge: z
        .string()
        .regex(/^[A-Za-z0-9_-]{43}$/)
        .optional(),
});
export type CliAuthRequestInput = z.infer<typeof CliAuthRequestInputSchema>;

/**
 * ループバックのリダイレクト先として受け付ける URL か。http の 127.0.0.1 / localhost / [::1] で、ポートの指定があるものだけ
 * （任意のホストへ認可コードを送らせない）。
 */
export function isLoopbackRedirectUri(uri: string): boolean {
    // shared は DOM・Node に依存しないので URL を使わずに判定する。資格情報（@）・fragment（#）は許さない
    const m = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})(\/[^\s#@]*)?$/.exec(uri);
    if (!m) return false;
    const port = Number(m[2]);
    return port >= 1 && port <= 65535;
}

/** 引き換え時に要求の鍵で署名させる文（鍵の所有の証明）。要求ごとに違うので使い回せない。 */
export function cliAuthProofMessage(requestId: string): string {
    return `ubichill-cli-auth:${requestId}`;
}

/** デバイス認可の、画面で照合する短いコード（XXXX-XXXX）を正規化する（大文字小文字・ハイフン・空白の揺れを許す）。 */
export function normalizeUserCode(input: string): string | null {
    const compact = input.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[BCDFGHJKLMNPQRSTVWXZ]{8}$/.test(compact)) return null;
    return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

/** user code に使う文字（母音と紛らわしい文字を除き、単語や読み違いを避ける。RFC 8628 §6.1）。 */
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
