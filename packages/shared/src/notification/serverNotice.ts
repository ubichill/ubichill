/**
 * インスタンス（Go）が WebSocket で送る、その場だけの知らせ（`server:notice`）。保存しない。
 * 種類（kind）は足していくので、知らない種類は読み飛ばす（古いタブが新しい知らせで壊れないように）。
 */
import { z } from 'zod';

export const ServerNoticeSchema = z.discriminatedUnion('kind', [
    /** この時刻（epoch ms）に接続を切る（Pod の入れ替えなど）。クライアントは自動で繋ぎ直す。 */
    z.object({ kind: z.literal('disconnect'), at: z.number().int().nonnegative() }),
]);
export type ServerNotice = z.infer<typeof ServerNoticeSchema>;

/** 受け取った data を読む。形が違う・知らない種類なら undefined。 */
export function parseServerNotice(data: unknown): ServerNotice | undefined {
    const result = ServerNoticeSchema.safeParse(data);
    return result.success ? result.data : undefined;
}
