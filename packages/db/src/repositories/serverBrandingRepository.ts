import { and, eq, sql } from 'drizzle-orm';
import { db } from '../index';
import { serverBranding, serverImages } from '../schema';
import type { Tx } from './credentialUser';

export interface ServerBrandingRecord {
    shortName: string | null;
    themeColor: string | null;
}

export type ServerImageRecordKind = 'icon' | 'banner';

export interface ServerImageBlob {
    hash: string;
    contentType: string;
    bytes: Uint8Array;
    width: number;
    height: number;
}

const ID = 'current';

const lockKind = (tx: Tx, kind: ServerImageRecordKind) =>
    tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`server_images:${kind}`}, 0))`);

/** サーバーのブランディング（略称・色は 1 行、画像は作ったものごとに 1 行）。backend の branding service の Postgres 実装。 */
export const serverBrandingRepository = {
    async get(): Promise<ServerBrandingRecord | null> {
        const [row] = await db
            .select({ shortName: serverBranding.shortName, themeColor: serverBranding.themeColor })
            .from(serverBranding);
        return row ?? null;
    },

    async put(input: ServerBrandingRecord, now = new Date()): Promise<void> {
        const values = { ...input, updatedAt: now };
        await db
            .insert(serverBranding)
            .values({ id: ID, ...values })
            .onConflictDoUpdate({ target: serverBranding.id, set: values });
    },

    /** 置いてある画像（中身は読まない） */
    images(): Promise<Array<{ variant: string; hash: string }>> {
        return db.select({ variant: serverImages.variant, hash: serverImages.hash }).from(serverImages);
    },

    /** 今の画像のハッシュが一致するときだけ返す（置き換えた前の URL では返さない）。 */
    async image(variant: string, hash: string): Promise<ServerImageBlob | undefined> {
        const [row] = await db
            .select({
                hash: serverImages.hash,
                contentType: serverImages.contentType,
                bytes: serverImages.bytes,
                width: serverImages.width,
                height: serverImages.height,
            })
            .from(serverImages)
            .where(and(eq(serverImages.variant, variant), eq(serverImages.hash, hash)));
        return row;
    },

    /**
     * その種類の画像をまとめて入れ替える（前のものは残さない）。同じ種類の入れ替えは順に行う
     * （同時に送られた 2 枚から、タブのアイコンは片方・PWA のアイコンはもう片方、と混ざらないように）。
     */
    async replaceImages(
        kind: ServerImageRecordKind,
        images: ReadonlyArray<ServerImageBlob & { variant: string }>,
    ): Promise<void> {
        const now = new Date();
        await db.transaction(async (tx) => {
            await lockKind(tx, kind);
            await tx.delete(serverImages).where(eq(serverImages.kind, kind));
            if (images.length === 0) return;
            await tx.insert(serverImages).values(
                images.map((image) => ({
                    variant: image.variant,
                    kind,
                    hash: image.hash,
                    contentType: image.contentType,
                    bytes: Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength),
                    width: image.width,
                    height: image.height,
                    createdAt: now,
                })),
            );
        });
    },

    /** その種類の画像を消す。消したものがあれば true。 */
    removeImages(kind: ServerImageRecordKind): Promise<boolean> {
        return db.transaction(async (tx) => {
            await lockKind(tx, kind);
            const removed = await tx
                .delete(serverImages)
                .where(eq(serverImages.kind, kind))
                .returning({ variant: serverImages.variant });
            return removed.length > 0;
        });
    },
};
