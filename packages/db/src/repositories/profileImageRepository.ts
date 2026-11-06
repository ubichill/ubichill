import { and, eq } from 'drizzle-orm';
import { db } from '../index';
import { profileImages } from '../schema';

export type ProfileImageRecordKind = 'avatar' | 'banner';

export interface ProfileImageBlob {
    hash: string;
    contentType: string;
    bytes: Uint8Array;
    width: number;
    height: number;
}

/** プロフィール画像の中身（利用者・種類ごとに 1 枚）。backend の ImageStore の Postgres 実装。 */
export const profileImageRepository = {
    /** 置き換える（前の画像は残さない）。 */
    async put(userId: string, kind: ProfileImageRecordKind, image: ProfileImageBlob): Promise<void> {
        const values = {
            hash: image.hash,
            contentType: image.contentType,
            bytes: Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength),
            width: image.width,
            height: image.height,
            createdAt: new Date(),
        };
        await db
            .insert(profileImages)
            .values({ userId, kind, ...values })
            .onConflictDoUpdate({ target: [profileImages.userId, profileImages.kind], set: values });
    },

    /** 今の画像のハッシュが一致するときだけ返す（置き換えた前の URL では返さない）。 */
    async get(userId: string, kind: ProfileImageRecordKind, hash: string): Promise<ProfileImageBlob | undefined> {
        const rows = await db
            .select({
                hash: profileImages.hash,
                contentType: profileImages.contentType,
                bytes: profileImages.bytes,
                width: profileImages.width,
                height: profileImages.height,
            })
            .from(profileImages)
            .where(and(eq(profileImages.userId, userId), eq(profileImages.kind, kind), eq(profileImages.hash, hash)));
        return rows[0];
    },

    /** 消す。消したものがあれば true。 */
    async remove(userId: string, kind: ProfileImageRecordKind): Promise<boolean> {
        const removed = await db
            .delete(profileImages)
            .where(and(eq(profileImages.userId, userId), eq(profileImages.kind, kind)))
            .returning({ hash: profileImages.hash });
        return removed.length > 0;
    },
};
