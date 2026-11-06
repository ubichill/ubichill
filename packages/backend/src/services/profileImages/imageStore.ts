import type { ProfileImageKind } from '@ubichill/shared';

export interface StoredImage {
    hash: string;
    contentType: string;
    bytes: Uint8Array;
    width: number;
    height: number;
}

/**
 * プロフィール画像の置き場所。利用者・種類ごとに 1 枚で、置き換えると前の画像は取れなくなる。
 * 今は Postgres（@ubichill/db の profileImageRepository）。オブジェクトストレージに移すときはこの形で実装を差し替える。
 */
export interface ImageStore {
    put(userId: string, kind: ProfileImageKind, image: StoredImage): Promise<void>;
    /** 今の画像のハッシュが一致するときだけ返す。 */
    get(userId: string, kind: ProfileImageKind, hash: string): Promise<StoredImage | undefined>;
    /** 消したものがあれば true。 */
    remove(userId: string, kind: ProfileImageKind): Promise<boolean>;
}
