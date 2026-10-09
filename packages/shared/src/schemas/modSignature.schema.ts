import { z } from 'zod';
import { AuthorAccountSchema } from '../user/handle';
import { IntegritySchema } from './modLock.schema';
import { Ed25519PublicKeySchema, Ed25519SignatureSchema } from './worldIdentity.schema';

// ============================================
// Mod Signature（mod の作者署名）
//
// 作者の公開環境の鍵で `{ version, alg, kind, publicKey, name, modVersion, contentHash, author }` に署名し、
// 配布物の `v<version>/lock.json` の兄弟 `lock.sig.json` として配る。鍵・作者アカウント・確認の規則は
// ワールドの署名と同じ。`kind: 'mod'` で署名対象を分け、ワールドの署名として使い回せないようにする。
// ワールドと違い、作者アカウントの無い署名は認めない（署名の無い mod は実行しない）。
// ============================================

/** 配布物の中の署名ファイル名（`<base>/<modId>/v<version>/lock.sig.json`）。 */
export const MOD_SIGNATURE_FILE = 'lock.sig.json';

export const ModSignatureSchema = z.object({
    version: z.literal(1),
    alg: z.literal('ed25519'),
    kind: z.literal('mod'),
    publicKey: Ed25519PublicKeySchema,
    /** mod の ID（lock の `id`）。 */
    name: z.string().min(1),
    modVersion: z.string().min(1),
    /** lock のうち実行内容を決める部分（{@link modLockContent}）の sha256。 */
    contentHash: IntegritySchema,
    author: AuthorAccountSchema,
    signature: Ed25519SignatureSchema,
});

export type ModSignature = z.infer<typeof ModSignatureSchema>;
