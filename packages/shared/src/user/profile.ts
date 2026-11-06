/**
 * プロフィール（ひとこと・自己紹介・リンク・言語・アイコン・バナー）の純粋な知識。
 * 画面の入力の判定と API の受け付けは同じスキーマで行う。
 */
import { z } from 'zod';
import type { Friendship, UserSummary } from './friends';
import { BioSchema } from './handle';
import { type ProfileLanguageCode, ProfileLanguagesSchema, profileLanguagesView } from './profileLanguages';
import { type ProfileLink, ProfileLinksSchema, profileLinksView } from './profileLinks';

/** ひとこと（今の状態を 1 行で）の最大文字数。 */
export const PROFILE_STATUS_MAX_LENGTH = 60;

/** ひとことの文字数（保存される形のコードポイント数）。画面のカウンタと API の上限は必ずこれで数える。 */
export function profileStatusLength(value: string): number {
    return Array.from(value.trim()).length;
}

const hasControlChar = (value: string): boolean =>
    Array.from(value).some((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    });

/** ひとこと（任意・1 行）。前後の空白を除き、空なら null。改行を含む制御文字は使えない。 */
export const ProfileStatusSchema = z
    .string()
    .transform((v) => v.trim())
    .refine((v) => !hasControlChar(v), 'ひとことは 1 行で書いてください（改行・制御文字は使えません）')
    .refine(
        (v) => Array.from(v).length <= PROFILE_STATUS_MAX_LENGTH,
        `ひとことは ${PROFILE_STATUS_MAX_LENGTH} 文字以内です`,
    )
    .transform((v) => (v === '' ? null : v));

/** `PUT /api/v1/users/me/profile` の本文。送った値で置き換える（表示名・画像はそれぞれの API で変える）。 */
export const ProfileUpdateSchema = z.object({
    status: ProfileStatusSchema,
    bio: BioSchema,
    links: ProfileLinksSchema,
    languages: ProfileLanguagesSchema,
});
export type ProfileUpdateInput = z.input<typeof ProfileUpdateSchema>;
export type ProfileUpdate = z.output<typeof ProfileUpdateSchema>;

// ---- 画像（アイコン・バナー） ----

export const PROFILE_IMAGE_KINDS = ['avatar', 'banner'] as const;
export type ProfileImageKind = (typeof PROFILE_IMAGE_KINDS)[number];

export const isProfileImageKind = (value: unknown): value is ProfileImageKind =>
    typeof value === 'string' && (PROFILE_IMAGE_KINDS as readonly string[]).includes(value);

/** サーバーが切り抜いて作り直す大きさ（cover）。画面の切り抜きのプレビューもこの比にする。 */
export const PROFILE_IMAGE_SIZES: Readonly<Record<ProfileImageKind, { width: number; height: number }>> = {
    avatar: { width: 512, height: 512 },
    banner: { width: 1500, height: 500 },
};

/** 送れる画像の大きさ（バイト）。 */
export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** 送れる画像の画素数。圧縮率の高い画像（小さなファイルで巨大な画素）で展開時のメモリを使い切らせない。 */
export const PROFILE_IMAGE_MAX_PIXELS = 40_000_000;

export const PROFILE_IMAGE_CONTENT_TYPE = 'image/webp';

/** 画像の内容のハッシュ（SHA-256 の base64url）。URL に入れて、内容が変われば URL も変わるようにする。 */
export const PROFILE_IMAGE_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 配信する URL のパス（`PUBLIC_BASE_URL` の後ろに付ける）。 */
export function profileImagePath(userId: string, kind: ProfileImageKind, hash: string): string {
    return `/api/v1/users/${encodeURIComponent(userId)}/images/${kind}/${hash}.webp`;
}

/** URL の最後の部分（`<hash>.webp`）からハッシュを取り出す。形が違えば null。 */
export function profileImageHashOf(fileName: string): string | null {
    const match = /^(.+)\.webp$/.exec(fileName);
    return match && PROFILE_IMAGE_HASH_PATTERN.test(match[1]) ? match[1] : null;
}

// ---- 公開プロフィール ----

/** プロフィールページに出す公開情報（`GET /api/v1/users/:id`）。 */
export interface UserProfile extends UserSummary {
    /** 作者アカウント `handle@domain` */
    author: string;
    /** ひとこと（書いていなければ null） */
    status: string | null;
    /** バナー画像の URL（無ければ null） */
    bannerImage: string | null;
    links: ProfileLink[];
    languages: ProfileLanguageCode[];
}

/** ID・内部 ID で引いたプロフィール（自分との関係付き。`GET /api/v1/social/users/...`）。 */
export interface UserProfileWithFriendship extends UserProfile {
    friendship: Friendship;
}

/** DB に保存してあるプロフィールの項目（links・languages は jsonb なので形を信用しない）。 */
export interface StoredProfileFields {
    id: string;
    name: string;
    handle: string;
    image: string | null;
    bio: string | null;
    status: string | null;
    bannerImage: string | null;
    links: unknown;
    languages: unknown;
}

export function userProfileOf(user: StoredProfileFields, author: string): UserProfile {
    return {
        id: user.id,
        name: user.name,
        handle: user.handle,
        author,
        image: user.image ?? null,
        bio: user.bio ?? null,
        status: user.status ?? null,
        bannerImage: user.bannerImage ?? null,
        links: profileLinksView(user.links),
        languages: profileLanguagesView(user.languages),
    };
}
