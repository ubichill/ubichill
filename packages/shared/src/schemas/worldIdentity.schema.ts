import { z } from 'zod';
import { AuthorAccountSchema } from '../user/handle';
import { IntegritySchema } from './modLock.schema';

// ============================================
// World Identity（ワールドの識別と作者署名）
//
// - contentHash: `{ definition, lock }` を正規化 JSON にした sha256。URL 非依存の「版」の同一性。
// - 署名: 作者の ed25519 鍵で `{ version, alg, publicKey, name, contentHash, author? }` に署名する。
//   作者アカウント（handle@domain）を確認できれば `acct:handle@domain/name`、できなければ
//   `publicKey + metadata.name` がワールドの同一性（版をまたいで不変）。
// - 署名はワールド YAML と分離し、兄弟ファイル（`<world>.sig.json` / `/worlds/:id/sig`）で配る。
// 暗号化ではない。署名の有無に関わらずワールドは誰でも読める。
// ============================================

/** ed25519 公開鍵（32 byte）の base64url（パディング無し）。 */
export const Ed25519PublicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Must be base64url(32byte)');

/** ed25519 署名（64 byte）の base64url（パディング無し）。 */
export const Ed25519SignatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/, 'Must be base64url(64byte)');

export const WorldSignatureSchema = z.object({
    version: z.literal(1),
    alg: z.literal('ed25519'),
    publicKey: Ed25519PublicKeySchema,
    /** 署名対象ワールドの `metadata.name`。 */
    name: z.string().min(1),
    contentHash: IntegritySchema,
    /**
     * 作者アカウント（`handle@domain`）の主張。署名対象に含まれる。検証側は domain の WebFinger で
     * その handle の公開鍵を引き、`publicKey` と一致したときだけ作者として表示する（主張だけでは信用しない）。
     */
    author: AuthorAccountSchema.optional(),
    signature: Ed25519SignatureSchema,
});

export type WorldSignature = z.infer<typeof WorldSignatureSchema>;

/**
 * 解決済みワールドの識別結果。invalid（改竄・署名不正）は解決時に拒否するため含まない。
 * - verified: 署名検証済み。`worldId` で版をまたいで同一ワールドと判定できる。
 *   `author` は作者アカウントの公開鍵と署名鍵の一致を確認できたときだけ付く。そのとき worldId は
 *   `acct:handle@domain/name`、確認できなければ `ed25519:<publicKey>/name`。
 * - unsigned: 署名無し。同一性は URL と contentHash のみ（配信元を信頼するしかない）。
 */
export const WorldIdentitySchema = z.discriminatedUnion('status', [
    z.object({
        status: z.literal('verified'),
        worldId: z.string(),
        publicKey: Ed25519PublicKeySchema,
        contentHash: IntegritySchema,
        author: AuthorAccountSchema.optional(),
    }),
    z.object({
        status: z.literal('unsigned'),
        contentHash: IntegritySchema,
    }),
]);

export type WorldIdentity = z.infer<typeof WorldIdentitySchema>;
